import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationSuccess } from "@/lib/integrations/responses";
import { parseIntegrationType } from "@/lib/validation";
import { INTEGRATION_DEFINITIONS } from "@/lib/constants";
import { serializeIntegration } from "@/lib/serializers";
import { writeAuditLog } from "@/lib/audit";
import { defaultMaskedDisplay } from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string; integrationType: string }> };

export async function POST(request: NextRequest, context: Context) {
  let companyId = "unknown";
  let rawIntegrationType = "unknown";
  try {
    const admin = await requirePlatformAdmin(request);
    const { id, integrationType } = await context.params;
    companyId = id;
    rawIntegrationType = integrationType;
    const type = parseIntegrationType(integrationType);
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
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
        encryptedConfig: Prisma.DbNull,
        maskedDisplay: defaultMaskedDisplay(),
        metadata: Prisma.JsonNull,
        lastVerifiedAt: null,
        lastVerificationError: null,
        updatedById: admin.id
      }
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
    return integrationSuccess({
      message: `${INTEGRATION_DEFINITIONS[type].name} disconnected`,
      integration: serializeIntegration(integration)
    });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      companyId,
      integrationType: rawIntegrationType
    });
  }
}
