import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationSuccess } from "@/lib/integrations/responses";
import { integrationPatchSchema, parseIntegrationType } from "@/lib/validation";
import { INTEGRATION_DEFINITIONS } from "@/lib/constants";
import { scrubSecretsFromLogs } from "@/lib/security";
import { serializeIntegration } from "@/lib/serializers";
import { safeCreateAuditLog } from "@/lib/audit";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import {
  defaultMaskedDisplay,
  encryptionConfigured,
  encryptIntegrationConfig,
  maskedDisplayForConfig,
  mergeIntegrationConfig,
  normalizeSubmittedConfig,
  safeIntegrationStatus
} from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string; integrationType: string }> };

function asJson(value: Record<string, unknown> | undefined) {
  return value as Prisma.InputJsonValue | undefined;
}

function nullableJson(value: unknown) {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export async function GET(request: NextRequest, context: Context) {
  let companyId = "unknown";
  let rawIntegrationType = "unknown";
  let includeDebug = false;
  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    const { id, integrationType: rawType } = await context.params;
    companyId = id;
    rawIntegrationType = rawType;
    const tenantId = id;
    const adminUserId = admin.id;
    const type = parseIntegrationType(rawType);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
    await ensureIntegrationSchema();
    const integration = await prisma.integration.upsert({
      where: { tenantId_type: { tenantId, type } },
      create: {
        tenantId,
        type,
        status: "NOT_CONNECTED",
        maskedDisplay: defaultMaskedDisplay(),
        createdById: adminUserId,
        updatedById: adminUserId
      },
      update: {}
    });

    return integrationSuccess({
      message: `${INTEGRATION_DEFINITIONS[type].name} loaded`,
      integration: serializeIntegration(integration)
    });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      companyId,
      integrationType: rawIntegrationType,
      includeDebug
    });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  let companyId = "unknown";
  let rawIntegrationType = "unknown";
  let includeDebug = false;
  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    const { id, integrationType: rawType } = await context.params;
    companyId = id;
    rawIntegrationType = rawType;
    const tenantId = id;
    const adminUserId = admin.id;
    const type = parseIntegrationType(rawType);
    const body = integrationPatchSchema.parse(await request.json());
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
    if (!encryptionConfigured()) {
      throw new ApiError(500, "ENCRYPTION_NOT_CONFIGURED", "Server encryption is not configured.");
    }
    await ensureIntegrationSchema();
    const oldValue = await prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type } },
      select: { id: true, status: true, maskedDisplay: true, metadata: true, encryptedConfig: true }
    });
    const submittedConfig = normalizeSubmittedConfig(type, body.config);
    const mergedConfig = mergeIntegrationConfig({
      type,
      encryptedConfig: oldValue?.encryptedConfig,
      submittedConfig
    });
    const hasConfig = Object.keys(mergedConfig).length > 0;
    const status = safeIntegrationStatus(body.status ?? (hasConfig ? "PARTIALLY_CONNECTED" : "NOT_CONNECTED"));
    const maskedDisplay = hasConfig ? maskedDisplayForConfig(type, mergedConfig) : defaultMaskedDisplay();
    const encryptedConfig = hasConfig ? encryptIntegrationConfig(mergedConfig) : Prisma.DbNull;
    const metadata = nullableJson(oldValue?.metadata);
    const lastVerifiedAt = status === "CONNECTED" ? new Date() : null;
    const lastVerificationError = null;
    const integration = await prisma.integration.upsert({
      where: { tenantId_type: { tenantId, type } },
      create: {
        tenantId,
        type,
        status,
        encryptedConfig,
        maskedDisplay: asJson(maskedDisplay),
        metadata,
        lastVerifiedAt,
        lastVerificationError,
        createdById: adminUserId,
        updatedById: adminUserId
      },
      update: {
        status,
        encryptedConfig,
        maskedDisplay: asJson(maskedDisplay),
        metadata,
        lastVerifiedAt,
        lastVerificationError,
        updatedById: adminUserId
      }
    });
    await safeCreateAuditLog({
      request,
      actorUserId: adminUserId,
      tenantId,
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
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      companyId,
      integrationType: rawIntegrationType,
      includeDebug
    });
  }
}
