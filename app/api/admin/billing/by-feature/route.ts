import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { money } from "@/lib/serializers";
import { FEATURE_DEFINITIONS, type FeatureKey } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const rows = await prisma.apiUsageLog.groupBy({
      by: ["featureKey"],
      _sum: { units: true, cost: true },
      orderBy: { _sum: { units: "desc" } }
    });
    return json({
      byFeature: rows.map((row) => ({
        featureKey: row.featureKey,
        feature: FEATURE_DEFINITIONS[row.featureKey as FeatureKey].name,
        units: row._sum.units ?? 0,
        cost: money(row._sum.cost ?? 0)
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
