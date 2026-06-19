import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { serializeConversation } from "@/lib/inbox";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    await ensureLeadWorkspaceSchema();
    const tenantId = user.tenantId!;
    const { searchParams } = request.nextUrl;
    const filter = searchParams.get("filter") ?? "all";
    const query = searchParams.get("q")?.trim();
    const take = Math.min(Number(searchParams.get("take") ?? 50), 100);

    const where: Prisma.ConversationWhereInput = { tenantId };
    const and: Prisma.ConversationWhereInput[] = [];

    if (query) {
      and.push({
        OR: [
          { lastMessageText: { contains: query, mode: "insensitive" } },
          { contact: { is: { name: { contains: query, mode: "insensitive" } } } },
          { contact: { is: { phone: { contains: query, mode: "insensitive" } } } }
        ]
      });
    }

    if (filter === "unread") {
      and.push({ unreadCount: { gt: 0 } });
    }
    if (filter === "assigned") {
      and.push({ assignedUserId: user.id });
    }
    if (filter === "hot" || filter === "warm" || filter === "scrap") {
      and.push({ contact: { is: { leadTemperature: filter.toUpperCase() as "HOT" | "WARM" | "SCRAP" } } });
    }
    if (filter === "human-queue") {
      and.push({
        OR: [
          { humanTakeover: true },
          { queueItems: { some: { status: { in: ["OPEN", "ASSIGNED"] } } } }
        ]
      });
    }
    if (filter === "orders") {
      and.push({ orders: { some: {} } });
    }
    if (filter === "broadcast" || filter === "campaign" || filter === "ads") {
      and.push({ source: filter === "ads" ? "AD" : filter.toUpperCase() as "BROADCAST" | "CAMPAIGN" });
    }

    if (and.length) {
      where.AND = and;
    }

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        contact: true,
        queueItems: { where: { status: { in: ["OPEN", "ASSIGNED"] } }, orderBy: { priority: "desc" }, take: 1 },
        orders: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take
    });

    return json({
      conversations: conversations.map(serializeConversation)
    });
  } catch (error) {
    return errorResponse(error);
  }
}
