import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { parseIntegrationType } from "@/lib/validation";
import { serializeIntegration } from "@/lib/serializers";
import { writeAuditLog } from "@/lib/audit";
import { defaultMaskedDisplay } from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string; integrationType: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id, integrationType } = await context.params;
    const type = parseIntegrationType(integrationType);
    const integration = await prisma.integration.upsert({
      where: { tenantId_type: { tenantId: id, type } },
      create: {
        tenantId: id,
        type,
        status: "NOT_CONNECTED",
        maskedDisplay: defaultMaskedDisplay(),
        createdById: admin.id,
        updatedById: admin.id
      },
      update: {
        status: "NOT_CONNECTED",
        encryptedConfig: null,
        maskedDisplay: defaultMaskedDisplay(),
        metadata: Prisma.JsonNull,
        lastVerifiedAt: null,
        lastVerificationError: null,
        updatedById: admin.id
      },
      include: { createdBy: true, updatedBy: true }
    });
    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: id,
      action: "admin.integration_disconnected",
      entityType: "Integration",
      entityId: integration.id,
      newValue: { type, status: "NOT_CONNECTED" }
    });
    return json({ integration: serializeIntegration(integration) });
  } catch (error) {
    return errorResponse(error);
  }
}
