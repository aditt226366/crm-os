import { prisma } from "@/lib/prisma";
import type { FeatureKey } from "@/lib/constants";

export async function recordUsage({
  tenantId,
  feature,
  provider,
  eventType,
  endpoint,
  units,
  cost,
  status,
  metadata
}: {
  tenantId: string;
  feature: FeatureKey;
  provider: string;
  eventType: string;
  endpoint?: string;
  units: number;
  cost: number;
  status: string;
  metadata?: unknown;
}) {
  return prisma.apiUsageLog.create({
    data: {
      tenantId,
      featureKey: feature,
      provider,
      eventType,
      endpoint,
      units,
      cost,
      status,
      metadata: metadata === undefined ? undefined : (metadata as object)
    }
  });
}
