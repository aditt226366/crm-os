import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { companyPatchSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";
import { serializeFeature, serializeIntegration } from "@/lib/serializers";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    await requirePlatformAdmin(request);
    const { id } = await context.params;
    const company = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
            role: true,
            status: true,
            lastLoginAt: true,
            forcePasswordReset: true,
            createdAt: true,
            updatedAt: true
          }
        },
        features: { include: { updatedBy: true } },
        integrations: { include: { createdBy: true } }
      }
    });
    if (!company) {
      return json({ company: null }, { status: 404 });
    }
    return json({
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        plan: company.plan,
        status: company.status,
        createdAt: company.createdAt.toISOString(),
        updatedAt: company.updatedAt.toISOString(),
        deactivatedAt: company.deactivatedAt?.toISOString() ?? null,
        users: company.users.map((user) => ({
          ...user,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString()
        })),
        features: company.features.map(serializeFeature),
        integrations: company.integrations.map(serializeIntegration)
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await context.params;
    const body = companyPatchSchema.parse(await request.json());
    const oldValue = await prisma.tenant.findUnique({ where: { id } });
    const company = await prisma.tenant.update({
      where: { id },
      data: {
        name: body.name,
        slug: body.slug,
        plan: body.plan,
        status: body.status,
        deactivatedAt: body.status === "DEACTIVATED" ? new Date() : body.status === "ACTIVE" ? null : undefined
      }
    });
    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: id,
      action: "admin.company_updated",
      entityType: "Tenant",
      entityId: id,
      oldValue,
      newValue: body
    });
    return json({ company });
  } catch (error) {
    return errorResponse(error);
  }
}
