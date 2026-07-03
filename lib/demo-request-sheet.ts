import { promises as fs } from "node:fs";
import path from "node:path";
import { SignJWT, importPKCS8 } from "jose";
import { z } from "zod";

/**
 * Storage for public "Request a demo" submissions.
 *
 * As of now the "database" is a Google Sheet in the founder's Google Drive.
 * The service-account credentials + sheet id are read from env (see
 * `.env.example`). Until those are supplied, submissions fall back to a local
 * JSONL file so the form is fully functional in development.
 */

export const demoRequestSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  companyName: z.string().trim().min(1, "Company name is required").max(160),
  email: z.string().trim().email("Enter a valid email").max(160),
  contact: z.string().trim().min(6, "Enter a valid contact number").max(40),
  country: z.string().trim().min(1, "Country is required").max(80),
  gstNumber: z.string().trim().max(40).optional().default("")
});

export type DemoRequestInput = z.infer<typeof demoRequestSchema>;

const SHEET_TAB = process.env.DEMO_REQUEST_SHEET_TAB?.trim() || "Demo Requests";
const HEADER = ["Timestamp", "Name", "Company", "Email", "Contact", "Country", "GST Number"];

function sheetConfig() {
  const spreadsheetId = process.env.DEMO_REQUEST_SHEET_ID?.trim();
  const clientEmail = process.env.DEMO_REQUEST_GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(process.env.DEMO_REQUEST_GOOGLE_PRIVATE_KEY ?? "");
  if (!spreadsheetId || !clientEmail || !privateKey) return null;
  return { spreadsheetId, clientEmail, privateKey };
}

function normalizePrivateKey(value: string) {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

async function googleAccessToken(clientEmail: string, privateKey: string) {
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
  const data = (await response.json().catch(() => null)) as
    | { access_token?: string; error_description?: string }
    | null;

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description ?? "Google authentication failed");
  }
  return data.access_token;
}

async function appendToSheet(input: DemoRequestInput, config: NonNullable<ReturnType<typeof sheetConfig>>) {
  const token = await googleAccessToken(config.clientEmail, config.privateKey);
  const row = [
    new Date().toISOString(),
    input.name,
    input.companyName,
    input.email,
    input.contact,
    input.country,
    input.gstNumber
  ];

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(
      `${SHEET_TAB}!A:G`
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ majorDimension: "ROWS", values: [row] })
    }
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Failed to write to Google Sheets");
  }
}

async function appendToLocalFile(input: DemoRequestInput) {
  const dir = path.join(process.cwd(), ".data");
  await fs.mkdir(dir, { recursive: true });
  const line = JSON.stringify({ ...input, header: HEADER, createdAt: new Date().toISOString() });
  await fs.appendFile(path.join(dir, "demo-requests.jsonl"), `${line}\n`, "utf8");
}

export async function storeDemoRequest(input: DemoRequestInput): Promise<{ storedIn: "sheet" | "file" }> {
  const config = sheetConfig();
  if (config) {
    await appendToSheet(input, config);
    return { storedIn: "sheet" };
  }
  await appendToLocalFile(input);
  return { storedIn: "file" };
}
