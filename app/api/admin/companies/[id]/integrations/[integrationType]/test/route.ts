import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationFailure, integrationSuccess } from "@/lib/integrations/responses";
import { parseIntegrationType } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { readEncryptedConfig, verifyIntegrationConfig } from "@/lib/integration-vault";

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
    const [tenant, integration, whatsappIntegration] = await Promise.all([
      prisma.tenant.findUnique({ where: { id }, select: { id: true, slug: true } }),
      prisma.integration.findUnique({ where: { tenantId_type: { tenantId: id, type } } }),
      prisma.integration.findUnique({ where: { tenantId_type: { tenantId: id, type: "WHATSAPP_CLOUD" } } })
    ]);
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
    const result = await verifyIntegrationConfig(type, readEncryptedConfig(integration?.encryptedConfig), {
      tenantId: id,
      tenantSlug: tenant?.slug,
      origin: request.nextUrl.origin,
      dependencies: {
        WHATSAPP_CLOUD: readEncryptedConfig(whatsappIntegration?.encryptedConfig)
      }
    });
    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: id,
      action: "admin.integration_tested",
      entityType: "Integration",
      entityId: integration?.id ?? type,
      newValue: { type, status: result.status, message: result.message }
    });
    const responseBody = {
      status: result.status,
      message: result.message,
      code: result.status === "ERROR" ? "INTEGRATION_TEST_FAILED" : "INTEGRATION_TESTED",
      field: result.field
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
