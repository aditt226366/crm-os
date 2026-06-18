import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { sha256 } from "@/lib/security";

const accessCookie = "crm_access_token";
const refreshCookie = "crm_refresh_token";
const accessSecret = new TextEncoder().encode(
  process.env.JWT_ACCESS_SECRET ?? "local-access-secret-change-before-production-32"
);

type AccessPayload = {
  sub: string;
  role: string;
  tenantId?: string | null;
};

export async function signAccessToken(payload: AccessPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, accessSecret);
  return {
    userId: payload.sub,
    role: payload.role as string,
    tenantId: (payload.tenantId as string | undefined) ?? null
  };
}

export async function getAuthUser(request: NextRequest) {
  const token = request.cookies.get(accessCookie)?.value;
  if (!token) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  }

  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw new ApiError(401, "INVALID_TOKEN", "Session expired");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { tenant: true }
  });

  if (!user || user.status !== "ACTIVE") {
    throw new ApiError(401, "USER_DISABLED", "User is not active");
  }

  return user;
}

export async function createRefreshToken(userId: string) {
  const token = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt
    }
  });
  return token;
}

export async function createSession(user: {
  id: string;
  role: string;
  tenantId: string | null;
}) {
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    tenantId: user.tenantId
  });
  const refreshToken = await createRefreshToken(user.id);
  return { accessToken, refreshToken };
}

export function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string }
) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(accessCookie, tokens.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 15
  });
  response.cookies.set(refreshCookie, tokens.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(accessCookie, "", { path: "/", maxAge: 0 });
  response.cookies.set(refreshCookie, "", { path: "/", maxAge: 0 });
}

export function getRefreshCookie(request: NextRequest) {
  return request.cookies.get(refreshCookie)?.value ?? null;
}

export async function revokeRefreshToken(token: string | null) {
  if (!token) {
    return;
  }
  await prisma.refreshToken.updateMany({
    where: {
      tokenHash: sha256(token),
      revokedAt: null
    },
    data: { revokedAt: new Date() }
  });
}

export async function rotateRefreshToken(token: string | null) {
  if (!token) {
    throw new ApiError(401, "NO_REFRESH_TOKEN", "Refresh token missing");
  }

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { tenant: true } } }
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid");
  }

  if (existing.user.status !== "ACTIVE") {
    throw new ApiError(401, "USER_DISABLED", "User is not active");
  }

  if (
    existing.user.role !== "PLATFORM_ADMIN" &&
    (!existing.user.tenant || existing.user.tenant.status !== "ACTIVE")
  ) {
    throw new ApiError(403, "TENANT_DISABLED", "Company deactivated. Contact platform admin.");
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() }
  });

  return createSession(existing.user);
}

export const authCookieNames = {
  access: accessCookie,
  refresh: refreshCookie
};
