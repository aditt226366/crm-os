import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { json } from "@/lib/api";
import { integrationErrorResponse } from "@/lib/integrations/responses";
import { serializeIntegration } from "@/lib/serializers";

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const integrations = await prisma.integration.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: { tenant: true, createdBy: true, updatedBy: true },
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
      route: request.nextUrl.pathname
    });
  }
}
