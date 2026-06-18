import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, json } from "@/lib/api";
import { authCookieNames, verifyAccessToken } from "@/lib/auth";

type WorkspaceTenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
};

type WorkspaceUser = {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  tenantId: string | null;
  status?: string;
};

function prismaDetails(error: unknown) {
  const details = error as { code?: unknown; meta?: unknown; message?: unknown };
  return {
    prismaCode: typeof details.code === "string" ? details.code : undefined,
    prismaMeta: details.meta,
    message: typeof details.message === "string" ? details.message : String(error)
  };
}

function logWorkspaceError(error: unknown) {
  console.error("[app.me] failed", prismaDetails(error));
}

function includeDebug(role?: string | null) {
  return process.env.NODE_ENV !== "production" || role === "PLATFORM_ADMIN";
}

function databaseFailure(error: unknown, role?: string | null) {
  const details = prismaDetails(error);
  const message = details.prismaCode
    ? `Database request failed: ${details.prismaCode}`
    : "Database request failed.";

  return json(
    {
      ok: false,
      code: "DATABASE_REQUEST_FAILED",
      message,
      ...(includeDebug(role)
        ? {
            debug: {
              prismaCode: details.prismaCode,
              prismaMeta: details.prismaMeta
            }
          }
        : {})
    },
    { status: 500 }
  );
}

function fallbackTenant(tenantId: string): WorkspaceTenant {
  return {
    id: tenantId,
    name: "Printwear",
    slug: "workspace",
    status: "ACTIVE",
    plan: "STARTER"
  };
}

function workspacePayload(user: WorkspaceUser, tenant: WorkspaceTenant, warning?: string) {
  return {
    ok: true,
    ...(warning ? { warning } : {}),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
      tenant,
      whatsapp: {
        status: "NOT_CONNECTED",
        phoneNumber: null,
        lastVerifiedAt: null
      }
    },
    tenant
  };
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(authCookieNames.access)?.value;

  if (!token) {
    return json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  let session: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    session = await verifyAccessToken(token);
  } catch {
    return json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  if (!session.userId) {
    return json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "COMPANY_OWNER" && session.role !== "COMPANY_AGENT") {
    return json(
      { ok: false, message: "Company workspace access required." },
      { status: 403 }
    );
  }

  if (!session.tenantId) {
    return json(
      { ok: false, message: "Workspace not found. Contact platform admin." },
      { status: 403 }
    );
  }

  let dbUser: WorkspaceUser | null = null;
  let workspaceWarning: string | undefined;

  try {
    dbUser = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        role: true,
        status: true,
        tenantId: true
      }
    });

    if (dbUser?.status && dbUser.status !== "ACTIVE") {
      throw new ApiError(401, "USER_DISABLED", "User is not active");
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ ok: false, message: "Unauthorized" }, { status: error.status });
    }

    logWorkspaceError(error);
    workspaceWarning = "Workspace details could not fully load.";
  }

  const user: WorkspaceUser = {
    id: dbUser?.id ?? session.userId ?? "",
    name: dbUser?.name ?? session.username ?? "Workspace user",
    email: dbUser?.email ?? "",
    username: dbUser?.username ?? session.username ?? "workspace-user",
    role: dbUser?.role ?? session.role,
    tenantId: dbUser?.tenantId ?? session.tenantId
  };

  if (!user.tenantId) {
    return json(
      { ok: false, message: "Workspace not found. Contact platform admin." },
      { status: 403 }
    );
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        plan: true
      }
    });

    if (!tenant) {
      return json(
        { ok: false, message: "Workspace not found. Contact platform admin." },
        { status: 403 }
      );
    }

    if (tenant.status !== "ACTIVE") {
      return json(
        { ok: false, message: "Company deactivated. Contact platform admin." },
        { status: 403 }
      );
    }

    return json(workspacePayload(user, tenant, workspaceWarning));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      logWorkspaceError(error);
      if (error.code === "P2021" || error.code === "P2022") {
        const tenant = fallbackTenant(user.tenantId);
        return json(workspacePayload(user, tenant, "Workspace details could not fully load."));
      }
      return databaseFailure(error, session.role);
    }

    logWorkspaceError(error);
    return json(workspacePayload(user, fallbackTenant(user.tenantId), "Workspace details could not fully load."));
  }
}
