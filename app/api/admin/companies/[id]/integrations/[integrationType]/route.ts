import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationSuccess } from "@/lib/integrations/responses";
import { integrationPatchSchema, parseIntegrationType } from "@/lib/validation";
import { INTEGRATION_DEFINITIONS } from "@/lib/constants";
import { encryptJson, scrubSecretsFromLogs } from "@/lib/security";
import { serializeIntegration } from "@/lib/serializers";
import { writeAuditLog } from "@/lib/audit";
import {
  defaultMaskedDisplay,
  encryptionConfigured,
  maskedDisplayForConfig,
  mergeIntegrationConfig,
  normalizeSubmittedConfig,
  safeIntegrationStatus
} from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string; integrationType: string }> };

function asJson(value: Record<string, unknown> | undefined) {
  return value as Prisma.InputJsonValue | undefined;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id, integrationType: rawType } = await context.params;
    const type = parseIntegrationType(rawType);
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
        createdById: admin.id
      },
      update: {},
      include: { createdBy: true, updatedBy: true }
    });

    return integrationSuccess({
      message: `${INTEGRATION_DEFINITIONS[type].name} loaded`,
      integration: serializeIntegration(integration)
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id, integrationType: rawType } = await context.params;
    const type = parseIntegrationType(rawType);
    const body = integrationPatchSchema.parse(await request.json());
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
    if (!encryptionConfigured()) {
      throw new ApiError(500, "ENCRYPTION_NOT_CONFIGURED", "Server encryption is not configured.");
    }
    const oldValue = await prisma.integration.findUnique({
      where: { tenantId_type: { tenantId: id, type } },
      select: { id: true, status: true, maskedDisplay: true, metadata: true, encryptedConfig: true }
    });
    const submittedConfig = normalizeSubmittedConfig(type, body.config);
    const mergedConfig = mergeIntegrationConfig({
      type,
      encryptedConfig: oldValue?.encryptedConfig,
      submittedConfig
    });
    const hasConfig = Object.keys(mergedConfig).length > 0;
    const status = body.status ?? (hasConfig ? "PARTIALLY_CONNECTED" : "NOT_CONNECTED");
    const maskedDisplay = hasConfig ? maskedDisplayForConfig(type, mergedConfig) : defaultMaskedDisplay();
    const integration = await prisma.integration.upsert({
      where: { tenantId_type: { tenantId: id, type } },
      create: {
        tenantId: id,
        type,
        status,
        encryptedConfig: hasConfig ? encryptJson(mergedConfig) : null,
        maskedDisplay: asJson(maskedDisplay),
        metadata: undefined,
        lastVerificationError: null,
        createdById: admin.id,
        updatedById: admin.id
      },
      update: {
        status: safeIntegrationStatus(status),
        encryptedConfig: hasConfig ? encryptJson(mergedConfig) : null,
        maskedDisplay: asJson(maskedDisplay),
        lastVerificationError: status === "NOT_CONNECTED" ? null : undefined,
        updatedById: admin.id
      },
      include: { createdBy: true, updatedBy: true }
    });
    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: id,
      action: "admin.integration_saved",
      entityType: "Integration",
      entityId: integration.id,
      oldValue: oldValue ? scrubSecretsFromLogs({ status: oldValue.status, maskedDisplay: oldValue.maskedDisplay, metadata: oldValue.metadata }) : null,
      newValue: scrubSecretsFromLogs({ type, status: integration.status, maskedDisplay: integration.maskedDisplay })
    });
    return integrationSuccess({
      message: `${INTEGRATION_DEFINITIONS[type].name} saved securely`,
      integration: serializeIntegration(integration)
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
