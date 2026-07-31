import { SignJWT, importPKCS8 } from "jose";
import { ApiError } from "@/lib/api";
import type { IntegrationConfig } from "@/lib/integration-vault";
import { normalizePhoneE164 } from "@/lib/phone/normalizePhone";

export const CRM_LEADS_SHEET_NAME = "crm_leads";
export const CRM_LEADS_RANGE = `${CRM_LEADS_SHEET_NAME}!A:Z`;
export const DEFAULT_LEAD_SHEET_RANGE = "A:Z";

export type SheetLead = {
  phone: string;
  name: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  status: string | null;
  statusColumnIndex: number | null;
  rowNumber: number;
  row: string[];
};

type SheetShape = {
  rows: string[][];
  phoneIndex: number | null;
  nameIndex: number | null;
  sourceSheetIndex: number | null;
  sourceRowIndex: number | null;
  statusIndex: number | null;
  startsWithHeader: boolean;
  dataRows: string[][];
  defaultCountryCode: string | null;
};

function normalizePrivateKey(value: string) {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

async function googleAccessToken(config: IntegrationConfig) {
  const clientEmail = config.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = config.GOOGLE_PRIVATE_KEY ? normalizePrivateKey(config.GOOGLE_PRIVATE_KEY) : "";

  if (!clientEmail || !privateKey) {
    throw new ApiError(409, "GOOGLE_SHEETS_CONFIG_MISSING", "Google Sheets is not connected for this company.");
  }

  const key = await importPKCS8(privateKey, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = (await response.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;

  if (!response.ok || !data?.access_token) {
    throw new ApiError(409, "GOOGLE_SHEETS_AUTH_FAILED", data?.error_description ?? "Google Sheets authentication failed.");
  }

  return data.access_token;
}

function cell(row: string[], index: number | null) {
  return index === null ? "" : String(row[index] ?? "").trim();
}

function findHeaderIndex(headers: string[], patterns: RegExp[]) {
  const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header.trim().toLowerCase())));
  return index >= 0 ? index : null;
}

function a1Column(index: number) {
  let value = index + 1;
  let column = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

function sheetPrefix(range: string) {
  const bangIndex = range.indexOf("!");
  return bangIndex >= 0 ? `${range.slice(0, bangIndex)}!` : "";
}

function statusCellRange(range: string, rowNumber: number, statusColumnIndex: number) {
  return `${sheetPrefix(range)}${a1Column(statusColumnIndex)}${rowNumber}`;
}

function quoteSheetName(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function googleSheetTabRange(sheetName: string) {
  return `${quoteSheetName(sheetName.trim())}!A:Z`;
}

/** Normalizes an A1 range string (quotes, case) so two ranges can be compared for equality. */
export function normalizeSheetRangeKey(range: string) {
  return range.trim().toLowerCase().replace(/^'/, "").replace(/'!/, "!");
}

export function isCrmLeadsRange(range: string) {
  const normalized = normalizeSheetRangeKey(range);
  return normalized === CRM_LEADS_RANGE.toLowerCase() || normalized === `${CRM_LEADS_SHEET_NAME}!a:z`;
}

function parsePositiveInteger(value: string) {
  const numberValue = Number(value.trim());
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function sheetLeadDedupeKeys(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const last10 = digits.length >= 10 ? digits.slice(-10) : "";
  return [`phone:${phone}`, ...(last10 ? [`last10:${last10}`] : [])];
}

function explicitCountryCode(value: string) {
  const explicit = value.match(/\+\D*(\d[\d\s().-]{7,})/);
  if (!explicit) return null;

  const digits = explicit[1].replace(/\D/g, "");
  if (digits.length <= 10 || digits.length > 15) return null;
  return digits.slice(0, digits.length - 10);
}

function inferDefaultCountryCode(rows: string[][], phoneIndex: number | null) {
  const counts = new Map<string, number>();
  const candidates = phoneIndex === null ? rows.flat() : rows.map((row) => cell(row, phoneIndex));

  for (const value of candidates) {
    const countryCode = explicitCountryCode(String(value));
    if (!countryCode) continue;
    counts.set(countryCode, (counts.get(countryCode) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function phoneFromValue(value: string, defaultCountryCode: string | null) {
  const compact = value.trim();
  if (!compact) return null;
  const explicit = compact.match(/\+\D*(\d[\d\s().-]{7,})/);
  const digits = (explicit?.[1] ?? compact).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (!explicit && defaultCountryCode && digits.length === 10) {
    return normalizePhoneE164(`+${defaultCountryCode}${digits}`);
  }
  return normalizePhoneE164(explicit ? `+${digits}` : compact);
}

function inferPhone(row: string[], phoneIndex: number | null, defaultCountryCode: string | null) {
  const headerValue = phoneFromValue(cell(row, phoneIndex), defaultCountryCode);
  if (headerValue) return headerValue;

  for (const value of row) {
    const raw = String(value);
    if (!/^\s*(p|phone|mobile|whatsapp)\s*:/i.test(raw)) continue;
    const phone = phoneFromValue(raw, defaultCountryCode);
    if (phone) return phone;
  }

  // Only guess from arbitrary cells when the sheet has no phone column at all —
  // that is the headerless case this fallback exists for. When a phone column
  // IS present and holds nothing usable, the row genuinely has no phone.
  //
  // Scanning regardless is dangerous on a Meta Lead Ads export: form_id,
  // ad_id, adset_id and campaign_id are all 8-15 digit numbers, so a test lead
  // whose phone_number reads "<test lead: dummy data>" yielded +250632449983
  // from its form_id — a real, unrelated number that would then be messaged.
  if (phoneIndex !== null) return null;

  for (const value of row) {
    const phone = phoneFromValue(String(value), defaultCountryCode);
    if (phone) return phone;
  }

  return null;
}

function sheetShape(values: unknown[][]): SheetShape {
  const rows = values.map((row) => row.map((value) => String(value ?? "")));
  if (!rows.length) {
    return {
      rows,
      phoneIndex: null,
      nameIndex: null,
      sourceSheetIndex: null,
      sourceRowIndex: null,
      statusIndex: null,
      startsWithHeader: false,
      dataRows: [],
      defaultCountryCode: null
    };
  }

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const phoneIndex = findHeaderIndex(headers, [/phone/, /mobile/, /whatsapp/, /^number$/, /contact.*number/]);
  const nameIndex = findHeaderIndex(headers, [
    /^name$/,
    /full[_\s-]*name/,
    /customer[_\s-]*name/,
    /client[_\s-]*name/,
    /contact[_\s-]*name/
  ]);
  const sourceSheetIndex = findHeaderIndex(headers, [
    /^source[_\s-]*sheet$/,
    /^source[_\s-]*tab$/,
    /^sheet[_\s-]*source$/,
    /^lead[_\s-]*source[_\s-]*sheet$/
  ]);
  const sourceRowIndex = findHeaderIndex(headers, [
    /^source[_\s-]*row$/,
    /^source[_\s-]*row[_\s-]*number$/,
    /^original[_\s-]*row$/,
    /^row[_\s-]*source$/
  ]);
  const statusIndex = findHeaderIndex(headers, [/^status$/, /message.*status/, /outreach/, /sent/]);
  const startsWithHeader = phoneIndex !== null || nameIndex !== null;
  const dataRows = startsWithHeader ? rows.slice(1) : rows;
  const defaultCountryCode = inferDefaultCountryCode(dataRows, phoneIndex);

  return {
    rows,
    phoneIndex,
    nameIndex,
    sourceSheetIndex,
    sourceRowIndex,
    statusIndex,
    startsWithHeader,
    dataRows,
    defaultCountryCode
  };
}

export function extractSheetLeads(values: unknown[][], maxRows: number) {
  const shape = sheetShape(values);
  if (!shape.rows.length) return [];
  const seen = new Set<string>();
  const leads: SheetLead[] = [];

  for (const [index, row] of shape.dataRows.entries()) {
    const phone = inferPhone(row, shape.phoneIndex, shape.defaultCountryCode);
    if (!phone) continue;
    const dedupeKeys = sheetLeadDedupeKeys(phone);
    if (dedupeKeys.some((key) => seen.has(key))) continue;
    dedupeKeys.forEach((key) => seen.add(key));
    leads.push({
      phone,
      name: cell(row, shape.nameIndex) || null,
      sourceSheet: cell(row, shape.sourceSheetIndex) || null,
      sourceRow: parsePositiveInteger(cell(row, shape.sourceRowIndex)),
      status: shape.statusIndex === null ? null : cell(row, shape.statusIndex) || null,
      statusColumnIndex: shape.statusIndex,
      rowNumber: (shape.startsWithHeader ? 2 : 1) + index,
      row
    });
    if (leads.length >= maxRows) break;
  }

  return leads;
}

async function readGoogleSheetValues({
  config,
  range
}: {
  config: IntegrationConfig;
  range: string;
}) {
  const spreadsheetId = config.GOOGLE_SHEETS_ID?.trim();
  if (!spreadsheetId) {
    throw new ApiError(409, "GOOGLE_SHEETS_ID_MISSING", "GOOGLE_SHEETS_ID wrong");
  }

  const token = await googleAccessToken(config);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = (await response.json().catch(() => null)) as { values?: unknown[][]; error?: { message?: string } } | null;

  if (!response.ok) {
    throw new ApiError(409, "GOOGLE_SHEETS_READ_FAILED", data?.error?.message ?? "GOOGLE_SHEETS_ID wrong");
  }

  return { spreadsheetId, token, values: data?.values ?? [] };
}

async function putGoogleSheetValues({
  spreadsheetId,
  token,
  range,
  values
}: {
  spreadsheetId: string;
  token: string;
  range: string;
  values: string[][];
}) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range
    )}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values
      })
    }
  );
  const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) {
    throw new ApiError(409, "GOOGLE_SHEETS_UPDATE_FAILED", data?.error?.message ?? "Google Sheets update failed.");
  }
}

async function batchPutGoogleSheetValues({
  spreadsheetId,
  token,
  data
}: {
  spreadsheetId: string;
  token: string;
  data: Array<{ range: string; values: string[][] }>;
}) {
  if (!data.length) return;

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: data.map((item) => ({
          range: item.range,
          majorDimension: "ROWS",
          values: item.values
        }))
      })
    }
  );
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) {
    throw new ApiError(409, "GOOGLE_SHEETS_UPDATE_FAILED", body?.error?.message ?? "Google Sheets update failed.");
  }
}

export async function ensureGoogleSheetStatusColumn({
  config,
  range = DEFAULT_LEAD_SHEET_RANGE,
  defaultStatus = "new"
}: {
  config: IntegrationConfig;
  range?: string;
  defaultStatus?: string;
}) {
  // Never stamp status into crm_leads: it is produced by a spill array formula
  // that owns its output cells, so any write there throws
  // "Array result was not expanded because it would overwrite data".
  if (isCrmLeadsRange(range)) {
    return { statusColumnIndex: null, initializedRows: 0 };
  }
  const { spreadsheetId, token, values } = await readGoogleSheetValues({ config, range });
  const shape = sheetShape(values);
  if (!shape.rows.length) {
    return { statusColumnIndex: null, initializedRows: 0 };
  }

  const statusColumnIndex =
    shape.statusIndex ??
    Math.max(
      shape.rows[0]?.length ?? 0,
      ...shape.rows.map((row) => row.length)
    );
  const updates: Array<{ rowNumber: number; status: string }> = [];

  if (shape.statusIndex === null && shape.startsWithHeader) {
    await putGoogleSheetValues({
      spreadsheetId,
      token,
      range: statusCellRange(range, 1, statusColumnIndex),
      values: [["STATUS"]]
    });
  }

  for (const [index, row] of shape.dataRows.entries()) {
    const phone = inferPhone(row, shape.phoneIndex, shape.defaultCountryCode);
    if (!phone) continue;
    const current = cell(row, shape.statusIndex ?? statusColumnIndex);
    if (current) continue;
    updates.push({
      rowNumber: (shape.startsWithHeader ? 2 : 1) + index,
      status: defaultStatus
    });
  }

  await batchPutGoogleSheetValues({
    spreadsheetId,
    token,
    data: updates.map((update) => ({
      range: statusCellRange(range, update.rowNumber, statusColumnIndex),
      values: [[update.status]]
    }))
  });

  return { statusColumnIndex, initializedRows: updates.length };
}

export async function readGoogleSheetLeads({
  config,
  range = DEFAULT_LEAD_SHEET_RANGE,
  maxRows = 50
}: {
  config: IntegrationConfig;
  range?: string;
  maxRows?: number;
}) {
  const { values } = await readGoogleSheetValues({ config, range });
  return extractSheetLeads(values, maxRows);
}

/**
 * Read a tab as a raw table: the first row is treated as headers and the rest as
 * data rows (1-indexed by their real sheet row number). Used by callers that need
 * arbitrary columns (e.g. call transcripts) rather than the lead-shaped extractor.
 */
export async function readGoogleSheetTable({
  config,
  range
}: {
  config: IntegrationConfig;
  range: string;
}): Promise<{
  headers: string[];
  rows: Array<{ rowNumber: number; cells: string[] }>;
}> {
  const { values } = await readGoogleSheetValues({ config, range });
  if (!values.length) {
    return { headers: [], rows: [] };
  }
  const headers = values[0].map((value) => String(value ?? ""));
  const rows = values.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    cells: row.map((value) => String(value ?? ""))
  }));
  return { headers, rows };
}

export async function updateGoogleSheetLeadStatuses({
  config,
  range = DEFAULT_LEAD_SHEET_RANGE,
  updates
}: {
  config: IntegrationConfig;
  range?: string;
  updates: Array<{ rowNumber: number; statusColumnIndex: number; status: string }>;
}) {
  const spreadsheetId = config.GOOGLE_SHEETS_ID?.trim();
  if (!spreadsheetId || !updates.length) {
    return [];
  }

  // Guard: crm_leads is spill-formula output and must never be written to.
  if (isCrmLeadsRange(range)) {
    return [];
  }

  const token = await googleAccessToken(config);
  await batchPutGoogleSheetValues({
    spreadsheetId,
    token,
    data: updates.map((update) => ({
      range: statusCellRange(range, update.rowNumber, update.statusColumnIndex),
      values: [[update.status]]
    }))
  });

  return updates.map((update) => ({
    rowNumber: update.rowNumber,
    statusColumnIndex: update.statusColumnIndex,
    status: update.status
  }));
}
