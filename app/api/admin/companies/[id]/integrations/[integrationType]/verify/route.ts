import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationFailure, integrationSuccess } from "@/lib/integrations/responses";
import { parseIntegrationType, integrationPatchSchema } from "@/lib/validation";
import { INTEGRATION_DEFINITIONS } from "@/lib/constants";
import { safeCreateAuditLog } from "@/lib/audit";
import { serializeIntegration } from "@/lib/serializers";
import { scrubSecretsFromLogs } from "@/lib/security";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
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
  let includeDebug = false;
  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    const { id, integrationType } = await context.params;
    companyId = id;
    rawIntegrationType = integrationType;
    const tenantId = id;
    const adminUserId = admin.id;
    const type = parseIntegrationType(integrationType);
    const body = integrationPatchSchema.parse(await request.json().catch(() => ({})));
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true } });
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
    if (!encryptionConfigured()) {
      throw new ApiError(500, "ENCRYPTION_NOT_CONFIGURED", "Server encryption is not configured.");
    }
    await ensureIntegrationSchema();
    const [currentIntegration, whatsappIntegration] = await Promise.all([
      prisma.integration.findUnique({ where: { tenantId_type: { tenantId, type } } }),
      prisma.integration.findUnique({ where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } } })
    ]);

    const mergedConfig = mergeIntegrationConfig({
      type,
      encryptedConfig: currentIntegration?.encryptedConfig,
      submittedConfig: body.config
    });
    const result = await verifyIntegrationConfig(type, mergedConfig, {
      tenantId,
      tenantSlug: tenant?.slug,
      origin: request.nextUrl.origin,
      dependencies: {
        WHATSAPP_CLOUD: readEncryptedConfig(whatsappIntegration?.encryptedConfig)
      }
    });
    const hasConfig = Object.keys(mergedConfig).length > 0;
    const encryptedConfig = hasConfig ? encryptIntegrationConfig(mergedConfig) : Prisma.DbNull;
    const maskedDisplay = asJson(hasConfig ? maskedDisplayForConfig(type, mergedConfig) : defaultMaskedDisplay());
    const metadata = result.metadata === undefined ? Prisma.JsonNull : asJson(result.metadata);
    const lastVerifiedAt = result.status === "CONNECTED" ? new Date() : null;
    const lastVerificationError = result.status === "ERROR" ? result.message : null;
    const integration = await prisma.integration.upsert({
      where: { tenantId_type: { tenantId, type } },
      create: {
        tenantId,
        type,
        status: result.status,
        encryptedConfig,
        maskedDisplay,
        metadata,
        lastVerifiedAt,
        lastVerificationError,
        createdById: adminUserId,
        updatedById: adminUserId
      },
      update: {
        status: result.status,
        encryptedConfig,
        maskedDisplay,
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
      integrationType: rawIntegrationType,
      includeDebug
    });
  }
}
