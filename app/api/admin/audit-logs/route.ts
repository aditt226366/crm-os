import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";

const auditLogSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  actorUserId: true,
  tenantId: true,
  ipAddress: true,
  userAgent: true,
  oldValue: true,
  newValue: true,
  createdAt: true,
  actor: {
    select: {
      name: true,
      email: true
    }
  },
  tenant: {
    select: {
      name: true
    }
  }
} satisfies Prisma.AuditLogSelect;

type AuditLogRow = Prisma.AuditLogGetPayload<{ select: typeof auditLogSelect }>;

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const logs: AuditLogRow[] = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: auditLogSelect
    });
    return json({
      logs: logs.map((log: AuditLogRow) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType || "UNKNOWN",
        entityId: log.entityId,
        actorUserId: log.actorUserId,
        tenantId: log.tenantId,
        company: log.tenant?.name ?? null,
        actor: log.actor?.name ?? log.actor?.email ?? "System",
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        oldValue: log.oldValue,
        newValue: log.newValue,
        createdAt: log.createdAt.toISOString()
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
