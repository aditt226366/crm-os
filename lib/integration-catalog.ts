import { INTEGRATION_DEFINITIONS, type IntegrationType } from "@/lib/constants";

export type IntegrationFieldDefinition = {
  name: string;
  label: string;
  input: "text" | "url" | "password" | "password-textarea" | "textarea" | "select" | "file";
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
  icon: "sheets" | "whatsapp" | "template" | "ads" | "knowledge" | "ai";
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
        name: "MAIN_TEMPLATE_NAME",
        label: "Template name",
        input: "text",
        required: true,
        group: "Main Welcome Template",
        placeholder: "welcome_message"
      },
      {
        name: "MAIN_TEMPLATE_LANGUAGE",
        label: "Language",
        input: "select",
        required: true,
        group: "Main Welcome Template",
        options: ["en_US", "en", "ar", "hi", "es", "fr"]
      },
      {
        name: "MAIN_TEMPLATE_VARIABLE_MODE",
        label: "Variable mode",
        input: "select",
        required: true,
        group: "Main Welcome Template",
        options: ["NUMBERED", "NAMED"],
        defaultValue: "NUMBERED",
        helpText: "Printwear welcome template uses NUMBERED variables like {{1}}."
      },
      {
        name: "MAIN_TEMPLATE_VARIABLES",
        label: "Variable mapping",
        input: "textarea",
        required: true,
        group: "Main Welcome Template",
        defaultValue: "{\"1\":\"lead.name\"}",
        placeholder: "{\"1\":\"lead.name\"}",
        helpText: "JSON mapping. For Printwear: 1 -> lead.name."
      },
      {
        name: "SCRAP_FOLLOWUP_1_TEMPLATE_NAME",
        label: "Template name",
        input: "text",
        required: true,
        group: "Scrap Follow-up Day 1",
        defaultValue: "scrap_follow_up_1",
        placeholder: "scrap_follow_up_1",
        helpText: "Approved Meta template for Scrap leads with no reply after 24 hours."
      },
      {
        name: "SCRAP_FOLLOWUP_1_TEMPLATE_LANGUAGE",
        label: "Language",
        input: "select",
        required: true,
        group: "Scrap Follow-up Day 1",
        options: ["en_US", "en", "ar", "hi", "es", "fr"]
      },
      {
        name: "SCRAP_FOLLOWUP_1_VARIABLE_MODE",
        label: "Variable mode",
        input: "select",
        required: true,
        group: "Scrap Follow-up Day 1",
        options: ["NUMBERED", "NAMED"],
        defaultValue: "NAMED",
        helpText: "Printwear Scrap follow-up 1 uses NAMED variables like {{customer_name}}."
      },
      {
        name: "SCRAP_FOLLOWUP_1_VARIABLES",
        label: "Variable mapping",
        input: "textarea",
        required: true,
        group: "Scrap Follow-up Day 1",
        defaultValue: "{\"customer_name\":\"lead.name\"}",
        placeholder: "{\"customer_name\":\"lead.name\"}",
        helpText: "JSON mapping. For Printwear: customer_name -> lead.name."
      },
      {
        name: "SCRAP_FOLLOWUP_2_TEMPLATE_NAME",
        label: "Template name",
        input: "text",
        required: true,
        group: "Scrap Follow-up Day 2",
        defaultValue: "scrap_follow_up_2",
        placeholder: "scrap_follow_up_2",
        helpText: "Approved Meta template for the final Scrap lead follow-up."
      },
      {
        name: "SCRAP_FOLLOWUP_2_TEMPLATE_LANGUAGE",
        label: "Language",
        input: "select",
        required: true,
        group: "Scrap Follow-up Day 2",
        options: ["en_US", "en", "ar", "hi", "es", "fr"]
      },
      {
        name: "SCRAP_FOLLOWUP_2_VARIABLE_MODE",
        label: "Variable mode",
        input: "select",
        required: true,
        group: "Scrap Follow-up Day 2",
        options: ["NUMBERED", "NAMED"],
        defaultValue: "NAMED",
        helpText: "Printwear Scrap follow-up 2 uses NAMED variables like {{customer_name}}."
      },
      {
        name: "SCRAP_FOLLOWUP_2_VARIABLES",
        label: "Variable mapping",
        input: "textarea",
        required: true,
        group: "Scrap Follow-up Day 2",
        defaultValue: "{\"customer_name\":\"lead.name\"}",
        placeholder: "{\"customer_name\":\"lead.name\"}",
        helpText: "JSON mapping. For Printwear: customer_name -> lead.name."
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
