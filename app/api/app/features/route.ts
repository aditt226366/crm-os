import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { MANAGED_FEATURE_KEYS, getEnabledNavigation, managedFeatureOrder, type Plan } from "@/lib/constants";
import { serializeFeature } from "@/lib/serializers";
import { ensureTenantFeatureRows } from "@/lib/tenant-feature-schema";
import { FEATURE_CACHE_TTL_MS, featureCache, getCache, setCache } from "@/lib/egress";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await requireActiveTenant(request);
    const tenantId = user.tenantId!;
    const cached = getCache(featureCache, tenantId);
    if (cached) {
      return json(cached, { egress: { route: request.nextUrl.pathname, tenantId, startedAt } });
    }
    await ensureTenantFeatureRows(tenantId, (user.tenant?.plan ?? "STARTER") as Plan, user.id);
    const features = await prisma.tenantFeature.findMany({
      where: { tenantId, featureKey: { in: [...MANAGED_FEATURE_KEYS] } },
      include: { updatedBy: true },
      orderBy: { featureKey: "asc" }
    });
    features.sort((a, b) => managedFeatureOrder(a.featureKey) - managedFeatureOrder(b.featureKey));
    const payload = {
      features: features.map(serializeFeature),
      navigation: getEnabledNavigation(features)
    };
    setCache(featureCache, tenantId, payload, FEATURE_CACHE_TTL_MS);
    return json(payload, { egress: { route: request.nextUrl.pathname, tenantId, startedAt } });
  } catch (error) {
    return errorResponse(error);
  }
}
