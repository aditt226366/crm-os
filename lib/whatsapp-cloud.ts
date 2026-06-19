import { ApiError } from "@/lib/api";
import type { IntegrationConfig } from "@/lib/integration-vault";
import { normalizePhone } from "@/lib/inbox";

type WhatsAppSendResult = {
  ok: boolean;
  status: number;
  whatsappMessageId?: string;
  error?: string;
};

function graphApiVersion() {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v20.0";
  return version.startsWith("v") ? version : `v${version}`;
}

function toWhatsAppRecipient(phone: string) {
  return normalizePhone(phone).replace(/^\+/, "");
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
  const errorMessage =
    data && typeof data === "object" && "error" in data
      ? (data as { error?: { message?: string } }).error?.message
      : undefined;

  return {
    ok: response.ok,
    status: response.status,
    whatsappMessageId: messageId,
    error: response.ok ? undefined : (errorMessage ?? (text || "WhatsApp message failed."))
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
  variables
}: {
  config: IntegrationConfig;
  to: string;
  templateName: string;
  language: string;
  variables?: string[];
}) {
  const components =
    variables && variables.length
      ? [
          {
            type: "body",
            parameters: variables.map((value) => ({
              type: "text",
              text: value
            }))
          }
        ]
      : undefined;

  return postWhatsAppMessage(config, {
    to: toWhatsAppRecipient(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components ? { components } : {})
    }
  });
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
