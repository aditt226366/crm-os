import { INTEGRATION_DEFINITIONS, type IntegrationType } from "@/lib/constants";

export type IntegrationFieldDefinition = {
  name: string;
  label: string;
  input: "text" | "url" | "password" | "password-textarea" | "textarea" | "select" | "file" | "sheet-campaigns";
  required?: boolean;
  secret?: boolean;
  sensitive?: boolean;
  group?: string;
  defaultValue?: string;
  helpText?: string;
  placeholder?: string;
  options?: string[];
  visibleWhen?: { field: string; value: string };
};

export type IntegrationCatalogItem = {
  type: IntegrationType;
  title: string;
  description: string;
  icon: "sheets" | "whatsapp" | "template" | "ads" | "knowledge" | "ai" | "voice";
  fields: IntegrationFieldDefinition[];
  helpText?: string;
  testConnection?: boolean;
};

export const INTEGRATION_CATALOG: Record<IntegrationType, IntegrationCatalogItem> = {
  GOOGLE_SHEETS: {
    type: "GOOGLE_SHEETS",
    title: INTEGRATION_DEFINITIONS.GOOGLE_SHEETS.name,
    description: INTEGRATION_DEFINITIONS.GOOGLE_SHEETS.description,
    icon: "sheets",
    helpText: "Share your Google Sheet with the service account email as Editor.",
    testConnection: true,
    fields: [
      { name: "GOOGLE_SHEETS_ID", label: "GOOGLE_SHEETS_ID", input: "text", required: true, sensitive: true },
      {
        name: "GOOGLE_SERVICE_ACCOUNT_EMAIL",
        label: "GOOGLE_SERVICE_ACCOUNT_EMAIL",
        input: "text",
        required: true,
        sensitive: true
      },
      {
        name: "GOOGLE_PRIVATE_KEY",
        label: "GOOGLE_PRIVATE_KEY",
        input: "password-textarea",
        required: true,
        secret: true,
        placeholder: "Paste private key. Escaped \\n keys are supported."
      }
    ]
  },
  WHATSAPP_CLOUD: {
    type: "WHATSAPP_CLOUD",
    title: INTEGRATION_DEFINITIONS.WHATSAPP_CLOUD.name,
    description: INTEGRATION_DEFINITIONS.WHATSAPP_CLOUD.description,
    icon: "whatsapp",
    testConnection: true,
    fields: [
      {
        name: "WHATSAPP_PHONE_NUMBER_ID",
        label: "WHATSAPP_PHONE_NUMBER_ID",
        input: "text",
        required: true,
        sensitive: true
      },
      {
        name: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        label: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        input: "text",
        required: true,
        sensitive: true
      },
      {
        name: "WHATSAPP_ACCESS_TOKEN",
        label: "WHATSAPP_ACCESS_TOKEN",
        input: "password-textarea",
        required: true,
        secret: true
      },
      {
        name: "WHATSAPP_VERIFY_TOKEN",
        label: "WHATSAPP_VERIFY_TOKEN",
        input: "password",
        required: true,
        secret: true
      }
    ]
  },
  WHATSAPP_TEMPLATE_SETTINGS: {
    type: "WHATSAPP_TEMPLATE_SETTINGS",
    title: INTEGRATION_DEFINITIONS.WHATSAPP_TEMPLATE_SETTINGS.name,
    description: INTEGRATION_DEFINITIONS.WHATSAPP_TEMPLATE_SETTINGS.description,
    icon: "template",
    testConnection: true,
    fields: [
      {
        name: "APPOINTMENT_FOLLOWUP_TEMPLATE_NAME",
        label: "Template name",
        input: "text",
        group: "Appointment Follow-up (Global Skin Care)",
        placeholder: "appointment_follow_up",
        helpText: "Optional. Approved Meta template used to follow up on an appointment detected from a call transcript. Only used for Global Skin Care."
      },
      {
        name: "APPOINTMENT_FOLLOWUP_TEMPLATE_LANGUAGE",
        label: "Language",
        input: "select",
        group: "Appointment Follow-up (Global Skin Care)",
        options: ["en_US", "en", "ar", "hi", "es", "fr"]
      },
      {
        name: "APPOINTMENT_FOLLOWUP_VARIABLE_MODE",
        label: "Variable mode",
        input: "select",
        group: "Appointment Follow-up (Global Skin Care)",
        options: ["NUMBERED", "NAMED"],
        helpText: "Variable format used by the approved appointment follow-up template."
      },
      {
        name: "APPOINTMENT_FOLLOWUP_VARIABLES",
        label: "Variable mapping",
        input: "textarea",
        group: "Appointment Follow-up (Global Skin Care)",
        placeholder: "{\"1\":\"lead.name\",\"2\":\"lead.appointment\"}",
        helpText: "JSON mapping from template variable key to a lead field. Use lead.appointment for the detected appointment date/time."
      },
      {
        name: "SHEET_CAMPAIGNS_JSON",
        label: "Sheet drip campaigns",
        input: "sheet-campaigns",
        group: "Sheet Drip Campaigns",
        helpText:
          "Map each source sheet (e.g. UG Leads, Online MBA Leads) to an ordered set of approved Meta templates. Leads are read from one combined sheet and routed to their sheet's template sequence."
      }
    ]
  },
  META_ADS: {
    type: "META_ADS",
    title: INTEGRATION_DEFINITIONS.META_ADS.name,
    description: INTEGRATION_DEFINITIONS.META_ADS.description,
    icon: "ads",
    testConnection: true,
    fields: [
      {
        name: "META_ADS_ACCESS_TOKEN",
        label: "META_ADS_ACCESS_TOKEN",
        input: "password-textarea",
        required: true,
        secret: true
      },
      { name: "META_AD_ACCOUNT_ID", label: "META_AD_ACCOUNT_ID", input: "text", required: true, sensitive: true }
    ]
  },
  KNOWLEDGE_BASE: {
    type: "KNOWLEDGE_BASE",
    title: INTEGRATION_DEFINITIONS.KNOWLEDGE_BASE.name,
    description: INTEGRATION_DEFINITIONS.KNOWLEDGE_BASE.description,
    icon: "knowledge",
    testConnection: true,
    fields: [
      {
        name: "COMPANY_WEBSITE_URL",
        label: "Company Website URL",
        input: "url",
        placeholder: "https://company.com"
      },
      {
        name: "PDF_FILE_NAME",
        label: "PDF file upload",
        input: "file",
        helpText: "PDF files only. File bytes are handled by the upload flow; this form stores tenant-scoped metadata."
      }
    ]
  },
  AI_MODEL: {
    type: "AI_MODEL",
    title: INTEGRATION_DEFINITIONS.AI_MODEL.name,
    description: INTEGRATION_DEFINITIONS.AI_MODEL.description,
    icon: "ai",
    testConnection: true,
    fields: [
      {
        name: "AI_PROVIDER",
        label: "AI_PROVIDER",
        input: "select",
        required: true,
        options: ["OpenAI", "Anthropic", "Gemini", "Custom OpenAI Compatible"]
      },
      { name: "AI_MODEL_NAME", label: "AI_MODEL_NAME", input: "text", required: true },
      { name: "AI_API_KEY", label: "AI_API_KEY", input: "password-textarea", required: true, secret: true },
      {
        name: "AI_BASE_URL",
        label: "AI_BASE_URL",
        input: "url",
        visibleWhen: { field: "AI_PROVIDER", value: "Custom OpenAI Compatible" }
      }
    ]
  },
  VOICE_AGENT: {
    type: "VOICE_AGENT",
    title: INTEGRATION_DEFINITIONS.VOICE_AGENT.name,
    description: INTEGRATION_DEFINITIONS.VOICE_AGENT.description,
    icon: "voice",
    helpText:
      "Outbound & inbound AI voice calls on a virtual Indian number. Point the Plivo number's Application answer/hangup URLs at /api/webhooks/plivo. Languages supported: English, Hindi, Tamil (female voice).",
    testConnection: true,
    fields: [
      {
        name: "PLIVO_AUTH_ID",
        label: "Plivo Auth ID",
        input: "text",
        required: true,
        sensitive: true,
        group: "Plivo (SIP Trunk)"
      },
      {
        name: "PLIVO_AUTH_TOKEN",
        label: "Plivo Auth Token",
        input: "password",
        required: true,
        secret: true,
        group: "Plivo (SIP Trunk)"
      },
      {
        name: "PLIVO_PHONE_NUMBER",
        label: "Virtual number (E.164)",
        input: "text",
        required: true,
        sensitive: true,
        group: "Plivo (SIP Trunk)",
        placeholder: "+9122XXXXXXXX",
        helpText: "The Plivo virtual Indian number. Used as the caller ID for outbound calls and to route inbound calls to this company."
      },
      {
        name: "SARVAM_API_KEY",
        label: "Sarvam API key",
        input: "password",
        required: true,
        secret: true,
        group: "Speech (Sarvam AI)",
        helpText: "Powers both Saarika (speech-to-text) and Bulbul (text-to-speech)."
      },
      {
        name: "DEFAULT_LANGUAGE",
        label: "Default language",
        input: "select",
        group: "Speech (Sarvam AI)",
        options: ["en-IN", "hi-IN", "ta-IN"],
        defaultValue: "en-IN",
        helpText: "English, Hindi, or Tamil. The agent auto-detects the caller's language and falls back to this."
      },
      {
        name: "TTS_VOICE",
        label: "Voice (female)",
        input: "select",
        group: "Speech (Sarvam AI)",
        options: ["anushka", "manisha", "vidya", "arya"],
        defaultValue: "anushka",
        helpText: "Bulbul female speaker."
      },
      {
        name: "ANTHROPIC_API_KEY",
        label: "Anthropic API key",
        input: "password",
        required: true,
        secret: true,
        group: "LLM (Claude)"
      },
      {
        name: "LLM_MODEL",
        label: "Claude model",
        input: "text",
        group: "LLM (Claude)",
        defaultValue: "claude-sonnet-4-6",
        placeholder: "claude-sonnet-4-6"
      },
      {
        name: "COMPANY_DISPLAY_NAME",
        label: "Company name",
        input: "text",
        required: true,
        group: "Agent Persona",
        helpText: "Spoken in the greeting, e.g. \"I'm the inquiry assistant from {company}\"."
      },
      {
        name: "OUTBOUND_GREETING",
        label: "Outbound greeting",
        input: "textarea",
        group: "Agent Persona",
        defaultValue:
          "Hi, I'm the inquiry assistant from {{company}}. Do you have two minutes to talk?",
        helpText: "Spoken first on outbound calls. Use {{company}} for the company name."
      },
      {
        name: "INBOUND_GREETING",
        label: "Inbound greeting",
        input: "textarea",
        group: "Agent Persona",
        defaultValue: "Hello, welcome to {{company}}. How may I help you?",
        helpText: "Spoken first when a customer calls in. Use {{company}} for the company name."
      },
      {
        name: "SYSTEM_PROMPT",
        label: "Agent instructions",
        input: "textarea",
        group: "Agent Persona",
        placeholder:
          "You are a friendly inquiry agent. Answer questions using the company knowledge base. Keep replies short and conversational.",
        helpText: "Persona and behaviour for the inquiry agent. The knowledge base is appended automatically."
      },
      {
        name: "MAX_CALL_SECONDS",
        label: "Max call length (seconds)",
        input: "text",
        group: "Agent Persona",
        defaultValue: "300"
      },
      {
        name: "USE_KNOWLEDGE_BASE",
        label: "Use knowledge base",
        input: "select",
        group: "Agent Persona",
        options: ["Yes", "No"],
        defaultValue: "Yes",
        helpText: "When Yes, the company Knowledge Base is injected so the agent answers from it."
      }
    ]
  }
};

export function integrationFields(type: IntegrationType) {
  return INTEGRATION_CATALOG[type].fields;
}

export function isSecretField(type: IntegrationType, fieldName: string) {
  return integrationFields(type).some((field) => field.name === fieldName && field.secret);
}

export function isSensitiveField(type: IntegrationType, fieldName: string) {
  return integrationFields(type).some((field) => field.name === fieldName && (field.secret || field.sensitive));
}
