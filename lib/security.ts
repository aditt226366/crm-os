import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import sanitizeHtml from "sanitize-html";
import { env } from "@/lib/env";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function generateTemporaryPassword() {
  return `Crm-${crypto.randomBytes(5).toString("base64url")}-Temp9`;
}

export function sanitizeText(value: string) {
  return sanitizeHtml(value.trim(), {
    allowedTags: [],
    allowedAttributes: {}
  });
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encryptionKey() {
  return crypto.createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

export function encryptJson(value: unknown) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptJson<T>(value: string): T {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function encryptSecret(value: string) {
  return encryptJson({ value });
}

export function decryptSecret(value: string) {
  return decryptJson<{ value: string }>(value).value;
}

export function maskSecret(value: string) {
  if (!value) {
    return "not provided";
  }
  const visible = value.slice(-4);
  return `${"*".repeat(Math.max(8, value.length - 4))}${visible}`;
}

const secretKeyPattern = /(secret|token|key|password|credential|private|api_key|access_token|verify_token)/i;

export function scrubSecretsFromLogs<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => scrubSecretsFromLogs(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        secretKeyPattern.test(key) ? "[REDACTED]" : scrubSecretsFromLogs(entry)
      ])
    ) as T;
  }

  return value;
}

export function clientIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
