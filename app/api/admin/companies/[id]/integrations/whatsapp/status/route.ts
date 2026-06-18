import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationSuccess } from "@/lib/integrations/responses";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { maskedDisplayForConfig, readEncryptedConfig } from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string }> };

function webhookUrl(request: NextRequest) {
  const base = (process.env.APP_URL?.trim() || request.nextUrl.origin).replace(/\/$/, "");
  return `${base}/api/webhooks/whatsapp`;
}

function lastConnectedAt(integration: {
  metadata: unknown;
  lastVerifiedAt: Date | null;
  updatedAt: Date;
}) {
  const metadata = integration.metadata as { lastConnectedAt?: unknown } | null;
  return typeof metadata?.lastConnectedAt === "string"
    ? metadata.lastConnectedAt
    : (integration.lastVerifiedAt ?? integration.updatedAt).toISOString();
}

export async function GET(request: NextRequest, context: Context) {
  let companyId = "unknown";
  let includeDebug = false;
  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    const { id } = await context.params;
    companyId = id;
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });

    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }

    await ensureIntegrationSchema();
    const integration = await prisma.integration.findUnique({
      where: { tenantId_type: { tenantId: id, type: "WHATSAPP_CLOUD" } },
      select: {
        status: true,
        encryptedConfig: true,
        metadata: true,
        lastVerifiedAt: true,
        updatedAt: true
      }
    });
    const config = readEncryptedConfig(integration?.encryptedConfig);
    const masked = maskedDisplayForConfig("WHATSAPP_CLOUD", config) as Record<string, string>;

    return integrationSuccess({
      connected:
        integration?.status === "CONNECTED" &&
        Boolean(config.WHATSAPP_BUSINESS_ACCOUNT_ID && config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_ACCESS_TOKEN),
      wabaId: typeof masked.WHATSAPP_BUSINESS_ACCOUNT_ID === "string" ? masked.WHATSAPP_BUSINESS_ACCOUNT_ID : null,
      phoneNumberId: typeof masked.WHATSAPP_PHONE_NUMBER_ID === "string" ? masked.WHATSAPP_PHONE_NUMBER_ID : null,
      tokenExists: Boolean(config.WHATSAPP_ACCESS_TOKEN),
      lastConnectedAt: integration ? lastConnectedAt(integration) : null,
      webhookUrl: webhookUrl(request)
    });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      companyId,
      integrationType: "WHATSAPP_CLOUD",
      includeDebug
    });
  }
}
