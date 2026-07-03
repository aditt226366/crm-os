import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { money } from "@/lib/serializers";

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

    const [
      totalCompanies,
      activeCompanies,
      deactivatedCompanies,
      totalUsers,
      apiToday,
      costMonth,
      activeIntegrations,
      enabledFeaturesCount,
      recentCompanies,
      recentActions
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { status: "ACTIVE" } }),
      prisma.tenant.count({ where: { status: "DEACTIVATED" } }),
      prisma.user.count({ where: { role: { in: ["COMPANY_OWNER", "COMPANY_AGENT"] } } }),
      prisma.apiUsageLog.aggregate({
        _sum: { units: true },
        where: { createdAt: { gte: startOfDay } }
      }),
      prisma.apiUsageLog.aggregate({
        _sum: { cost: true },
        where: { createdAt: { gte: startOfMonth } }
      }),
      prisma.integration.count({ where: { status: "CONNECTED" } }),
      prisma.tenantFeature.count({ where: { enabled: true } }),
      prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          users: { where: { role: "COMPANY_OWNER" }, take: 1 },
          features: { where: { enabled: true } }
        }
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          actorUserId: true,
          tenantId: true,
          createdAt: true
        }
      })
    ]);

    return json({
      metrics: {
        totalCompanies,
        activeCompanies,
        deactivatedCompanies,
        totalUsers,
        apiCallsToday: apiToday._sum.units ?? 0,
        estimatedCostThisMonth: money(costMonth._sum.cost ?? 0),
        activeIntegrations,
        featuresEnabledCount: enabledFeaturesCount
      },
      recentCompanies: recentCompanies.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        ownerEmail: tenant.users[0]?.email ?? "No owner",
        ownerUsername: tenant.users[0]?.username ?? "No owner",
        enabledFeaturesCount: tenant.features.length,
        createdAt: tenant.createdAt.toISOString()
      })),
      recentActions: recentActions.map((action) => ({
        id: action.id,
        action: action.action,
        entityType: action.entityType,
        entityId: action.entityId,
        actor: action.actorUserId ?? "System",
        company: action.tenantId,
        createdAt: action.createdAt.toISOString()
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
