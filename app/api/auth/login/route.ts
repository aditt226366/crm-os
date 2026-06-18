import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validateAuthEnv } from "@/lib/auth-env";

export async function POST(request: NextRequest) {
  const authEnv = validateAuthEnv();
  if (!authEnv.ok) {
    console.error("[auth.login] Missing required env", {
      missing: authEnv.missing
    });

    return NextResponse.json(
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

  const { loginWithRequest } = await import("@/lib/auth-login");
  return loginWithRequest(request);
}
