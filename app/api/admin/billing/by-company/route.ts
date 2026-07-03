import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { money } from "@/lib/serializers";

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const rows = await prisma.apiUsageLog.groupBy({
      by: ["tenantId"],
      _sum: { units: true, cost: true },
      orderBy: { _sum: { units: "desc" } }
    });
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: rows.map((row) => row.tenantId) } }
    });
    const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    return json({
      byCompany: rows.map((row) => ({
        tenantId: row.tenantId,
        company: names.get(row.tenantId) ?? "Unknown",
        units: row._sum.units ?? 0,
        cost: money(row._sum.cost ?? 0)
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
