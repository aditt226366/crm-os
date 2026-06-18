import type { NextRequest } from "next/server";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSession, setAuthCookies } from "@/lib/auth";
import { ApiError, json } from "@/lib/api";
import { clientIp, sanitizeText, verifyPassword } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";

function safeLoginErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message
        }
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          issues: error.issues
        }
      },
      { status: 400 }
    );
  }

  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong"
      }
    },
    { status: 500 }
  );
}

function logLoginFailure(error: unknown) {
  console.error("[auth.login] failed", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown login error"
  });
}

export async function loginWithRequest(request: NextRequest) {
  try {
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
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: username, mode: "insensitive" } },
          { username: { equals: username, mode: "insensitive" } }
        ]
      },
      include: { tenant: true }
    });

    console.log("[auth.login] user lookup", {
      username,
      userFound: Boolean(user),
      role: user?.role ?? null,
      tenantActive: user?.tenant ? user.tenant.status === "ACTIVE" : null
    });

    const passwordMatches = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || user.status !== "ACTIVE" || !passwordMatches) {
      await writeAuditLog({
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
      throw new ApiError(403, "TENANT_DEACTIVATED", "Company deactivated. Contact platform admin.");
    }

    if (user.role !== "PLATFORM_ADMIN" && !isCompanyUser) {
      throw new ApiError(403, "UNSUPPORTED_ROLE", "This account cannot sign in here.");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    await writeAuditLog({
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

    setAuthCookies(response, await createSession(user));
    console.log("[auth.login] success", {
      username,
      role: user.role,
      tenantActive: user.tenant ? user.tenant.status === "ACTIVE" : null,
      redirectTo
    });
    return response;
  } catch (error) {
    logLoginFailure(error);
    return safeLoginErrorResponse(error);
  }
}
