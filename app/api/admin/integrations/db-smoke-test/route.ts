import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { integrationErrorResponse, integrationSuccess } from "@/lib/integrations/responses";

export async function GET(request: NextRequest) {
  let includeDebug = false;

  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";

    const [integrations, auditLogs] = await Promise.all([
      prisma.integration.findMany({ take: 1 }),
      prisma.auditLog.findMany({ take: 1 })
    ]);

    return integrationSuccess({
      message: "Integration database smoke test passed.",
      integrationRows: integrations.length,
      auditLogRows: auditLogs.length
    });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      includeDebug
    });
  }
}
