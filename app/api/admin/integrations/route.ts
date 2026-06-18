import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { json } from "@/lib/api";
import { integrationErrorResponse } from "@/lib/integrations/responses";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { serializeIntegration } from "@/lib/serializers";

export async function GET(request: NextRequest) {
  let includeDebug = false;
  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    await ensureIntegrationSchema();
    const integrations = await prisma.integration.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: { tenant: true },
      take: 200
    });
    return json({
      integrations: integrations.map((integration) => ({
        ...serializeIntegration(integration),
        company: {
          id: integration.tenant.id,
          name: integration.tenant.name,
          slug: integration.tenant.slug,
          plan: integration.tenant.plan
        }
      }))
    });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      includeDebug
    });
  }
}
