import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { actor: true, tenant: true }
    });
    return json({
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        company: log.tenant?.name ?? null,
        actor: log.actor?.name ?? "System",
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString()
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
