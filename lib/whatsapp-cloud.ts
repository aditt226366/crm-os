import { ApiError } from "@/lib/api";
import type { IntegrationConfig } from "@/lib/integration-vault";
import { normalizePhone } from "@/lib/inbox";
import type { WhatsAppTemplateVariableMode } from "@/lib/whatsapp-template-config";

type WhatsAppSendResult = {
  ok: boolean;
  status: number;
  whatsappMessageId?: string;
  error?: string;
};

type WhatsAppMediaUploadResult = {
  ok: boolean;
  status: number;
  mediaId?: string;
  error?: string;
};

export type WhatsAppMediaKind = "image" | "document" | "audio" | "video";

export type WhatsAppTemplateComponentPayload = {
  type: string;
  sub_type?: string;
  index?: string;
  parameters: Array<{
    type: "text";
    text: string;
    parameter_name?: string;
  }>;
};

export type WhatsAppTemplateLead = {
  name?: string | null;
  phone?: string | null;
  status?: string | null;
  row?: string[] | null;
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

export function whatsappMediaKindFromMime(mimeType: string): WhatsAppMediaKind {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  return "document";
}

export function messageTypeFromMime(mimeType: string): "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO" {
  const kind = whatsappMediaKindFromMime(mimeType);
  if (kind === "image") return "IMAGE";
  if (kind === "audio") return "AUDIO";
  if (kind === "video") return "VIDEO";
  return "DOCUMENT";
}

export async function uploadWhatsAppMedia({
  config,
  file,
  fileName,
  mimeType
}: {
  config: IntegrationConfig;
  file: Blob;
  fileName: string;
  mimeType: string;
}): Promise<WhatsAppMediaUploadResult> {
  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = config.WHATSAPP_ACCESS_TOKEN?.trim();

  if (!phoneNumberId || !accessToken) {
    throw new ApiError(409, "WHATSAPP_CONFIG_MISSING", "WhatsApp Cloud API is not connected for this company.");
  }

  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("type", mimeType);
  formData.append("file", file, fileName);

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(phoneNumberId)}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: formData
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "WhatsApp media upload failed."
    };
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const mediaId = data && typeof data === "object" ? (data as { id?: string }).id : undefined;

  return {
    ok: response.ok,
    status: response.status,
    mediaId,
    error: response.ok ? undefined : metaErrorText(data, text || "WhatsApp media upload failed.")
  };
}

export async function sendWhatsAppMediaMessage({
  config,
  to,
  mediaId,
  mediaType,
  caption,
  fileName
}: {
  config: IntegrationConfig;
  to: string;
  mediaId: string;
  mediaType: WhatsAppMediaKind;
  caption?: string;
  fileName?: string;
}) {
  const mediaPayload = {
    id: mediaId,
    ...(caption && mediaType !== "audio" ? { caption } : {}),
    ...(fileName && mediaType === "document" ? { filename: fileName } : {})
  };

  return postWhatsAppMessage(config, {
    recipient_type: "individual",
    to: toWhatsAppRecipient(to),
    type: mediaType,
    [mediaType]: mediaPayload
  });
}

export async function downloadWhatsAppMedia({
  config,
  mediaId
}: {
  config: IntegrationConfig;
  mediaId: string;
}) {
  const accessToken = config.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new ApiError(409, "WHATSAPP_CONFIG_MISSING", "WhatsApp Cloud API is not connected for this company.");
  }

  const infoResponse = await fetch(`https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const info = (await infoResponse.json().catch(() => null)) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
    sha256?: string;
    error?: { message?: string };
  } | null;

  if (!infoResponse.ok || !info?.url) {
    throw new ApiError(409, "WHATSAPP_MEDIA_LOOKUP_FAILED", info?.error?.message ?? "WhatsApp media lookup failed.");
  }

  const mediaResponse = await fetch(info.url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!mediaResponse.ok) {
    throw new ApiError(409, "WHATSAPP_MEDIA_DOWNLOAD_FAILED", "WhatsApp media download failed.");
  }

  const mimeType = mediaResponse.headers.get("content-type") ?? info.mime_type ?? "application/octet-stream";
  const bytes = Buffer.from(await mediaResponse.arrayBuffer());

  return {
    bytes,
    mimeType,
    size: info.file_size ?? bytes.byteLength,
    sha256: info.sha256 ?? null
  };
}

export function renderTemplateBody(body: string, variables?: Record<string, string>) {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => variables?.[key] ?? `{{${key}}}`);
}

function safeLeadName(lead?: WhatsAppTemplateLead) {
  return lead?.name?.trim() || "there";
}

function variableValueFromPath(path: string, lead?: WhatsAppTemplateLead) {
  const normalized = path.trim().toLowerCase();
  if (normalized === "lead.name" || normalized === "contact.name" || normalized === "name") {
    return safeLeadName(lead);
  }
  if (normalized === "lead.phone" || normalized === "contact.phone" || normalized === "phone") {
    return lead?.phone?.trim() || safeLeadName(lead);
  }
  if (normalized === "lead.status" || normalized === "status") {
    return lead?.status?.trim() || "new";
  }
  const rowMatch = normalized.match(/^lead\.row\[(\d+)\]$/);
  if (rowMatch) {
    return lead?.row?.[Number(rowMatch[1])]?.trim() || safeLeadName(lead);
  }
  if (normalized.startsWith("literal:")) {
    return path.slice("literal:".length).trim() || safeLeadName(lead);
  }
  return safeLeadName(lead);
}

export function resolveWhatsAppTemplateVariables({
  variables,
  lead
}: {
  variables?: Record<string, string>;
  lead?: WhatsAppTemplateLead;
}) {
  return Object.fromEntries(
    Object.entries(variables ?? {}).map(([key, path]) => [key, variableValueFromPath(path, lead)])
  );
}

function numberedVariableEntries(values: Record<string, string>) {
  return Object.entries(values).sort(([left], [right]) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    return left.localeCompare(right);
  });
}

export function buildWhatsAppTemplatePayload({
  to,
  templateName,
  language,
  variableMode = "NUMBERED",
  variables,
  lead
}: {
  to: string;
  templateName: string;
  language: string;
  variableMode?: WhatsAppTemplateVariableMode;
  variables?: Record<string, string>;
  lead?: WhatsAppTemplateLead;
}) {
  const resolvedVariables = resolveWhatsAppTemplateVariables({ variables, lead });
  const entries =
    variableMode === "NUMBERED" ? numberedVariableEntries(resolvedVariables) : Object.entries(resolvedVariables);
  const parameters = entries.map(([key, text]) => ({
    type: "text" as const,
    ...(variableMode === "NAMED" ? { parameter_name: key } : {}),
    text
  }));
  const components = parameters.length ? [{ type: "body", parameters }] : undefined;

  return {
    to: toWhatsAppRecipient(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components ? { components } : {})
    }
  };
}

export async function sendWhatsAppTemplateMessage({
  config,
  to,
  templateName,
  language,
  variableMode,
  variableMappings,
  lead,
  variables,
  components
}: {
  config: IntegrationConfig;
  to: string;
  templateName: string;
  language: string;
  variableMode?: WhatsAppTemplateVariableMode;
  variableMappings?: Record<string, string>;
  lead?: WhatsAppTemplateLead;
  variables?: string[];
  components?: WhatsAppTemplateComponentPayload[];
}) {
  if (variableMappings) {
    return postWhatsAppMessage(
      config,
      buildWhatsAppTemplatePayload({
        to,
        templateName,
        language,
        variableMode,
        variables: variableMappings,
        lead
      })
    );
  }

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
