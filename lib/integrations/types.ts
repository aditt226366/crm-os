import { INTEGRATION_TYPES, type IntegrationType } from "@/lib/constants";

export const IntegrationTypeMap = {
  "google-sheets": "GOOGLE_SHEETS",
  "whatsapp-cloud": "WHATSAPP_CLOUD",
  "whatsapp-template-settings": "WHATSAPP_TEMPLATE_SETTINGS",
  "meta-ads": "META_ADS",
  "knowledge-base": "KNOWLEDGE_BASE",
  "ai-model": "AI_MODEL"
} as const;

const allowed = new Set<string>(INTEGRATION_TYPES);

export class IntegrationError extends Error {
  constructor(
    message: string,
    public code = "INTEGRATION_ERROR",
    public status = 400,
    public field?: string
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export function normalizeIntegrationType(input: string): IntegrationType {
  const normalized = input.trim();
  const mapped = IntegrationTypeMap[normalized as keyof typeof IntegrationTypeMap];
  if (mapped) {
    return mapped;
  }

  const upper = normalized.toUpperCase().replaceAll("-", "_");
  if (allowed.has(upper)) {
    return upper as IntegrationType;
  }

  throw new IntegrationError("Invalid integration type", "INVALID_INTEGRATION_TYPE", 400);
}
