import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const requiredProductionEnv = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "ENCRYPTION_KEY",
  "NODE_ENV",
  "APP_URL",
  "CORS_ORIGIN"
] as const;

function missingProductionEnv() {
  if (process.env.NODE_ENV !== "production") {
    return [];
  }

  return requiredProductionEnv.filter((key) => !process.env[key]?.trim());
}

export async function POST(request: NextRequest) {
  const missing = missingProductionEnv();
  if (missing.length > 0) {
    console.error("[auth.login] failed", {
      name: "ServerConfigurationError",
      message: `Missing required environment variables: ${missing.join(", ")}`
    });

    return NextResponse.json(
      {
        error: {
          code: "SERVER_CONFIGURATION_ERROR",
          message: "Server configuration error."
        }
      },
      { status: 500 }
    );
  }

  const { loginWithRequest } = await import("@/lib/auth-login");
  return loginWithRequest(request);
}
