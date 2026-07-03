import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/security";

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
    oldValue: oldValue === undefined ? undefined : (oldValue as Prisma.InputJsonValue),
    newValue: newValue === undefined ? undefined : (newValue as Prisma.InputJsonValue),
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
  await prisma.auditLog.create({ data: auditLogData(input) });
}
