import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { money } from "@/lib/serializers";
import { parseFeatureKey } from "@/lib/validation";
import { safeMetadataSummary } from "@/lib/egress";

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const params = request.nextUrl.searchParams;
    const company = params.get("company") || undefined;
    const provider = params.get("provider") || undefined;
    const status = params.get("status") || undefined;
    const feature = params.get("feature");

    const usage = await prisma.apiUsageLog.findMany({
      where: {
        tenantId: company,
        provider,
        status,
        featureKey: feature ? parseFeatureKey(feature) : undefined
      },
      select: {
        id: true,
        createdAt: true,
        tenantId: true,
        featureKey: true,
        provider: true,
        eventType: true,
        endpoint: true,
        units: true,
        status: true,
        cost: true,
        metadata: true,
        tenant: { select: { name: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return json({
      usage: usage.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        company: row.tenant.name,
        tenantId: row.tenantId,
        featureKey: row.featureKey,
        provider: row.provider,
        eventType: row.eventType,
        endpoint: row.endpoint,
        units: row.units,
        status: row.status,
        cost: money(row.cost),
        metadata: safeMetadataSummary(row.metadata)
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
