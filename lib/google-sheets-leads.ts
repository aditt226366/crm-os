import { SignJWT, importPKCS8 } from "jose";
import { ApiError } from "@/lib/api";
import type { IntegrationConfig } from "@/lib/integration-vault";
import { normalizePhoneE164 } from "@/lib/phone/normalizePhone";

export type SheetLead = {
  phone: string;
  name: string | null;
  status: string | null;
  statusColumnIndex: number | null;
  rowNumber: number;
  row: string[];
};

type SheetShape = {
  rows: string[][];
  phoneIndex: number | null;
  nameIndex: number | null;
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
  const statusIndex = findHeaderIndex(headers, [/^status$/, /message.*status/, /outreach/, /sent/]);
  const startsWithHeader = phoneIndex !== null || nameIndex !== null;
  const dataRows = startsWithHeader ? rows.slice(1) : rows;
  const defaultCountryCode = inferDefaultCountryCode(dataRows, phoneIndex);

  return {
    rows,
    phoneIndex,
    nameIndex,
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
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    leads.push({
      phone,
      name: cell(row, shape.nameIndex) || null,
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
  range = "A:Z",
  defaultStatus = "new"
}: {
  config: IntegrationConfig;
  range?: string;
  defaultStatus?: string;
}) {
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
  range = "A:Z",
  maxRows = 50
}: {
  config: IntegrationConfig;
  range?: string;
  maxRows?: number;
}) {
  const { values } = await readGoogleSheetValues({ config, range });
  return extractSheetLeads(values, maxRows);
}

export async function updateGoogleSheetLeadStatuses({
  config,
  range = "A:Z",
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
