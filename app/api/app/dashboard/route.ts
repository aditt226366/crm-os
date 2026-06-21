import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { money } from "@/lib/serializers";

function percent(part: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.round((part / total) * 1000) / 10;
}

function emptyDashboardPayload(warning?: string) {
  return {
    ok: true,
    ...(warning ? { warning } : {}),
    metrics: {
      totalLeads: 0,
      hotLeads: 0,
      warmLeads: 0,
      scrapLeads: 0,
      newConversationsToday: 0,
      openConversations: 0,
      humanQueueCount: 0,
      ordersCaptured: 0,
      activeCampaigns: 0,
      broadcastsSent: 0,
      messagesSent: 0,
      deliveryRate: 0,
      readRate: 0,
      replyRate: 0,
      failedMessages: 0,
      metaDeliveryLimitedMessages: 0,
      estimatedApiCost: 0
    },
    charts: {
      leadFunnel: [
        { label: "Scrap", value: 0 },
        { label: "Warm", value: 0 },
        { label: "Hot", value: 0 },
        { label: "Order", value: 0 }
      ],
      messageStatus: [
        { label: "Sent", value: 0 },
        { label: "Delivered", value: 0 },
        { label: "Read", value: 0 },
        { label: "Failed", value: 0 }
      ],
      topLeadSources: [],
      handling: [
        { label: "AI handled", value: 0 },
        { label: "Human handled", value: 0 }
      ],
      campaignPerformance: []
    },
    recent: {
      conversations: [],
      orders: [],
      humanQueue: [],
      broadcasts: [],
      campaigns: []
    }
  };
}

function logDashboardError(error: unknown) {
  const details = error as { code?: unknown; meta?: unknown; message?: unknown };
  console.error("[app.dashboard] failed", {
    prismaCode: typeof details.code === "string" ? details.code : undefined,
    prismaMeta: details.meta,
    message: typeof details.message === "string" ? details.message : String(error)
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireActiveTenant(request);
    const tenantId = user.tenantId!;
    try {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalLeads,
      leadTemperatureRows,
      newConversationsToday,
      openConversations,
      humanQueueCount,
      ordersCaptured,
      activeCampaigns,
      broadcastsSent,
      messagesSent,
      failedMessages,
      metaDeliveryLimitedMessages,
      messageStatuses,
      usageCost,
      topLeadSources,
      aiHandled,
      humanHandled,
      recentConversations,
      recentOrders,
      recentQueueItems,
      recentBroadcasts,
      recentCampaigns
    ] = await Promise.all([
      prisma.lead.count({ where: { tenantId } }),
      prisma.lead.groupBy({
        by: ["temperature"],
        where: { tenantId },
        _count: { _all: true }
      }),
      prisma.conversation.count({ where: { tenantId, createdAt: { gte: today } } }),
      prisma.conversation.count({ where: { tenantId, status: { in: ["OPEN", "PENDING"] } } }),
      prisma.humanQueueItem.count({ where: { tenantId, status: { in: ["OPEN", "ASSIGNED"] } } }),
      prisma.order.count({ where: { tenantId } }),
      prisma.campaign.count({ where: { tenantId, status: { in: ["RUNNING", "SCHEDULED"] } } }),
      prisma.broadcast.count({ where: { tenantId, status: { in: ["COMPLETED", "SENDING"] } } }),
      prisma.message.count({ where: { tenantId, direction: "OUTBOUND" } }),
      prisma.message.count({ where: { tenantId, status: "FAILED" } }),
      prisma.message.count({
        where: {
          tenantId,
          status: "FAILED",
          OR: [
            { metadata: { path: ["metaDeliveryLimit", "status"], equals: "META_DELIVERY_LIMITED" } },
            { failureReason: { contains: "healthy ecosystem engagement", mode: "insensitive" } },
            { failureReason: { contains: "131049" } }
          ]
        }
      }),
      prisma.message.groupBy({
        by: ["status"],
        where: { tenantId, direction: "OUTBOUND" },
        _count: { _all: true }
      }),
      prisma.apiUsageLog.aggregate({
        where: { tenantId, createdAt: { gte: monthStart } },
        _sum: { cost: true }
      }),
      prisma.lead.groupBy({
        by: ["source"],
        where: { tenantId },
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
        take: 5
      }),
      prisma.conversation.count({ where: { tenantId, humanTakeover: false } }),
      prisma.conversation.count({ where: { tenantId, humanTakeover: true } }),
      prisma.conversation.findMany({
        where: { tenantId },
        include: { contact: true },
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        take: 6
      }),
      prisma.order.findMany({
        where: { tenantId },
        include: { contact: true },
        orderBy: { createdAt: "desc" },
        take: 5
      }),
      prisma.humanQueueItem.findMany({
        where: { tenantId, status: { in: ["OPEN", "ASSIGNED"] } },
        include: { contact: true, conversation: true },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        take: 5
      }),
      prisma.broadcast.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5
      }),
      prisma.campaign.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5
      })
    ]);

    const temperatureCount = (temperature: "HOT" | "WARM" | "SCRAP") =>
      leadTemperatureRows.find((row) => row.temperature === temperature)?._count._all ?? 0;
    const statusCount = (status: "SENT" | "DELIVERED" | "READ" | "FAILED") =>
      messageStatuses.find((row) => row.status === status)?._count._all ?? 0;
    const sentOrBetter = statusCount("SENT") + statusCount("DELIVERED") + statusCount("READ");
    const deliveredOrBetter = statusCount("DELIVERED") + statusCount("READ");
    const read = statusCount("READ");
    const deliveryLimited = Math.min(failedMessages, metaDeliveryLimitedMessages);
    const standardFailedMessages = Math.max(0, failedMessages - deliveryLimited);
    const inboundMessages = await prisma.message.count({ where: { tenantId, direction: "INBOUND" } });

    return json({
      metrics: {
        totalLeads,
        hotLeads: temperatureCount("HOT"),
        warmLeads: temperatureCount("WARM"),
        scrapLeads: temperatureCount("SCRAP"),
        newConversationsToday,
        openConversations,
        humanQueueCount,
        ordersCaptured,
        activeCampaigns,
        broadcastsSent,
        messagesSent,
        deliveryRate: percent(deliveredOrBetter, messagesSent),
        readRate: percent(read, messagesSent),
        replyRate: percent(inboundMessages, messagesSent),
        failedMessages: standardFailedMessages,
        metaDeliveryLimitedMessages: deliveryLimited,
        estimatedApiCost: money(usageCost._sum.cost ?? 0)
      },
      charts: {
        leadFunnel: [
          { label: "Scrap", value: temperatureCount("SCRAP") },
          { label: "Warm", value: temperatureCount("WARM") },
          { label: "Hot", value: temperatureCount("HOT") },
          { label: "Order", value: ordersCaptured }
        ],
        messageStatus: [
          { label: "Sent", value: sentOrBetter },
          { label: "Delivered", value: deliveredOrBetter },
          { label: "Read", value: read },
          { label: "Failed", value: standardFailedMessages },
          { label: "Meta delivery-limited", value: deliveryLimited }
        ],
        topLeadSources: topLeadSources.map((row) => ({
          label: row.source,
          value: row._count._all
        })),
        handling: [
          { label: "AI handled", value: aiHandled },
          { label: "Human handled", value: humanHandled }
        ],
        campaignPerformance: recentCampaigns.map((campaign) => ({
          label: campaign.name,
          status: campaign.status,
          value: Number((campaign.stats as { replied?: number } | null)?.replied ?? 0)
        }))
      },
      recent: {
        conversations: recentConversations.map((conversation) => ({
          id: conversation.id,
          contactName: conversation.contact.name,
          phone: conversation.contact.phone,
          source: conversation.source,
          status: conversation.status,
          temperature: conversation.contact.leadTemperature,
          lastMessageText: conversation.lastMessageText,
          lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
          unreadCount: conversation.unreadCount
        })),
        orders: recentOrders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          contactName: order.contact.name,
          status: order.status,
          source: order.source,
          createdAt: order.createdAt.toISOString()
        })),
        humanQueue: recentQueueItems.map((item) => ({
          id: item.id,
          conversationId: item.conversationId,
          contactName: item.contact.name,
          reason: item.reason,
          priority: item.priority,
          status: item.status,
          latestMessage: item.conversation.lastMessageText,
          createdAt: item.createdAt.toISOString()
        })),
        broadcasts: recentBroadcasts.map((broadcast) => ({
          id: broadcast.id,
          name: broadcast.name,
          status: broadcast.status,
          createdAt: broadcast.createdAt.toISOString()
        })),
        campaigns: recentCampaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          goal: campaign.goal,
          status: campaign.status,
          createdAt: campaign.createdAt.toISOString()
        }))
      }
    });
    } catch (error) {
      logDashboardError(error);
      return json(emptyDashboardPayload("Dashboard metrics could not fully load."));
    }
  } catch (error) {
    return errorResponse(error);
  }
}
