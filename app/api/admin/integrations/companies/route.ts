import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { json } from "@/lib/api";
import { integrationErrorResponse } from "@/lib/integrations/responses";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { TOTAL_INTEGRATIONS } from "@/lib/integration-vault";

function serializeCompany(tenant: {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  integrations: Array<{ status: string }>;
}) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    status: tenant.status,
    totalIntegrationsCount: TOTAL_INTEGRATIONS,
    connectedIntegrationsCount: tenant.integrations.filter((integration) => integration.status === "CONNECTED").length,
    errorIntegrationsCount: tenant.integrations.filter((integration) =>
      integration.status === "ERROR" || integration.status === "PARTIALLY_CONNECTED"
    ).length
  };
}

export async function GET(request: NextRequest) {
  let includeDebug = false;
  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    await ensureIntegrationSchema();
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        status: true,
        integrations: { select: { status: true } }
      }
    });
    return json({ companies: tenants.map(serializeCompany) });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      includeDebug
    });
  }
}
