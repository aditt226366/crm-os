import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { getAuthUser } from "@/lib/auth";
import type { FeatureKey } from "@/lib/constants";

export async function requireAuth(request: NextRequest) {
  return getAuthUser(request);
}

export async function requirePlatformAdmin(request: NextRequest) {
  const user = await requireAuth(request);
  if (user.role !== "PLATFORM_ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Platform admin access required");
  }
  return user;
}

export async function requireTenantUser(request: NextRequest) {
  const user = await requireAuth(request);
  if (user.role === "PLATFORM_ADMIN" || !user.tenantId) {
    throw new ApiError(403, "TENANT_USER_REQUIRED", "Company user access required");
  }
  return user;
}

export async function requireActiveTenant(request: NextRequest) {
  const user = await requireTenantUser(request);
  if (!user.tenant || user.tenant.status !== "ACTIVE") {
    throw new ApiError(403, "TENANT_DEACTIVATED", "Company deactivated. Contact platform admin.");
  }
  return user;
}

export async function requireFeature(request: NextRequest, featureKey: FeatureKey) {
  const user = await requireActiveTenant(request);
  const feature = await prisma.tenantFeature.findUnique({
    where: {
      tenantId_featureKey: {
        tenantId: user.tenantId!,
        featureKey
      }
    }
  });

  if (!feature?.enabled) {
    throw new ApiError(403, "FEATURE_DISABLED", "Feature not enabled for your company");
  }

  return { user, feature };
}
