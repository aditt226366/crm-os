import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { TOTAL_INTEGRATIONS } from "@/lib/integration-vault";

function serializeCompany(tenant: {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: Date;
  deactivatedAt: Date | null;
  users: Array<{ name: string; email: string; username: string; role: string; lastLoginAt: Date | null }>;
  integrations: Array<{ status: string }>;
}) {
  const owner = tenant.users.find((user) => user.role === "COMPANY_OWNER") ?? tenant.users[0];
  const lastLoginAt =
    tenant.users
      .map((user) => user.lastLoginAt)
      .filter(Boolean)
      .sort((a, b) => b!.getTime() - a!.getTime())[0]
      ?.toISOString() ?? null;

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    deactivatedAt: tenant.deactivatedAt?.toISOString() ?? null,
    ownerEmail: owner?.email ?? "No owner",
    ownerUsername: owner?.username ?? "No owner",
    ownerName: owner?.name ?? "No owner",
    lastLoginAt,
    totalIntegrationsCount: TOTAL_INTEGRATIONS,
    connectedIntegrationsCount: tenant.integrations.filter((integration) => integration.status === "CONNECTED").length,
    errorIntegrationsCount: tenant.integrations.filter((integration) =>
      integration.status === "ERROR" || integration.status === "PARTIALLY_CONNECTED"
    ).length
  };
}

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        users: true,
        integrations: { select: { status: true } }
      }
    });
    return json({ companies: tenants.map(serializeCompany) });
  } catch (error) {
    return errorResponse(error);
  }
}
