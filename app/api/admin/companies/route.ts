import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { companyCreateSchema } from "@/lib/validation";
import { FEATURE_KEYS, INTEGRATION_TYPES, defaultEnabledFeatures } from "@/lib/constants";
import { generateTemporaryPassword, hashPassword, sanitizeText } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";
import { defaultMaskedDisplay } from "@/lib/integration-vault";

function serializeTenant(tenant: {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: Date;
  deactivatedAt: Date | null;
  users: Array<{ id: string; name: string; email: string; username: string; role: string; lastLoginAt: Date | null }>;
  features: Array<{ enabled: boolean }>;
}) {
  const owner = tenant.users.find((user) => user.role === "COMPANY_OWNER") ?? tenant.users[0];
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    deactivatedAt: tenant.deactivatedAt?.toISOString() ?? null,
    ownerEmail: owner?.email ?? "No owner",
    ownerUsername: owner?.username ?? "No owner",
    ownerName: owner?.name ?? "No owner",
    lastLoginAt: tenant.users
      .map((user) => user.lastLoginAt)
      .filter(Boolean)
      .sort((a, b) => b!.getTime() - a!.getTime())[0]
      ?.toISOString() ?? null,
    usersCount: tenant.users.length,
    enabledFeaturesCount: tenant.features.filter((feature) => feature.enabled).length
  };
}

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        users: true,
        features: true
      }
    });
    return json({ companies: tenants.map(serializeTenant) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requirePlatformAdmin(request);
    const body = companyCreateSchema.parse(await request.json());
    const temporaryPassword =
      body.temporaryPassword && body.temporaryPassword.length > 0
        ? body.temporaryPassword
        : generateTemporaryPassword();
    const enabled = defaultEnabledFeatures(body.plan);

    const tenant = await prisma.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: {
          name: sanitizeText(body.companyName),
          slug: sanitizeText(body.slug).toLowerCase(),
          plan: body.plan,
          status: body.status,
          deactivatedAt: body.status === "DEACTIVATED" ? new Date() : null
        }
      });

      await tx.user.create({
        data: {
          tenantId: createdTenant.id,
          name: sanitizeText(body.ownerName),
          email: sanitizeText(body.loginUsername).toLowerCase(),
          username: sanitizeText(body.loginUsername).toLowerCase(),
          passwordHash: await hashPassword(temporaryPassword),
          role: "COMPANY_OWNER",
          status: body.status === "ACTIVE" ? "ACTIVE" : "DEACTIVATED",
          forcePasswordReset: true
        }
      });

      await tx.tenantFeature.createMany({
        data: FEATURE_KEYS.map((featureKey) => ({
          tenantId: createdTenant.id,
          featureKey,
          enabled: enabled.has(featureKey),
          updatedById: admin.id
        }))
      });

      await tx.integration.createMany({
        data: INTEGRATION_TYPES.map((type) => ({
          tenantId: createdTenant.id,
          type,
          status: "NOT_CONNECTED",
          maskedDisplay: defaultMaskedDisplay(),
          createdById: admin.id,
          updatedById: admin.id
        }))
      });

      return createdTenant;
    });

    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: tenant.id,
      action: "admin.company_created",
      entityType: "Tenant",
      entityId: tenant.id,
      newValue: { slug: tenant.slug, plan: tenant.plan, status: tenant.status }
    });

    return json(
      {
        company: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          plan: tenant.plan,
          status: tenant.status
        },
        loginUsername: sanitizeText(body.loginUsername),
        temporaryPassword,
        loginUrl: "/login",
        warning: "This temporary password is shown only once."
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
