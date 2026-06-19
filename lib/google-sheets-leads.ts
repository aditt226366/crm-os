import { SignJWT, importPKCS8 } from "jose";
import { ApiError } from "@/lib/api";
import type { IntegrationConfig } from "@/lib/integration-vault";
import { normalizePhone } from "@/lib/inbox";

export type SheetLead = {
  phone: string;
  name: string | null;
  status: string | null;
  statusColumnIndex: number | null;
  rowNumber: number;
  row: string[];
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

function phoneFromValue(value: string) {
  const compact = value.trim();
  if (!compact) return null;
  const digits = compact.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return normalizePhone(compact);
}

function inferPhone(row: string[], phoneIndex: number | null) {
  const headerValue = phoneFromValue(cell(row, phoneIndex));
  if (headerValue) return headerValue;

  for (const value of row) {
    const phone = phoneFromValue(String(value));
    if (phone) return phone;
  }

  return null;
}

export function extractSheetLeads(values: unknown[][], maxRows: number) {
  const rows = values.map((row) => row.map((value) => String(value ?? "")));
  if (!rows.length) return [];

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const phoneIndex = findHeaderIndex(headers, [/phone/, /mobile/, /whatsapp/, /^number$/, /contact/]);
  const nameIndex = findHeaderIndex(headers, [/^name$/, /customer/, /client/, /lead/]);
  const statusIndex = findHeaderIndex(headers, [/^status$/, /message.*status/, /outreach/, /sent/]);
  const startsWithHeader = phoneIndex !== null || nameIndex !== null;
  const dataRows = startsWithHeader ? rows.slice(1) : rows;
  const seen = new Set<string>();
  const leads: SheetLead[] = [];

  for (const [index, row] of dataRows.entries()) {
    const phone = inferPhone(row, phoneIndex);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    leads.push({
      phone,
      name: cell(row, nameIndex) || null,
      status: statusIndex === null ? null : cell(row, statusIndex) || null,
      statusColumnIndex: statusIndex,
      rowNumber: (startsWithHeader ? 2 : 1) + index,
      row
    });
    if (leads.length >= maxRows) break;
  }

  return leads;
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

  return extractSheetLeads(data?.values ?? [], maxRows);
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
  const results = [];

  for (const update of updates) {
    const cellRange = statusCellRange(range, update.rowNumber, update.statusColumnIndex);
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
        cellRange
      )}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          range: cellRange,
          majorDimension: "ROWS",
          values: [[update.status]]
        })
      }
    );
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!response.ok) {
      throw new ApiError(409, "GOOGLE_SHEETS_UPDATE_FAILED", data?.error?.message ?? "Google Sheets status update failed.");
    }
    results.push({ rowNumber: update.rowNumber, statusColumnIndex: update.statusColumnIndex, status: update.status });
  }

  return results;
}
