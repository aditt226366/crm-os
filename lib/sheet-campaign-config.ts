import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/security";
import { normalizeTemplateVariableMode, type WhatsAppTemplateVariableMode } from "@/lib/whatsapp-template-config";

/**
 * Per-tenant, per-sheet drip campaign configuration.
 *
 * Any company can map each of its source sheets (e.g. "UG Leads",
 * "Online MBA Leads") to an ordered set of Meta-approved WhatsApp templates.
 * Leads are read from ONE combined sheet (default "crm_leads") where each row
 * carries a source_sheet; the engine routes each lead to that sheet's template
 * set and sends the templates (with variable mappings) as a delayed sequence.
 *
 * This replaces the previously hard-coded source-campaign definitions. The
 * config is stored as a JSON string under the SHEET_CAMPAIGNS_JSON key of the
 * WHATSAPP_TEMPLATE_SETTINGS integration so it can hold an arbitrary number of
 * sheets and templates.
 */

export const SHEET_CAMPAIGNS_CONFIG_FIELD = "SHEET_CAMPAIGNS_JSON";
export const DEFAULT_COMBINED_SHEET = "crm_leads";

export type SheetCampaignTemplate = {
  name: string;
  language: string;
  delayDays: number;
  variableMode: WhatsAppTemplateVariableMode;
  variables: Record<string, string>;
};

export type SheetCampaign = {
  sheetName: string;
  templates: SheetCampaignTemplate[];
};

export type SheetCampaignConfig = {
  combinedSheet: string;
  sheets: SheetCampaign[];
};

function normalizeKey(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Strips ALL whitespace/punctuation so cosmetic typos in the admin panel (e.g.
// configuring "UGLeads" while the actual Google Sheet tab is "UG Leads") still
// route correctly. Only used as a fallback after an exact match fails.
function looseKey(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseVariables(raw: unknown): Record<string, string> {
  const record = asRecord(raw);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const trimmedKey = key.trim();
    const trimmedValue = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (trimmedKey && trimmedValue) out[trimmedKey] = trimmedValue;
  }
  return out;
}

function parseTemplate(raw: unknown): SheetCampaignTemplate | null {
  const record = asRecord(raw);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return null;
  const language = (typeof record.language === "string" && record.language.trim()) || "en";
  const delayDaysValue = typeof record.delayDays === "number" ? record.delayDays : Number(record.delayDays);
  const delayDays = Number.isFinite(delayDaysValue) && delayDaysValue >= 0 ? Math.floor(delayDaysValue) : 0;
  const variableMode =
    normalizeTemplateVariableMode(typeof record.variableMode === "string" ? record.variableMode : undefined) ?? "NUMBERED";
  return { name, language, delayDays, variableMode, variables: parseVariables(record.variables) };
}

/** Parse and validate the stored SHEET_CAMPAIGNS_JSON string. Returns null when absent/empty/invalid. */
export function parseSheetCampaignsConfig(raw: string | null | undefined): SheetCampaignConfig | null {
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  const combinedSheet = (typeof record.combinedSheet === "string" && record.combinedSheet.trim()) || DEFAULT_COMBINED_SHEET;
  const sheetsRaw = Array.isArray(record.sheets) ? record.sheets : [];
  const sheets: SheetCampaign[] = [];
  const seen = new Set<string>();

  for (const sheetRaw of sheetsRaw) {
    const sheetRecord = asRecord(sheetRaw);
    const sheetName = typeof sheetRecord.sheetName === "string" ? sheetRecord.sheetName.trim() : "";
    if (!sheetName) continue;
    const key = normalizeKey(sheetName);
    if (seen.has(key)) continue;
    const templatesRaw = Array.isArray(sheetRecord.templates) ? sheetRecord.templates : [];
    const templates = templatesRaw
      .map(parseTemplate)
      .filter((template): template is SheetCampaignTemplate => Boolean(template))
      .sort((left, right) => left.delayDays - right.delayDays);
    if (!templates.length) continue;
    seen.add(key);
    sheets.push({ sheetName, templates });
  }

  if (!sheets.length) return null;
  return { combinedSheet, sheets };
}

export function sheetCampaignForSheet(
  config: SheetCampaignConfig | null,
  sheetName: string | null | undefined
): SheetCampaign | null {
  if (!config) return null;
  const key = normalizeKey(sheetName);
  if (!key) return null;

  const exact = config.sheets.find((sheet) => normalizeKey(sheet.sheetName) === key);
  if (exact) return exact;

  // Fallback: match ignoring spaces/punctuation, e.g. the admin panel has
  // "UGLeads" configured but the Google Sheet tab (and source_sheet column) is
  // actually "UG Leads".
  const loose = looseKey(sheetName);
  if (!loose) return null;
  return config.sheets.find((sheet) => looseKey(sheet.sheetName) === loose) ?? null;
}

export function isConfiguredSheet(config: SheetCampaignConfig | null, sheetName: string | null | undefined) {
  return Boolean(sheetCampaignForSheet(config, sheetName));
}

/**
 * True when the tenant has exactly one sheet configured. A single-sheet
 * company reads and writes that sheet directly — every lead implicitly
 * belongs to it, and there is no separate read-only merged/combined tab.
 */
export function isSingleSheetMode(config: SheetCampaignConfig | null) {
  return Boolean(config && config.sheets.length === 1);
}

export function singleSheetName(config: SheetCampaignConfig | null): string | null {
  return isSingleSheetMode(config) ? (config as SheetCampaignConfig).sheets[0].sheetName : null;
}

export function canonicalSheetName(config: SheetCampaignConfig | null, sheetName: string | null | undefined) {
  // Prefer the incoming sheetName: it comes straight from the lead's
  // source_sheet column, i.e. the real Google Sheet tab name. The configured
  // label can differ cosmetically (see the loose-match fallback above), and
  // using the wrong one here would make status write-back target a tab that
  // doesn't exist.
  return sheetName?.trim() || sheetCampaignForSheet(config, sheetName)?.sheetName || null;
}

export function combinedSheetName(config: SheetCampaignConfig | null) {
  return config?.combinedSheet?.trim() || DEFAULT_COMBINED_SHEET;
}

/** Stable campaign key derived from a sheet name (unique per tenant). */
export function sheetCampaignKey(sheetName: string) {
  return `sheet:${normalizeKey(sheetName)}`;
}

/** All distinct templates across all sheets (used for Meta approval verification). */
export function allSheetCampaignTemplates(config: SheetCampaignConfig | null): SheetCampaignTemplate[] {
  if (!config) return [];
  const byKey = new Map<string, SheetCampaignTemplate>();
  for (const sheet of config.sheets) {
    for (const template of sheet.templates) {
      byKey.set(`${template.name}::${template.language}`, template);
    }
  }
  return Array.from(byKey.values());
}

/** Read the raw SHEET_CAMPAIGNS_JSON string out of an encrypted integration config. */
export function readSheetCampaignsField(encryptedConfig: unknown): string | null {
  if (typeof encryptedConfig !== "string" || !encryptedConfig.trim()) return null;
  try {
    const decoded = decryptJson<Record<string, unknown>>(encryptedConfig);
    const value = decoded[SHEET_CAMPAIGNS_CONFIG_FIELD];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Load and parse the tenant's sheet-campaign config from the WHATSAPP_TEMPLATE_SETTINGS integration. */
export async function loadSheetCampaignConfig(tenantId: string): Promise<SheetCampaignConfig | null> {
  const integration = await prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type: "WHATSAPP_TEMPLATE_SETTINGS" } },
    select: { encryptedConfig: true }
  });
  if (!integration) return null;
  return parseSheetCampaignsConfig(readSheetCampaignsField(integration.encryptedConfig));
}
