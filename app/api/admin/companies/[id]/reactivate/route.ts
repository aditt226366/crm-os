import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await context.params;
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id },
        data: { status: "ACTIVE", deactivatedAt: null }
      }),
      prisma.user.updateMany({
        where: { tenantId: id },
        data: { status: "ACTIVE" }
      })
    ]);
    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: id,
      action: "admin.company_reactivated",
      entityType: "Tenant",
      entityId: id
    });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
