import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationFailure, integrationSuccess } from "@/lib/integrations/responses";
import { parseIntegrationType, integrationPatchSchema } from "@/lib/validation";
import { INTEGRATION_DEFINITIONS } from "@/lib/constants";
import { writeAuditLog } from "@/lib/audit";
import { serializeIntegration } from "@/lib/serializers";
import { scrubSecretsFromLogs } from "@/lib/security";
import {
  defaultMaskedDisplay,
  encryptionConfigured,
  encryptIntegrationConfig,
  maskedDisplayForConfig,
  mergeIntegrationConfig,
  readEncryptedConfig,
  verifyIntegrationConfig
} from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string; integrationType: string }> };

function asJson(value: Record<string, unknown> | undefined) {
  return value as Prisma.InputJsonValue | undefined;
}

export async function POST(request: NextRequest, context: Context) {
  let companyId = "unknown";
  let rawIntegrationType = "unknown";
  try {
    const admin = await requirePlatformAdmin(request);
    const { id, integrationType } = await context.params;
    companyId = id;
    rawIntegrationType = integrationType;
    const type = parseIntegrationType(integrationType);
    if (!encryptionConfigured()) {
      throw new ApiError(500, "ENCRYPTION_NOT_CONFIGURED", "Server encryption is not configured.");
    }
    const body = integrationPatchSchema.parse(await request.json().catch(() => ({})));
    const [tenant, currentIntegration, whatsappIntegration] = await Promise.all([
      prisma.tenant.findUnique({ where: { id }, select: { id: true, slug: true } }),
      prisma.integration.findUnique({ where: { tenantId_type: { tenantId: id, type } } }),
      prisma.integration.findUnique({ where: { tenantId_type: { tenantId: id, type: "WHATSAPP_CLOUD" } } })
    ]);
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }

    const mergedConfig = mergeIntegrationConfig({
      type,
      encryptedConfig: currentIntegration?.encryptedConfig,
      submittedConfig: body.config
    });
    const result = await verifyIntegrationConfig(type, mergedConfig, {
      tenantId: id,
      tenantSlug: tenant?.slug,
      origin: request.nextUrl.origin,
      dependencies: {
        WHATSAPP_CLOUD: readEncryptedConfig(whatsappIntegration?.encryptedConfig)
      }
    });
    const hasConfig = Object.keys(mergedConfig).length > 0;
    const integration = await prisma.integration.upsert({
      where: { tenantId_type: { tenantId: id, type } },
      create: {
        tenantId: id,
        type,
        status: result.status,
        encryptedConfig: hasConfig ? encryptIntegrationConfig(mergedConfig) : Prisma.DbNull,
        maskedDisplay: asJson(hasConfig ? maskedDisplayForConfig(type, mergedConfig) : defaultMaskedDisplay()),
        metadata: asJson(result.metadata),
        lastVerifiedAt: result.status === "CONNECTED" ? new Date() : null,
        lastVerificationError: result.status === "ERROR" ? result.message : null,
        createdById: admin.id,
        updatedById: admin.id
      },
      update: {
        status: result.status,
        encryptedConfig: hasConfig ? encryptIntegrationConfig(mergedConfig) : Prisma.DbNull,
        maskedDisplay: asJson(hasConfig ? maskedDisplayForConfig(type, mergedConfig) : defaultMaskedDisplay()),
        metadata: result.metadata === undefined ? undefined : asJson(result.metadata),
        lastVerifiedAt: result.status === "CONNECTED" ? new Date() : undefined,
        lastVerificationError: result.status === "ERROR" ? result.message : null,
        updatedById: admin.id
      },
      include: { createdBy: true, updatedBy: true }
    });

    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: id,
      action: result.status === "CONNECTED" ? "admin.integration_verified" : "admin.integration_failed_verification",
      entityType: "Integration",
      entityId: integration.id,
      newValue: scrubSecretsFromLogs({
        type,
        status: result.status,
        message: result.message,
        metadata: result.metadata
      })
    });

    const responseBody = {
      status: result.status,
      message: result.message || `${INTEGRATION_DEFINITIONS[type].name} connected successfully`,
      code: result.status === "ERROR" ? "INTEGRATION_VERIFY_FAILED" : "INTEGRATION_VERIFIED",
      field: result.field,
      integration: serializeIntegration(integration)
    };

    return result.status === "ERROR"
      ? integrationFailure(responseBody, { status: 400 })
      : integrationSuccess(responseBody);
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      companyId,
      integrationType: rawIntegrationType
    });
  }
}
