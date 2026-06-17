import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json } from "@/lib/api";
import { requireActiveTenant } from "@/lib/guards";
import { INTEGRATION_TYPES } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const user = await requireActiveTenant(request);
    const integrations = await prisma.integration.findMany({
      where: { tenantId: user.tenantId!, type: { in: [...INTEGRATION_TYPES] } },
      select: {
        type: true,
        status: true,
        lastVerifiedAt: true,
        lastVerificationError: true
      },
      orderBy: { type: "asc" }
    });

    const byType = new Map(integrations.map((integration) => [integration.type, integration]));
    return json({
      integrations: INTEGRATION_TYPES.map((type) => {
        const integration = byType.get(type);
        return {
          type,
          status: integration?.status ?? "NOT_CONNECTED",
          connected: integration?.status === "CONNECTED",
          lastVerifiedAt: integration?.lastVerifiedAt?.toISOString() ?? null,
          lastVerificationError: integration?.lastVerificationError ?? null
        };
      })
    });
  } catch (error) {
    return errorResponse(error);
  }
}
