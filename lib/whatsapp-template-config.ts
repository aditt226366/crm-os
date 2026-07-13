export type WhatsAppTemplateVariableMode = "NUMBERED" | "NAMED";
// Welcome + scrap follow-up templates are now configured per sheet as drip steps
// (see lib/sheet-campaign-config.ts). The only remaining fixed role is the
// company-specific appointment follow-up (Global Skin Care).
export type WhatsAppTemplateRole = "APPOINTMENT_FOLLOWUP";

export type TemplateVariableConfig = {
  role: WhatsAppTemplateRole;
  name: string;
  language: string;
  variableMode: WhatsAppTemplateVariableMode;
  variables: Record<string, string>;
  fields: {
    name: string;
    language: string;
    variableMode: string;
    variables: string;
  };
};

const TEMPLATE_CONFIG = {
  // Company-specific (Global Skin Care): appointment follow-up template used to
  // remind a customer of the appointment extracted from their call transcript.
  APPOINTMENT_FOLLOWUP: {
    nameFields: ["APPOINTMENT_FOLLOWUP_TEMPLATE_NAME", "APPOINTMENT_TEMPLATE_NAME"],
    languageFields: [
      "APPOINTMENT_FOLLOWUP_TEMPLATE_LANGUAGE",
      "APPOINTMENT_TEMPLATE_LANGUAGE",
      "WHATSAPP_TEMPLATE_LANGUAGE"
    ],
    variableModeField: "APPOINTMENT_FOLLOWUP_VARIABLE_MODE",
    variablesField: "APPOINTMENT_FOLLOWUP_VARIABLES"
  }
} as const satisfies Record<
  WhatsAppTemplateRole,
  {
    nameFields: readonly string[];
    languageFields: readonly string[];
    variableModeField: string;
    variablesField: string;
  }
>;

function configValue(config: Record<string, string>, fields: readonly string[]) {
  for (const field of fields) {
    const value = config[field]?.trim();
    if (value) return { field, value };
  }
  return null;
}

export function normalizeTemplateVariableMode(value: string | undefined): WhatsAppTemplateVariableMode | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "NUMBERED" || normalized === "NAMED") return normalized;
  return null;
}

export function parseTemplateVariables(
  raw: string | undefined
): { ok: true; variables: Record<string, string> } | { ok: false; error: string } {
  if (!raw?.trim()) return { ok: false, error: "Variable mapping is required." };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Variable mapping must be a JSON object." };
    }
    const variables = Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : String(value ?? "").trim()])
        .filter(([key, value]) => key && value)
    );
    return Object.keys(variables).length
      ? { ok: true, variables }
      : { ok: false, error: "Variable mapping cannot be empty." };
  } catch {
    return { ok: false, error: "Variable mapping must be valid JSON." };
  }
}

export function templateVariableConfig(
  config: Record<string, string>,
  role: WhatsAppTemplateRole
): TemplateVariableConfig | null {
  const definition = TEMPLATE_CONFIG[role];
  const name = configValue(config, definition.nameFields);
  const language = configValue(config, definition.languageFields);
  if (!name || !language) return null;

  const variableMode = normalizeTemplateVariableMode(config[definition.variableModeField]);
  if (!variableMode) return null;

  const parsedVariables = parseTemplateVariables(config[definition.variablesField]);
  if (!parsedVariables.ok) return null;

  return {
    role,
    name: name.value,
    language: language.value,
    variableMode,
    variables: parsedVariables.variables,
    fields: {
      name: name.field,
      language: language.field,
      variableMode: definition.variableModeField,
      variables: definition.variablesField
    }
  };
}

export function templateConfigDefinition(role: WhatsAppTemplateRole) {
  return TEMPLATE_CONFIG[role];
}
