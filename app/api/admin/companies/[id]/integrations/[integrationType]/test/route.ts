import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { parseIntegrationType } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { readEncryptedConfig, verifyIntegrationConfig } from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string; integrationType: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id, integrationType } = await context.params;
    const type = parseIntegrationType(integrationType);
    const [tenant, integration, whatsappIntegration] = await Promise.all([
      prisma.tenant.findUnique({ where: { id }, select: { slug: true } }),
      prisma.integration.findUnique({ where: { tenantId_type: { tenantId: id, type } } }),
      prisma.integration.findUnique({ where: { tenantId_type: { tenantId: id, type: "WHATSAPP_CLOUD" } } })
    ]);
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
    return json({
      status: result.status,
      message: result.message
    });
  } catch (error) {
    return errorResponse(error);
  }
}
