import crypto from "node:crypto";
import { INTEGRATION_TYPES, type IntegrationStatus, type IntegrationType } from "@/lib/constants";
import { INTEGRATION_CATALOG, integrationFields, isSecretField, isSensitiveField } from "@/lib/integration-catalog";
import { decryptJson, maskSecret } from "@/lib/security";

export type IntegrationConfig = Record<string, string>;

export type VerificationResult = {
  status: Extract<IntegrationStatus, "CONNECTED" | "ERROR">;
  message: string;
  metadata?: Record<string, unknown>;
  field?: string;
};

type VerifyOptions = {
  tenantId: string;
  tenantSlug?: string;
  origin?: string;
  dependencies?: Partial<Record<IntegrationType, IntegrationConfig>>;
};

const PROVIDER_TIMEOUT_MS = 15_000;
const TOTAL_INTEGRATIONS = INTEGRATION_TYPES.length;

export { TOTAL_INTEGRATIONS };

export function defaultMaskedDisplay() {
  return { status: "not connected" };
}

export function safeIntegrationStatus(status?: string): IntegrationStatus {
  if (status === "CONNECTED" || status === "ERROR" || status === "PARTIALLY_CONNECTED") {
    return status;
  }
  return "NOT_CONNECTED";
}

export function encryptionConfigured() {
  return Boolean(process.env.ENCRYPTION_KEY?.trim());
}

export function readEncryptedConfig(encryptedConfig?: string | null): IntegrationConfig {
  if (!encryptedConfig) {
    return {};
  }

  try {
    const parsed = decryptJson<Record<string, unknown>>(encryptedConfig);
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, typeof value === "string" ? value : String(value ?? "")])
    );
  } catch {
    return {};
  }
}

export function isMaskedPlaceholder(value: string) {
  const trimmed = value.trim();
  return /^\*{4,}.{0,16}$/.test(trimmed) || /^saved securely/i.test(trimmed);
}

function normalizePrivateKey(value: string) {
  return value.trim().replace(/\\n/g, "\n");
}

export function normalizeSubmittedConfig(type: IntegrationType, config?: Record<string, unknown>): IntegrationConfig {
  const allowed = new Set(integrationFields(type).map((field) => field.name));
  const normalized: IntegrationConfig = {};

  for (const [key, value] of Object.entries(config ?? {})) {
    if (!allowed.has(key)) continue;
    if (value === null || value === undefined) continue;
    const stringValue = String(value);
    const trimmed = stringValue.trim();
    if (!trimmed) continue;
    if (isSensitiveField(type, key) && isMaskedPlaceholder(trimmed)) continue;
    normalized[key] = key.includes("PRIVATE_KEY") ? normalizePrivateKey(stringValue) : trimmed;
  }

  if (type === "META_ADS" && normalized.META_AD_ACCOUNT_ID) {
    normalized.META_AD_ACCOUNT_ID = normalizeMetaAdAccountId(normalized.META_AD_ACCOUNT_ID);
  }

  return normalized;
}

export function mergeIntegrationConfig({
  type,
  encryptedConfig,
  submittedConfig
}: {
  type: IntegrationType;
  encryptedConfig?: string | null;
  submittedConfig?: Record<string, unknown>;
}) {
  return {
    ...readEncryptedConfig(encryptedConfig),
    ...normalizeSubmittedConfig(type, submittedConfig)
  };
}

export function maskedDisplayForConfig(type: IntegrationType, config: IntegrationConfig) {
  const display: Record<string, string> = {};
  for (const field of integrationFields(type)) {
    const value = config[field.name];
    if (!value) continue;
    display[field.name] = isSensitiveField(type, field.name) ? maskSecret(value) : value;
  }
  return Object.keys(display).length ? display : defaultMaskedDisplay();
}

export function normalizeMetaAdAccountId(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

export function webhookUrlForTenant({ origin, tenantSlug, tenantId }: { origin?: string; tenantSlug?: string; tenantId: string }) {
  const base = origin || process.env.APP_URL || "http://127.0.0.1:3000";
  const tenant = encodeURIComponent(tenantSlug || tenantId);
  return `${base.replace(/\/$/, "")}/api/webhooks/whatsapp?tenant=${tenant}`;
}

function missingOrEmpty(config: IntegrationConfig, key: string) {
  return !config[key] || config[key].trim().length === 0;
}

function emailValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function urlValid(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function fieldFromMessage(message: string) {
  const field = message.match(/^([A-Z0-9_]+)/)?.[1];
  return field?.includes("_") ? field : undefined;
}

function failure(message: string, field?: string): VerificationResult {
  return { status: "ERROR", message, field: field ?? fieldFromMessage(message) };
}

function success(message: string, metadata?: Record<string, unknown>): VerificationResult {
  return { status: "CONNECTED", message, metadata };
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<{ ok: boolean; status: number; data: unknown; text: string; timedOut: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: response.ok, status: response.status, data, text, timedOut: false };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return { ok: false, status: 0, data: { error: String(error) }, text: String(error), timedOut };
  } finally {
    clearTimeout(timeout);
  }
}

function graphApiVersion() {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v20.0";
  return version.startsWith("v") ? version : `v${version}`;
}

function graphErrorCode(data: unknown) {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: { code?: number; type?: string } }).error;
    return error?.code;
  }
  return undefined;
}

async function verifyGoogleSheets(config: IntegrationConfig) {
  if (missingOrEmpty(config, "GOOGLE_SHEETS_ID") || !/^[a-zA-Z0-9-_]{8,}$/.test(config.GOOGLE_SHEETS_ID)) {
    return failure("GOOGLE_SHEETS_ID wrong");
  }
  if (missingOrEmpty(config, "GOOGLE_SERVICE_ACCOUNT_EMAIL") || !emailValid(config.GOOGLE_SERVICE_ACCOUNT_EMAIL)) {
    return failure("GOOGLE_SERVICE_ACCOUNT_EMAIL wrong");
  }
  if (missingOrEmpty(config, "GOOGLE_PRIVATE_KEY")) {
    return failure("GOOGLE_PRIVATE_KEY wrong");
  }
  if (
    !config.GOOGLE_PRIVATE_KEY.startsWith("-----BEGIN PRIVATE KEY-----") ||
    !config.GOOGLE_PRIVATE_KEY.endsWith("-----END PRIVATE KEY-----")
  ) {
    return failure("GOOGLE_PRIVATE_KEY wrong");
  }

  try {
    crypto.createPrivateKey(config.GOOGLE_PRIVATE_KEY);
  } catch {
    return failure("GOOGLE_PRIVATE_KEY wrong");
  }

  const { SignJWT, importPKCS8 } = await import("jose");
  let assertion: string;
  try {
    const key = await importPKCS8(config.GOOGLE_PRIVATE_KEY, "RS256");
    assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(config.GOOGLE_SERVICE_ACCOUNT_EMAIL)
      .setSubject(config.GOOGLE_SERVICE_ACCOUNT_EMAIL)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key);
  } catch {
    return failure("GOOGLE_PRIVATE_KEY wrong");
  }

  const tokenResponse = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (tokenResponse.timedOut) {
    return failure("Google Sheets verification timed out");
  }
  if (!tokenResponse.ok) {
    return failure("GOOGLE_PRIVATE_KEY wrong");
  }

  const accessToken = (tokenResponse.data as { access_token?: string } | null)?.access_token;
  if (!accessToken) {
    return failure("GOOGLE_PRIVATE_KEY wrong");
  }

  const sheetResponse = await fetchJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.GOOGLE_SHEETS_ID)}?fields=properties.title,sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (sheetResponse.timedOut) {
    return failure("Google Sheets verification timed out");
  }
  if (sheetResponse.status === 404) {
    return failure("GOOGLE_SHEETS_ID wrong");
  }
  if (sheetResponse.status === 403) {
    const text = sheetResponse.text.toLowerCase();
    return text.includes("api") && text.includes("not") && text.includes("enabled")
      ? failure("Google Sheets API is not enabled for this service account project")
      : failure("GOOGLE_SERVICE_ACCOUNT_EMAIL wrong or sheet not shared with service account");
  }
  if (!sheetResponse.ok) {
    return failure("GOOGLE_SHEETS_ID wrong");
  }

  const sheet = sheetResponse.data as {
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  } | null;
  const firstSheetName = sheet?.sheets?.[0]?.properties?.title;

  if (firstSheetName) {
    const valuesResponse = await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.GOOGLE_SHEETS_ID)}/values/${encodeURIComponent(
        `${firstSheetName}!A1:Z1`
      )}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (valuesResponse.timedOut) {
      return failure("Google Sheets verification timed out");
    }
    if (valuesResponse.status === 403) {
      return failure("GOOGLE_SERVICE_ACCOUNT_EMAIL wrong or sheet not shared with service account");
    }
    if (!valuesResponse.ok && valuesResponse.status !== 400) {
      return failure("GOOGLE_SHEETS_ID wrong");
    }
  }

  return success("Google Sheets connected successfully", {
    spreadsheetTitle: sheet?.properties?.title ?? "Connected Google Sheet",
    sheetCount: sheet?.sheets?.length ?? 0,
    firstSheetName: firstSheetName ?? null,
    lastVerifiedAt: new Date().toISOString()
  });
}

async function verifyWhatsappCloud(config: IntegrationConfig, options: VerifyOptions) {
  if (missingOrEmpty(config, "WHATSAPP_PHONE_NUMBER_ID") || !/^\d{5,}$/.test(config.WHATSAPP_PHONE_NUMBER_ID)) {
    return failure("WHATSAPP_PHONE_NUMBER_ID wrong");
  }
  if (missingOrEmpty(config, "WHATSAPP_BUSINESS_ACCOUNT_ID") || !/^\d{5,}$/.test(config.WHATSAPP_BUSINESS_ACCOUNT_ID)) {
    return failure("WHATSAPP_BUSINESS_ACCOUNT_ID wrong");
  }
  if (missingOrEmpty(config, "WHATSAPP_ACCESS_TOKEN") || config.WHATSAPP_ACCESS_TOKEN.length < 12) {
    return failure("WHATSAPP_ACCESS_TOKEN wrong");
  }
  if (missingOrEmpty(config, "WHATSAPP_VERIFY_TOKEN")) {
    return failure("WHATSAPP_VERIFY_TOKEN wrong");
  }

  const phoneResponse = await fetchJson(
    `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(
      config.WHATSAPP_PHONE_NUMBER_ID
    )}?fields=id,display_phone_number,verified_name,quality_rating&access_token=${encodeURIComponent(config.WHATSAPP_ACCESS_TOKEN)}`
  );

  if (phoneResponse.timedOut) {
    return failure("WhatsApp verification timed out");
  }
  if (!phoneResponse.ok) {
    return graphErrorCode(phoneResponse.data) === 190
      ? failure("WHATSAPP_ACCESS_TOKEN wrong")
      : failure("WHATSAPP_PHONE_NUMBER_ID wrong");
  }

  const wabaPhoneResponse = await fetchJson(
    `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(
      config.WHATSAPP_BUSINESS_ACCOUNT_ID
    )}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100&access_token=${encodeURIComponent(
      config.WHATSAPP_ACCESS_TOKEN
    )}`
  );

  if (wabaPhoneResponse.timedOut) {
    return failure("WhatsApp verification timed out");
  }
  if (!wabaPhoneResponse.ok) {
    return graphErrorCode(wabaPhoneResponse.data) === 190
      ? failure("WHATSAPP_ACCESS_TOKEN wrong")
      : failure("WHATSAPP_BUSINESS_ACCOUNT_ID wrong");
  }

  const wabaPhones = ((wabaPhoneResponse.data as { data?: Array<{ id?: string }> } | null)?.data ?? []);
  if (!wabaPhones.some((phone) => phone.id === config.WHATSAPP_PHONE_NUMBER_ID)) {
    return failure("WHATSAPP_PHONE_NUMBER_ID does not belong to this WhatsApp Business Account");
  }

  const templateResponse = await fetchJson(
    `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(
      config.WHATSAPP_BUSINESS_ACCOUNT_ID
    )}/message_templates?limit=10&access_token=${encodeURIComponent(config.WHATSAPP_ACCESS_TOKEN)}`
  );

  if (templateResponse.timedOut) {
    return failure("WhatsApp verification timed out");
  }
  if (!templateResponse.ok) {
    return graphErrorCode(templateResponse.data) === 190
      ? failure("WHATSAPP_ACCESS_TOKEN wrong")
      : failure("WHATSAPP_BUSINESS_ACCOUNT_ID wrong");
  }

  const phone = phoneResponse.data as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
  const templates = (templateResponse.data as { data?: unknown[] } | null)?.data ?? [];
  return success("WhatsApp Cloud API connected successfully", {
    webhookUrl: webhookUrlForTenant(options),
    webhookStatus: "Ready for verification",
    displayPhoneNumber: phone.display_phone_number ?? config.WHATSAPP_PHONE_NUMBER_ID,
    verifiedName: phone.verified_name ?? "WhatsApp business phone",
    qualityRating: phone.quality_rating ?? null,
    wabaId: config.WHATSAPP_BUSINESS_ACCOUNT_ID,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    templateCount: templates.length,
    lastVerifiedAt: new Date().toISOString(),
    lastWebhookReceived: null,
    lastMessageStatusUpdate: null
  });
}

async function verifyTemplateSettings(config: IntegrationConfig, dependencies?: Partial<Record<IntegrationType, IntegrationConfig>>) {
  if (missingOrEmpty(config, "WHATSAPP_TEMPLATE_NAME")) {
    return failure("WHATSAPP_TEMPLATE_NAME wrong");
  }
  if (missingOrEmpty(config, "WHATSAPP_TEMPLATE_LANGUAGE")) {
    return failure("WHATSAPP_TEMPLATE_LANGUAGE wrong");
  }

  const whatsappConfig = dependencies?.WHATSAPP_CLOUD;
  if (!whatsappConfig?.WHATSAPP_ACCESS_TOKEN || !whatsappConfig.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    return failure("WhatsApp Cloud API is not connected.");
  }

  const response = await fetchJson(
    `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(
      whatsappConfig.WHATSAPP_BUSINESS_ACCOUNT_ID
    )}/message_templates?name=${encodeURIComponent(config.WHATSAPP_TEMPLATE_NAME)}&access_token=${encodeURIComponent(
      whatsappConfig.WHATSAPP_ACCESS_TOKEN
    )}`
  );

  if (response.timedOut) {
    return failure("WhatsApp verification timed out");
  }
  if (!response.ok) {
    return graphErrorCode(response.data) === 190
      ? failure("WhatsApp Cloud API is not connected.")
      : failure("WHATSAPP_TEMPLATE_NAME wrong");
  }

  const templates = ((response.data as {
    data?: Array<{
      name?: string;
      language?: string;
      status?: string;
      category?: string;
      components?: unknown[];
    }>;
  })?.data ?? []);
  const nameMatch = templates.filter((template) => template.name === config.WHATSAPP_TEMPLATE_NAME);
  if (!nameMatch.length) {
    return failure("WHATSAPP_TEMPLATE_NAME wrong");
  }
  const languageMatch = nameMatch.find((template) => template.language === config.WHATSAPP_TEMPLATE_LANGUAGE);
  if (!languageMatch) {
    return failure("WHATSAPP_TEMPLATE_LANGUAGE wrong");
  }
  if (languageMatch.status !== "APPROVED") {
    return failure("WhatsApp template is not approved");
  }

  return success("Broadcast & Campaign Templates connected successfully", {
    templateName: languageMatch.name,
    templateLanguage: languageMatch.language,
    templateStatus: languageMatch.status,
    category: languageMatch.category ?? null,
    componentCount: Array.isArray(languageMatch.components) ? languageMatch.components.length : 0
  });
}

async function verifyMetaAds(config: IntegrationConfig) {
  if (missingOrEmpty(config, "META_ADS_ACCESS_TOKEN") || config.META_ADS_ACCESS_TOKEN.length < 12) {
    return failure("META_ADS_ACCESS_TOKEN wrong");
  }
  if (missingOrEmpty(config, "META_AD_ACCOUNT_ID") || !/^act_\d{5,}$/.test(config.META_AD_ACCOUNT_ID)) {
    return failure("META_AD_ACCOUNT_ID wrong");
  }

  const response = await fetchJson(
    `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(
      config.META_AD_ACCOUNT_ID
    )}?fields=id,name,account_status,currency,timezone_name&access_token=${encodeURIComponent(config.META_ADS_ACCESS_TOKEN)}`
  );

  if (response.timedOut) {
    return failure("Meta Ads verification timed out");
  }
  if (!response.ok) {
    return graphErrorCode(response.data) === 190 ? failure("META_ADS_ACCESS_TOKEN wrong") : failure("META_AD_ACCOUNT_ID wrong");
  }

  const account = response.data as { id?: string; name?: string; account_status?: number; currency?: string; timezone_name?: string };
  return success("Meta Ads connected successfully", {
    adAccountId: account.id ?? config.META_AD_ACCOUNT_ID,
    adAccountName: account.name ?? "Meta ad account",
    adAccountStatus: account.account_status ?? null,
    currency: account.currency ?? null,
    timezone: account.timezone_name ?? null,
    lastVerifiedAt: new Date().toISOString()
  });
}

async function verifyKnowledgeBase(config: IntegrationConfig) {
  const hasWebsite = Boolean(config.COMPANY_WEBSITE_URL);
  const hasPdf = Boolean(config.PDF_FILE_NAME);

  if (!hasWebsite && !hasPdf) {
    return failure("Company website wrong");
  }

  if (hasWebsite) {
    if (!urlValid(config.COMPANY_WEBSITE_URL)) {
      return failure("Company website wrong");
    }
    const response = await fetchJson(config.COMPANY_WEBSITE_URL, { headers: { Accept: "text/html,text/plain" } });
    if (response.timedOut) {
      return failure("Knowledge base verification timed out");
    }
    if (!response.ok) {
      return failure("Company website wrong");
    }
    const readableText = response.text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (readableText.length < 20) {
      return failure("Company website wrong");
    }
    return success("Knowledge Base connected successfully", {
      sourceType: "website",
      documentCount: 1,
      knowledgeBaseStatus: "INDEXED"
    });
  }

  if (!config.PDF_FILE_NAME.toLowerCase().endsWith(".pdf")) {
    return failure("PDF file wrong");
  }

  return success("Knowledge Base connected successfully", {
    sourceType: "pdf",
    documentCount: 1,
    knowledgeBaseStatus: "UPLOADED"
  });
}

async function verifyAiModel(config: IntegrationConfig) {
  if (missingOrEmpty(config, "AI_PROVIDER")) {
    return failure("AI_API_KEY wrong");
  }
  if (missingOrEmpty(config, "AI_MODEL_NAME")) {
    return failure("AI_MODEL_NAME wrong");
  }
  if (missingOrEmpty(config, "AI_API_KEY") || config.AI_API_KEY.length < 8) {
    return failure("AI_API_KEY wrong");
  }

  const provider = config.AI_PROVIDER;
  let response: Awaited<ReturnType<typeof fetchJson>>;
  const providerKey = provider.trim().toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");

  if (providerKey === "ANTHROPIC") {
    response = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.AI_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.AI_MODEL_NAME,
        max_tokens: 4,
        messages: [{ role: "user", content: "Reply with OK." }]
      })
    });
  } else if (providerKey === "GEMINI") {
    response = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        config.AI_MODEL_NAME
      )}:generateContent?key=${encodeURIComponent(config.AI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with OK." }] }] })
      }
    );
  } else {
    const isCustom = providerKey === "CUSTOM_OPENAI_COMPATIBLE";
    if (providerKey !== "OPENAI" && !isCustom) {
      return failure("AI_PROVIDER wrong");
    }
    const baseUrl = isCustom ? config.AI_BASE_URL : "https://api.openai.com/v1";
    if (!baseUrl || !urlValid(baseUrl)) {
      return failure("AI_BASE_URL wrong");
    }
    response = await fetchJson(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.AI_API_KEY}`
      },
      body: JSON.stringify({
        model: config.AI_MODEL_NAME,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 4
      })
    });
  }

  if (response.timedOut) {
    return failure("AI model verification timed out");
  }
  if (response.status === 401 || response.status === 403) {
    return failure("AI_API_KEY wrong");
  }
  if (response.status === 404 || response.status === 400) {
    return failure("AI_MODEL_NAME wrong");
  }
  if (!response.ok) {
    return providerKey === "CUSTOM_OPENAI_COMPATIBLE" ? failure("AI_BASE_URL wrong") : failure("AI_API_KEY wrong");
  }

  return success("AI Model for Messaging connected successfully", {
    aiProvider: provider,
    aiModelName: config.AI_MODEL_NAME,
    lastVerifiedAt: new Date().toISOString()
  });
}

export async function verifyIntegrationConfig(type: IntegrationType, config: IntegrationConfig, options: VerifyOptions) {
  if (type === "AI_MODEL") {
    config.AI_PROVIDER ||= "Anthropic";
    config.AI_MODEL_NAME ||= "claude-sonnet-4-6";
  }

  const fields = INTEGRATION_CATALOG[type].fields;
  for (const field of fields) {
    if (field.required && missingOrEmpty(config, field.name)) {
      return failure(`${field.name} wrong`);
    }
  }

  if (type === "GOOGLE_SHEETS") return verifyGoogleSheets(config);
  if (type === "WHATSAPP_CLOUD") return verifyWhatsappCloud(config, options);
  if (type === "WHATSAPP_TEMPLATE_SETTINGS") return verifyTemplateSettings(config, options.dependencies);
  if (type === "META_ADS") return verifyMetaAds(config);
  if (type === "KNOWLEDGE_BASE") return verifyKnowledgeBase(config);
  return verifyAiModel(config);
}
