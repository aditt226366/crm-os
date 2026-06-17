import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSession, setAuthCookies } from "@/lib/auth";
import { ApiError, errorResponse, json } from "@/lib/api";
import { clientIp, sanitizeText, verifyPassword } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";

export async function loginWithRequest(request: NextRequest) {
  try {
    const ip = clientIp(request.headers);
    const limit = checkRateLimit(`login:${ip}`, 10, 60_000);
    if (!limit.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many login attempts");
    }

    const body = loginSchema.parse(await request.json());
    const username = sanitizeText(body.username).toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: username }, { username }]
      },
      include: { tenant: true }
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
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password");
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
      redirectTo: user.role === "PLATFORM_ADMIN" ? "/admin" : "/app/dashboard"
    });

    setAuthCookies(response, await createSession(user));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
