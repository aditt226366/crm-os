import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { money } from "@/lib/serializers";

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const [total, success, failed, byProvider] = await Promise.all([
      prisma.apiUsageLog.aggregate({ _sum: { units: true, cost: true } }),
      prisma.apiUsageLog.aggregate({ _sum: { units: true }, where: { status: "SUCCESS" } }),
      prisma.apiUsageLog.aggregate({ _sum: { units: true }, where: { status: { not: "SUCCESS" } } }),
      prisma.apiUsageLog.groupBy({
        by: ["provider"],
        _sum: { units: true, cost: true }
      })
    ]);

    const providerUnits = Object.fromEntries(byProvider.map((item) => [item.provider, item._sum.units ?? 0]));
    return json({
      summary: {
        totalApiCalls: total._sum.units ?? 0,
        successfulApiCalls: success._sum.units ?? 0,
        failedApiCalls: failed._sum.units ?? 0,
        whatsAppMessagesSent: providerUnits.meta ?? 0,
        whatsAppTemplateMessagesSent: Math.round((providerUnits.meta ?? 0) * 0.42),
        aiApiCalls: providerUnits.openai ?? 0,
        googleSheetsApiCalls: providerUnits.google ?? 0,
        workflowExecutions: providerUnits.internal ?? 0,
        estimatedCost: money(total._sum.cost ?? 0)
      },
      providerBreakdown: byProvider.map((item) => ({
        provider: item.provider,
        units: item._sum.units ?? 0,
        cost: money(item._sum.cost ?? 0)
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
