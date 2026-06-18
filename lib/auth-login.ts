import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { validateAuthEnv } from "@/lib/auth-env";
import { loginSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAccessOnlySession, createSession, setAuthCookies } from "@/lib/auth";
import { ApiError, json } from "@/lib/api";
import { clientIp, sanitizeText, verifyPassword } from "@/lib/security";
import { safeCreateAuditLog } from "@/lib/audit";

type LoginUser = NonNullable<Awaited<ReturnType<typeof findLoginUser>>>;

function prismaDebug(error: unknown) {
  const details = error as { code?: unknown; meta?: unknown; message?: unknown };
  return {
    prismaCode:
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : typeof details.code === "string"
          ? details.code
          : undefined,
    prismaMeta: error instanceof Prisma.PrismaClientKnownRequestError ? error.meta : undefined,
    prismaMessage: typeof details.message === "string" ? details.message : String(error)
  };
}

function isPrismaError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

function databaseFailureBody(error: unknown) {
  const debug = prismaDebug(error);
  return {
    ok: false,
    message: debug.prismaCode ? `Database request failed: ${debug.prismaCode}` : "Database request failed.",
    error: {
      code: "DATABASE_REQUEST_FAILED",
      message: debug.prismaCode ? `Database request failed: ${debug.prismaCode}` : "Database request failed."
    },
    ...(process.env.NODE_ENV !== "production" ? { debug } : {})
  };
}

function safeLoginErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    const message =
      error.code === "INVALID_CREDENTIALS"
        ? "Invalid username or password."
        : error.code === "TENANT_DEACTIVATED"
          ? "Company is deactivated. Contact platform admin."
          : error.message;

    return json(
      {
        ok: false,
        message,
        error: {
          code: error.code,
          message
        }
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return json(
      {
        ok: false,
        message: "Request validation failed",
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          issues: error.issues
        }
      },
      { status: 400 }
    );
  }

  if (isPrismaError(error)) {
    return json(databaseFailureBody(error), { status: 500 });
  }

  return json(
    {
      ok: false,
      message: "Login failed because the server hit an unexpected error.",
      error: {
        code: "INTERNAL_ERROR",
        message: "Login failed because the server hit an unexpected error."
      }
    },
    { status: 500 }
  );
}

function logLoginFailure(error: unknown) {
  const debug = isPrismaError(error) ? prismaDebug(error) : null;
  console.error("[auth.login] failed", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown login error",
    prismaCode: debug?.prismaCode,
    prismaMeta: debug?.prismaMeta
  });
}

async function findLoginUser(username: string) {
  return prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: username, mode: "insensitive" } },
        { username: { equals: username, mode: "insensitive" } }
      ]
    },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      passwordHash: true,
      role: true,
      status: true,
      tenantId: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          status: true
        }
      }
    }
  });
}

async function safeUpdateLastLogin(userId: string) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() }
    });
  } catch (error) {
    console.error("[auth.login] lastLoginAt update failed", prismaDebug(error));
  }
}

async function createLoginSession(user: LoginUser) {
  try {
    return await createSession(user);
  } catch (error) {
    if (!isPrismaError(error)) {
      throw error;
    }

    console.error("[auth.login] refresh token creation failed; issuing access-only session", prismaDebug(error));
    return createAccessOnlySession(user);
  }
}

export async function loginWithRequest(request: NextRequest) {
  try {
    const authEnv = validateAuthEnv();
    if (!authEnv.ok) {
      return json(
        {
          ok: false,
          message: "Server configuration error.",
          error: {
            code: "AUTH_ENV_MISSING",
            message: "Server configuration error."
          }
        },
        { status: 500 }
      );
    }

    console.log("[auth.login] request received");

    const ip = clientIp(request.headers);
    const limit = checkRateLimit(`login:${ip}`, 10, 60_000);
    if (!limit.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many login attempts");
    }

    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Invalid request body");
    }

    const body = loginSchema.parse(requestBody);
    const username = sanitizeText(body.username).toLowerCase();
    const user = await findLoginUser(username);

    console.log("[auth.login] user lookup", {
      username,
      userFound: Boolean(user),
      role: user?.role ?? null,
      tenantActive: user?.tenant ? user.tenant.status === "ACTIVE" : null
    });

    const passwordMatches = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || user.status !== "ACTIVE" || !passwordMatches) {
      await safeCreateAuditLog({
        request,
        actorUserId: user?.id ?? null,
        tenantId: user?.tenantId ?? null,
        action: "auth.login_failed",
        entityType: "User",
        entityId: user?.id ?? null,
        newValue: { username }
      });
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
    }

    const isCompanyUser = user.role === "COMPANY_OWNER" || user.role === "COMPANY_AGENT";
    if (isCompanyUser && (!user.tenant || user.tenant.status !== "ACTIVE")) {
      throw new ApiError(403, "TENANT_DEACTIVATED", "Company is deactivated. Contact platform admin.");
    }

    if (user.role !== "PLATFORM_ADMIN" && !isCompanyUser) {
      throw new ApiError(403, "UNSUPPORTED_ROLE", "This account cannot sign in here.");
    }

    await safeUpdateLastLogin(user.id);

    await safeCreateAuditLog({
      request,
      actorUserId: user.id,
      tenantId: user.tenantId,
      action: "auth.login_success",
      entityType: "User",
      entityId: user.id,
      newValue: { username, role: user.role }
    });

    const redirectTo = user.role === "PLATFORM_ADMIN" ? "/admin" : "/app/dashboard";
    const response = json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              slug: user.tenant.slug,
              plan: user.tenant.plan,
              status: user.tenant.status
            }
          : null
      },
      redirectTo
    });

    setAuthCookies(response, await createLoginSession(user));
    console.log("[auth.login] success", {
      userId: user.id,
      username,
      role: user.role,
      tenantId: user.tenantId,
      tenantActive: user.tenant ? user.tenant.status === "ACTIVE" : null,
      redirectTo
    });
    return response;
  } catch (error) {
    logLoginFailure(error);
    return safeLoginErrorResponse(error);
  }
}
