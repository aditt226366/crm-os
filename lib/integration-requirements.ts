import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import type { IntegrationType } from "@/lib/constants";

export async function getIntegrationState(tenantId: string, type: IntegrationType) {
  return prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type } },
    select: { status: true, lastVerificationError: true }
  });
}

export async function requireConnectedIntegration(tenantId: string, type: IntegrationType, message: string) {
  const integration = await getIntegrationState(tenantId, type);
  if (integration?.status !== "CONNECTED") {
    throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", message);
  }
  return integration;
}
