import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const protectedAdmin = /^\/admin(?:\/|$)/;
const protectedApp = /^\/app(?:\/|$)/;
const accessCookie = "crm_access_token";
const publicPaths = [
  "/",
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/refresh",
  "/api/auth/me",
  "/api/health",
  "/health",
  "/_next",
  "/favicon.ico"
];

function isPublicPath(path: string) {
  return publicPaths.some((publicPath) => {
    if (publicPath === "/") {
      return path === "/";
    }
    return path === publicPath || path.startsWith(`${publicPath}/`);
  });
}

function securityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

function corsHeaders(request: NextRequest, response: NextResponse) {
  if (!request.nextUrl.pathname.startsWith("/api")) {
    return response;
  }

  const origin = request.headers.get("origin");
  const configured = process.env.CORS_ORIGIN?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const sameOrigin = request.nextUrl.origin;
  const allowed = new Set([sameOrigin, ...configured]);

  if (origin && allowed.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Vary", "Origin");
  }

  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-CSRF-Token");
  return response;
}

async function readRole(request: NextRequest) {
  const token = request.cookies.get(accessCookie)?.value;
  if (!token) {
    return null;
  }
  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_ACCESS_SECRET ?? "local-access-secret-change-before-production-32"
    );
    const { payload } = await jwtVerify(token, secret);
    return payload.role as string | undefined;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  if (request.method === "OPTIONS" && request.nextUrl.pathname.startsWith("/api")) {
    return corsHeaders(request, securityHeaders(new NextResponse(null, { status: 204 })));
  }

  const path = request.nextUrl.pathname;
  if (isPublicPath(path)) {
    return corsHeaders(request, securityHeaders(NextResponse.next()));
  }

  const role = await readRole(request);

  if (protectedAdmin.test(path) && role !== "PLATFORM_ADMIN") {
    const url = request.nextUrl.clone();
    if (role === "COMPANY_OWNER" || role === "COMPANY_AGENT") {
      url.pathname = "/app/dashboard";
      url.search = "";
    } else {
      url.pathname = "/login";
      url.searchParams.set("next", path);
    }
    return corsHeaders(request, securityHeaders(NextResponse.redirect(url)));
  }

  if (protectedApp.test(path) && role !== "COMPANY_OWNER" && role !== "COMPANY_AGENT") {
    const url = request.nextUrl.clone();
    if (role === "PLATFORM_ADMIN") {
      url.pathname = "/admin";
      url.search = "";
    } else {
      url.pathname = "/login";
      url.searchParams.set("next", path);
    }
    return corsHeaders(request, securityHeaders(NextResponse.redirect(url)));
  }

  return corsHeaders(request, securityHeaders(NextResponse.next()));
}

export const config = {
  matcher: ["/((?!api/health|health|_next|favicon.ico).*)"]
};
