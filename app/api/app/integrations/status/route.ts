import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/api";
import { requireActiveTenant } from "@/lib/guards";
import { INTEGRATION_TYPES } from "@/lib/constants";
import { integrationErrorResponse } from "@/lib/integrations/responses";
import {
  INTEGRATION_STATUS_CACHE_TTL_MS,
  compactIntegrationStatus,
  getCache,
  integrationStatusCache,
  setCache
} from "@/lib/egress";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  let companyId = "unknown";
  try {
    const user = await requireActiveTenant(request);
    companyId = user.tenantId ?? "unknown";
    const cached = getCache(integrationStatusCache, companyId);
    if (cached) {
      return json(cached, { egress: { route: request.nextUrl.pathname, tenantId: companyId, startedAt } });
    }
    const integrations = await prisma.integration.findMany({
      where: { tenantId: user.tenantId!, type: { in: [...INTEGRATION_TYPES] } },
      select: {
        type: true,
        status: true,
        maskedDisplay: true,
        metadata: true,
        lastVerifiedAt: true,
        lastVerificationError: true
      },
      orderBy: { type: "asc" }
    });

    const byType = new Map(integrations.map((integration) => [integration.type, integration]));
    const payload = {
      integrations: INTEGRATION_TYPES.map((type) => {
        const integration = byType.get(type);
        return compactIntegrationStatus({
          type,
          status: integration?.status ?? "NOT_CONNECTED",
          maskedDisplay: integration?.maskedDisplay ?? null,
          metadata: integration?.metadata ?? null,
          lastVerifiedAt: integration?.lastVerifiedAt ?? null,
          lastVerificationError: integration?.lastVerificationError ?? null
        });
      })
    };
    setCache(integrationStatusCache, companyId, payload, INTEGRATION_STATUS_CACHE_TTL_MS);
    return json(payload, { egress: { route: request.nextUrl.pathname, tenantId: companyId, startedAt } });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      companyId
    });
  }
}
