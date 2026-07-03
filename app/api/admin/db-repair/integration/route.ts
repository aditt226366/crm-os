import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/guards";
import { json } from "@/lib/api";
import { integrationErrorResponse } from "@/lib/integrations/responses";
import { repairIntegrationSchema } from "@/lib/integration-schema";

export async function POST(request: NextRequest) {
  let includeDebug = false;

  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    const diagnostics = await repairIntegrationSchema();

    return json({
      ok: true,
      message: "Integration database repaired.",
      ...diagnostics
    });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      includeDebug
    });
  }
}
