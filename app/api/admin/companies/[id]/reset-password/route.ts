import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { resetPasswordSchema } from "@/lib/validation";
import { generateTemporaryPassword, hashPassword } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await context.params;
    const body = resetPasswordSchema.parse(await request.json().catch(() => ({})));
    const temporaryPassword =
      body.temporaryPassword && body.temporaryPassword.length > 0
        ? body.temporaryPassword
        : generateTemporaryPassword();
    const owner = await prisma.user.findFirst({
      where: { tenantId: id, role: "COMPANY_OWNER" },
      orderBy: { createdAt: "asc" }
    });

    if (!owner) {
      return json({ error: { code: "OWNER_NOT_FOUND", message: "Company owner not found" } }, { status: 404 });
    }

    await prisma.user.update({
      where: { id: owner.id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        forcePasswordReset: true
      }
    });
    await prisma.refreshToken.updateMany({
      where: { user: { tenantId: id } },
      data: { revokedAt: new Date() }
    });
    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: id,
      action: "admin.company_password_reset",
      entityType: "User",
      entityId: owner.id
    });

    return json({
      ownerEmail: owner.email,
      loginUsername: owner.username,
      temporaryPassword,
      loginUrl: "/login",
      warning: "This temporary password is shown only once."
    });
  } catch (error) {
    return errorResponse(error);
  }
}
