import { ApiError } from "@/lib/api";
import type { IntegrationConfig } from "@/lib/integration-vault";
import { normalizePhone } from "@/lib/inbox";

type WhatsAppSendResult = {
  ok: boolean;
  status: number;
  whatsappMessageId?: string;
  error?: string;
};

export type WhatsAppTemplateComponentPayload = {
  type: string;
  sub_type?: string;
  index?: string;
  parameters: Array<{
    type: "text";
    text: string;
  }>;
};

function graphApiVersion() {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v20.0";
  return version.startsWith("v") ? version : `v${version}`;
}

function toWhatsAppRecipient(phone: string) {
  return normalizePhone(phone).replace(/^\+/, "");
}

function metaErrorText(data: unknown, fallback: string) {
  if (!data || typeof data !== "object" || !("error" in data)) {
    return fallback;
  }

  const error = (data as { error?: { message?: string; code?: string | number; error_subcode?: string | number } }).error;
  const parts = [
    error?.message,
    error?.code === undefined ? null : `code ${error.code}`,
    error?.error_subcode === undefined ? null : `subcode ${error.error_subcode}`
  ].filter(Boolean);

  return parts.join(" | ") || fallback;
}

async function postWhatsAppMessage(config: IntegrationConfig, payload: Record<string, unknown>): Promise<WhatsAppSendResult> {
  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = config.WHATSAPP_ACCESS_TOKEN?.trim();

  if (!phoneNumberId || !accessToken) {
    throw new ApiError(409, "WHATSAPP_CONFIG_MISSING", "WhatsApp Cloud API is not connected for this company.");
  }

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          ...payload
        })
      }
    );
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "WhatsApp message failed."
    };
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  const messageId =
    data && typeof data === "object" && Array.isArray((data as { messages?: unknown[] }).messages)
      ? ((data as { messages: Array<{ id?: string }> }).messages[0]?.id)
      : undefined;
  return {
    ok: response.ok,
    status: response.status,
    whatsappMessageId: messageId,
    error: response.ok ? undefined : metaErrorText(data, text || "WhatsApp message failed.")
  };
}

export function renderTemplateBody(body: string, variables?: Record<string, string>) {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => variables?.[key] ?? `{{${key}}}`);
}

export async function sendWhatsAppTemplateMessage({
  config,
  to,
  templateName,
  language,
  variables,
  components
}: {
  config: IntegrationConfig;
  to: string;
  templateName: string;
  language: string;
  variables?: string[];
  components?: WhatsAppTemplateComponentPayload[];
}) {
  const templateComponents =
    components ??
    (variables && variables.length
      ? [
          {
            type: "body",
            parameters: variables.map((value) => ({
              type: "text",
              text: value
            }))
          }
        ]
      : undefined);

  return postWhatsAppMessage(config, {
    to: toWhatsAppRecipient(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(templateComponents ? { components: templateComponents } : {})
    }
  });
}

export async function fetchWhatsAppTemplateDetails({
  config,
  templateName,
  language
}: {
  config: IntegrationConfig;
  templateName: string;
  language: string;
}) {
  const businessAccountId = config.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  const accessToken = config.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!businessAccountId || !accessToken) {
    return null;
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(
      businessAccountId
    )}/message_templates?name=${encodeURIComponent(templateName)}&access_token=${encodeURIComponent(accessToken)}`
  );
  const data = (await response.json().catch(() => null)) as {
    data?: Array<{
      id?: string;
      name?: string;
      language?: string;
      status?: string;
      category?: string;
      components?: unknown[];
    }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new ApiError(409, "WHATSAPP_TEMPLATE_SYNC_FAILED", data?.error?.message ?? "WhatsApp template sync failed.");
  }

  const template = (data?.data ?? []).find((item) => item.name === templateName && item.language === language);
  if (!template) {
    return null;
  }

  const bodyComponent = template.components?.find(
    (component) =>
      component &&
      typeof component === "object" &&
      (component as { type?: string }).type?.toUpperCase() === "BODY"
  ) as { text?: string } | undefined;

  return {
    metaTemplateId: template.id ?? null,
    name: template.name ?? templateName,
    language: template.language ?? language,
    status: template.status ?? null,
    category: template.category ?? null,
    body: bodyComponent?.text?.trim() || `Approved WhatsApp template: ${templateName}`,
    components: template.components ?? []
  };
}

export async function sendWhatsAppTextMessage({
  config,
  to,
  body
}: {
  config: IntegrationConfig;
  to: string;
  body: string;
}) {
  return postWhatsAppMessage(config, {
    recipient_type: "individual",
    to: toWhatsAppRecipient(to),
    type: "text",
    text: {
      preview_url: false,
      body
    }
  });
}
