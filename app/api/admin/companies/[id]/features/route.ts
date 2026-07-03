import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { MANAGED_FEATURE_KEYS, managedFeatureOrder, type Plan } from "@/lib/constants";
import { serializeFeature } from "@/lib/serializers";
import { ensureTenantFeatureRows } from "@/lib/tenant-feature-schema";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await context.params;
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { plan: true }
    });

    if (!tenant) {
      return json({ error: { code: "COMPANY_NOT_FOUND", message: "Company not found" } }, { status: 404 });
    }

    await ensureTenantFeatureRows(id, tenant.plan as Plan, admin.id);
    const features = await prisma.tenantFeature.findMany({
      where: { tenantId: id, featureKey: { in: [...MANAGED_FEATURE_KEYS] } },
      include: { updatedBy: true },
      orderBy: { featureKey: "asc" }
    });
    features.sort((a, b) => managedFeatureOrder(a.featureKey) - managedFeatureOrder(b.featureKey));
    return json({ features: features.map(serializeFeature) });
  } catch (error) {
    return errorResponse(error);
  }
}
