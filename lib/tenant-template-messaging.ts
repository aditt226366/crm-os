import { Prisma, type WhatsAppTemplate } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import { prisma } from "@/lib/prisma";
import {
  fetchWhatsAppTemplateDetails,
  renderTemplateBody,
  resolveWhatsAppTemplateVariables,
  sendWhatsAppTemplateMessage,
  type WhatsAppTemplateLead
} from "@/lib/whatsapp-cloud";
import {
  templateVariableConfig,
  type TemplateVariableConfig,
  type WhatsAppTemplateRole
} from "@/lib/whatsapp-template-config";

export const TEMPLATE_SETTINGS_NOT_CONFIGURED_MESSAGE = "Template settings are not configured for this company.";
export const WHATSAPP_CLOUD_NOT_CONNECTED_MESSAGE = "WhatsApp Cloud API is not connected for this company.";

export type TemplatePurpose = WhatsAppTemplateRole;

export type TenantTemplateRecord = {
  id: string | null;
  name: string;
  language: string;
  status: string;
  body: string;
  components?: unknown;
};

export type TenantTemplateMessageConfig = {
  tenantId: string;
  templatePurpose: TemplatePurpose;
  whatsappConfig: IntegrationConfig;
  templateConfig: TemplateVariableConfig;
  template: TenantTemplateRecord;
};

function templateSettingsError() {
  return new ApiError(409, "TEMPLATE_SETTINGS_NOT_CONFIGURED", TEMPLATE_SETTINGS_NOT_CONFIGURED_MESSAGE);
}

function templateFromRecord(template: WhatsAppTemplate): TenantTemplateRecord {
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    status: template.status,
    body: template.body,
    components: template.components
  };
}

async function connectedIntegrationConfig({
  tenantId,
  type,
  message
}: {
  tenantId: string;
  type: "WHATSAPP_CLOUD" | "WHATSAPP_TEMPLATE_SETTINGS";
  message: string;
}) {
  const integration = await prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type } },
    select: { status: true, encryptedConfig: true }
  });

  if (integration?.status !== "CONNECTED") {
    throw type === "WHATSAPP_TEMPLATE_SETTINGS"
      ? templateSettingsError()
      : new ApiError(409, "INTEGRATION_NOT_CONNECTED", message);
  }

  const config = readEncryptedConfig(integration.encryptedConfig);
  if (!Object.keys(config).length) {
    throw type === "WHATSAPP_TEMPLATE_SETTINGS"
      ? templateSettingsError()
      : new ApiError(409, "INTEGRATION_NOT_CONNECTED", message);
  }

  return config;
}

async function syncTemplateFromMeta({
  tenantId,
  whatsappConfig,
  templateConfig
}: {
  tenantId: string;
  whatsappConfig: IntegrationConfig;
  templateConfig: TemplateVariableConfig;
}) {
  const details = await fetchWhatsAppTemplateDetails({
    config: whatsappConfig,
    templateName: templateConfig.name,
    language: templateConfig.language
  }).catch((error) => {
    console.error("[tenant-template-messaging] Meta template sync failed", {
      tenantId,
      templateName: templateConfig.name,
      language: templateConfig.language,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });

  if (!details || details.status !== "APPROVED") {
    return null;
  }

  const template = await prisma.whatsAppTemplate.upsert({
    where: {
      tenantId_name_language: {
        tenantId,
        name: details.name,
        language: details.language
      }
    },
    create: {
      tenantId,
      metaTemplateId: details.metaTemplateId,
      name: details.name,
      language: details.language,
      category: details.category === "UTILITY" || details.category === "AUTHENTICATION" ? details.category : "MARKETING",
      status: "APPROVED",
      body: details.body,
      variables: templateConfig.variables as Prisma.InputJsonValue,
      components: details.components as Prisma.InputJsonValue
    },
    update: {
      metaTemplateId: details.metaTemplateId,
      category: details.category === "UTILITY" || details.category === "AUTHENTICATION" ? details.category : "MARKETING",
      status: "APPROVED",
      body: details.body,
      variables: templateConfig.variables as Prisma.InputJsonValue,
      components: details.components as Prisma.InputJsonValue
    }
  });

  return templateFromRecord(template);
}

async function resolveConfiguredTemplate({
  tenantId,
  whatsappConfig,
  templateConfig
}: {
  tenantId: string;
  whatsappConfig: IntegrationConfig;
  templateConfig: TemplateVariableConfig;
}) {
  const localTemplate = await prisma.whatsAppTemplate.findFirst({
    where: {
      tenantId,
      name: templateConfig.name,
      language: templateConfig.language,
      status: "APPROVED"
    },
    orderBy: { updatedAt: "desc" }
  });

  if (localTemplate) {
    return templateFromRecord(localTemplate);
  }

  return (
    (await syncTemplateFromMeta({ tenantId, whatsappConfig, templateConfig })) ?? {
      id: null,
      name: templateConfig.name,
      language: templateConfig.language,
      status: "APPROVED",
      body: `Approved WhatsApp template: ${templateConfig.name}`,
      components: null
    }
  );
}

export async function loadTenantTemplateMessageConfig({
  tenantId,
  templatePurpose
}: {
  tenantId: string;
  templatePurpose: TemplatePurpose;
}): Promise<TenantTemplateMessageConfig> {
  const templateSettingsConfig = await connectedIntegrationConfig({
    tenantId,
    type: "WHATSAPP_TEMPLATE_SETTINGS",
    message: TEMPLATE_SETTINGS_NOT_CONFIGURED_MESSAGE
  });
  const templateConfig = templateVariableConfig(templateSettingsConfig, templatePurpose);

  if (!templateConfig) {
    throw templateSettingsError();
  }

  const whatsappConfig = await connectedIntegrationConfig({
    tenantId,
    type: "WHATSAPP_CLOUD",
    message: WHATSAPP_CLOUD_NOT_CONNECTED_MESSAGE
  });

  const template = await resolveConfiguredTemplate({
    tenantId,
    whatsappConfig,
    templateConfig
  });

  return {
    tenantId,
    templatePurpose,
    whatsappConfig,
    templateConfig,
    template
  };
}

export async function sendTemplateMessage({
  tenantId,
  templatePurpose,
  to,
  lead,
  config
}: {
  tenantId: string;
  templatePurpose: TemplatePurpose;
  to: string;
  lead?: WhatsAppTemplateLead;
  config?: TenantTemplateMessageConfig;
}) {
  const templateMessageConfig =
    config ?? (await loadTenantTemplateMessageConfig({ tenantId, templatePurpose }));

  if (templateMessageConfig.tenantId !== tenantId || templateMessageConfig.templatePurpose !== templatePurpose) {
    throw new ApiError(500, "TEMPLATE_CONFIG_TENANT_MISMATCH", "Template configuration does not match this company.");
  }

  const variables = resolveWhatsAppTemplateVariables({
    variables: templateMessageConfig.templateConfig.variables,
    lead
  });
  const sendResult = await sendWhatsAppTemplateMessage({
    config: templateMessageConfig.whatsappConfig,
    to,
    templateName: templateMessageConfig.template.name,
    language: templateMessageConfig.template.language,
    variableMode: templateMessageConfig.templateConfig.variableMode,
    variableMappings: templateMessageConfig.templateConfig.variables,
    lead
  });

  return {
    sendResult,
    template: templateMessageConfig.template,
    templateConfig: templateMessageConfig.templateConfig,
    variables,
    body: renderTemplateBody(templateMessageConfig.template.body, variables)
  };
}
