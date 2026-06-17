import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { FEATURE_KEYS } from "@/lib/constants";
import { serializeFeature } from "@/lib/serializers";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await context.params;
    await Promise.all(
      FEATURE_KEYS.map((featureKey) =>
        prisma.tenantFeature.upsert({
          where: { tenantId_featureKey: { tenantId: id, featureKey } },
          create: { tenantId: id, featureKey, enabled: false, updatedById: admin.id },
          update: {}
        })
      )
    );
    const features = await prisma.tenantFeature.findMany({
      where: { tenantId: id },
      include: { updatedBy: true },
      orderBy: { featureKey: "asc" }
    });
    return json({ features: features.map(serializeFeature) });
  } catch (error) {
    return errorResponse(error);
  }
}
