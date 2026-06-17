import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getEnabledNavigation } from "@/lib/constants";
import { serializeFeature } from "@/lib/serializers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireActiveTenant(request);
    const features = await prisma.tenantFeature.findMany({
      where: { tenantId: user.tenantId! },
      include: { updatedBy: true },
      orderBy: { featureKey: "asc" }
    });
    return json({
      features: features.map(serializeFeature),
      navigation: getEnabledNavigation(features)
    });
  } catch (error) {
    return errorResponse(error);
  }
}
