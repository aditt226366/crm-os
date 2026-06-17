import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";

type AuditLogRow = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorUserId: string | null;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  oldValue: unknown | null;
  newValue: unknown | null;
  createdAt: Date;
};

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
  createdAt: true
} as const;

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: auditLogSelect
    });
    return json({
      logs: (logs as AuditLogRow[]).map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType ?? "UNKNOWN",
        entityId: log.entityId,
        actorUserId: log.actorUserId,
        tenantId: log.tenantId,
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
