import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/security";

export async function writeAuditLog({
  request,
  actorUserId,
  tenantId,
  action,
  entityType,
  entityId,
  oldValue,
  newValue
}: {
  request?: NextRequest;
  actorUserId?: string | null;
  tenantId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId ?? null,
      tenantId: tenantId ?? null,
      action,
      entityType,
      entityId: entityId ?? null,
      oldValue: oldValue === undefined ? undefined : (oldValue as object),
      newValue: newValue === undefined ? undefined : (newValue as object),
      ipAddress: request ? clientIp(request.headers) : null,
      userAgent: request?.headers.get("user-agent") ?? null
    }
  });
}
