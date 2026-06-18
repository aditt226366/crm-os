import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/guards";
import { json } from "@/lib/api";
import { integrationErrorResponse } from "@/lib/integrations/responses";
import { getIntegrationDiagnostics } from "@/lib/integration-schema";

export async function GET(request: NextRequest) {
  let includeDebug = false;

  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    const diagnostics = await getIntegrationDiagnostics();

    return json({
      ok: true,
      ...diagnostics
    });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      includeDebug
    });
  }
}
