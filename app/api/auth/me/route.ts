import { NextRequest } from "next/server";
import {
  authCookieNames,
  getAuthUser,
  getRefreshCookie,
  rotateRefreshToken,
  setAuthCookies
} from "@/lib/auth";
import { ApiError, json } from "@/lib/api";

function safeUser(user: Awaited<ReturnType<typeof getAuthUser>>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    status: user.status,
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
  };
}

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get(authCookieNames.access)?.value ?? null;
  const refreshToken = request.cookies.get(authCookieNames.refresh)?.value ?? null;

  console.log("[auth.me] cookies", {
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken)
  });

  try {
    const user = await getAuthUser(request);
    console.log("[auth.me] result", {
      ok: true,
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId
    });
    return json({ ok: true, user: safeUser(user) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && refreshToken) {
      try {
        const tokens = await rotateRefreshToken(getRefreshCookie(request));
        const response = json({ ok: true, user: safeUser(tokens.user) });
        setAuthCookies(response, tokens);
        return response;
      } catch (refreshError) {
        console.log("[auth.me] result", {
          ok: false,
          reason: refreshError instanceof Error ? refreshError.name : "RefreshFailed"
        });
      }
    }

    const status = error instanceof ApiError ? error.status : 500;
    const message = status === 401 ? "Unauthorized" : error instanceof Error ? error.message : "Could not verify session.";
    return json(
      {
        ok: false,
        message,
        error: {
          code: error instanceof ApiError ? error.code : "SESSION_VERIFY_FAILED",
          message
        }
      },
      { status }
    );
  }
}
