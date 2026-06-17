import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { featureToggleSchema, parseFeatureKey } from "@/lib/validation";
import { serializeFeature } from "@/lib/serializers";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string; featureKey: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id, featureKey: rawFeatureKey } = await context.params;
    const featureKey = parseFeatureKey(rawFeatureKey);
    const body = featureToggleSchema.parse(await request.json());
    const oldValue = await prisma.tenantFeature.findUnique({
      where: { tenantId_featureKey: { tenantId: id, featureKey } }
    });
    const feature = await prisma.tenantFeature.upsert({
      where: { tenantId_featureKey: { tenantId: id, featureKey } },
      create: {
        tenantId: id,
        featureKey,
        enabled: body.enabled,
        updatedById: admin.id
      },
      update: {
        enabled: body.enabled,
        updatedById: admin.id
      },
      include: { updatedBy: true }
    });
    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: id,
      action: body.enabled ? "admin.feature_enabled" : "admin.feature_disabled",
      entityType: "TenantFeature",
      entityId: feature.id,
      oldValue,
      newValue: { featureKey, enabled: body.enabled }
    });
    return json({ feature: serializeFeature(feature) });
  } catch (error) {
    return errorResponse(error);
  }
}
