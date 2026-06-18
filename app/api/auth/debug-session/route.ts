import { NextRequest } from "next/server";
import { authCookieNames, verifyAccessToken } from "@/lib/auth";
import { json } from "@/lib/api";

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get(authCookieNames.access)?.value ?? null;
  const refreshToken = request.cookies.get(authCookieNames.refresh)?.value ?? null;
  const cookieNamesSeen = request.cookies.getAll().map((cookie) => cookie.name);
  let canVerifyAccessToken = false;
  let role: string | null = null;
  let tenantId: string | null = null;

  if (accessToken) {
    try {
      const payload = await verifyAccessToken(accessToken);
      canVerifyAccessToken = true;
      role = payload.role ?? null;
      tenantId = payload.tenantId ?? null;
    } catch {
      canVerifyAccessToken = false;
    }
  }

  if (process.env.NODE_ENV === "production" && role !== "PLATFORM_ADMIN") {
    return json(
      {
        ok: false,
        message: "Forbidden"
      },
      { status: 403 }
    );
  }

  return json({
    ok: true,
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    canVerifyAccessToken,
    role,
    tenantId,
    cookieNamesSeen
  });
}
