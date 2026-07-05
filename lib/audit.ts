import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clientIp, scrubSecretsFromLogs } from "@/lib/security";

type AuditLogInput = {
  request?: NextRequest;
  actorUserId?: string | null;
  tenantId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
};

const MAX_AUDIT_JSON_BYTES = 8 * 1024;

function compactAuditValue(value: unknown) {
  if (value === undefined) return undefined;
  const scrubbed = scrubSecretsFromLogs(value);
  try {
    const raw = JSON.stringify(scrubbed);
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes <= MAX_AUDIT_JSON_BYTES) {
      return scrubbed as Prisma.InputJsonValue;
    }
    return {
      truncated: true,
      originalBytes: bytes,
      preview: raw.slice(0, 1200)
    } satisfies Prisma.InputJsonObject;
  } catch {
    return {
      summary: String(scrubbed).slice(0, 1200)
    } satisfies Prisma.InputJsonObject;
  }
}

function auditLogData({
  request,
  actorUserId,
  tenantId,
  action,
  entityType,
  entityId,
  oldValue,
  newValue
}: AuditLogInput): Prisma.AuditLogUncheckedCreateInput {
  return {
    actorUserId: actorUserId ?? null,
    tenantId: tenantId ?? null,
    action,
    entityType: entityType ?? null,
    entityId: entityId ?? null,
    oldValue: compactAuditValue(oldValue),
    newValue: compactAuditValue(newValue),
    ipAddress: request ? clientIp(request.headers) : null,
    userAgent: request?.headers.get("user-agent") ?? null
  };
}

function errorDetails(error: unknown) {
  const details = error as { code?: unknown; meta?: unknown; message?: unknown };
  return {
    prismaCode: typeof details.code === "string" ? details.code : undefined,
    prismaMeta: details.meta,
    message: typeof details.message === "string" ? details.message : String(error)
  };
}

export async function safeCreateAuditLog(data: AuditLogInput | Prisma.AuditLogUncheckedCreateInput) {
  try {
    await prisma.auditLog.create({
      data: "action" in data && "request" in data ? auditLogData(data) : (data as Prisma.AuditLogUncheckedCreateInput)
    });
  } catch (error) {
    console.error("[audit.safe] failed", errorDetails(error));
  }
}

export async function writeAuditLog(input: AuditLogInput) {
  await safeCreateAuditLog(input);
}
