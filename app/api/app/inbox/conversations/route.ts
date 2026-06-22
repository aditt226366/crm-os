import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { serializeConversation } from "@/lib/inbox";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { isMetaDeliveryLimitError } from "@/lib/meta-delivery-limit";

const confirmedOrderStatuses = ["CONFIRMED", "DISPATCHED", "COMPLETED"] as const;
const messageCountedTypes = ["NOTE", "SYSTEM"] as const;
const blockedMessageWhere = {
  OR: [
    { status: "FAILED" },
    { metadata: { path: ["metaDeliveryLimit", "status"], equals: "META_DELIVERY_LIMITED" } },
    { failureReason: { contains: "healthy ecosystem engagement", mode: "insensitive" } },
    { failureReason: { contains: "131049" } }
  ]
} satisfies Prisma.MessageWhereInput;

function parseTake(value: string | null) {
  if (!value) return undefined;
  const take = Number(value);
  if (!Number.isFinite(take) || take <= 0) return undefined;
  return Math.min(Math.floor(take), 500);
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    await ensureLeadWorkspaceSchema();
    const tenantId = user.tenantId!;
    const { searchParams } = request.nextUrl;
    const filter = searchParams.get("filter") ?? "all";
    const query = searchParams.get("q")?.trim();
    const take = parseTake(searchParams.get("take"));

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
    if (filter === "human-queue") {
      and.push({
        OR: [
          { humanTakeover: true },
          { queueItems: { some: { status: { in: ["OPEN", "ASSIGNED"] } } } }
        ]
      });
    }
    if (filter === "orders") {
      and.push({ orders: { some: { status: { in: [...confirmedOrderStatuses] } } } });
    }
    if (filter === "broadcast" || filter === "campaign" || filter === "ads") {
      and.push({ source: filter === "ads" ? "AD" : filter.toUpperCase() as "BROADCAST" | "CAMPAIGN" });
    }
    if (filter !== "all") {
      and.push({ messages: { none: blockedMessageWhere } });
    }

    if (and.length) {
      where.AND = and;
    }

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        contact: true,
        queueItems: { where: { status: { in: ["OPEN", "ASSIGNED"] } }, orderBy: { priority: "desc" }, take: 1 },
        orders: {
          ...(filter === "orders" ? { where: { status: { in: [...confirmedOrderStatuses] } } } : {}),
          orderBy: { createdAt: "desc" },
          take: 1
        },
        messages: {
          where: blockedMessageWhere,
          select: {
            id: true,
            status: true,
            failureReason: true,
            metadata: true
          },
          take: 5
        },
        _count: {
          select: {
            messages: { where: { type: { notIn: [...messageCountedTypes] } } }
          }
        }
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    });

    const filteredConversations = conversations.filter((conversation) => {
      const customerReplyCount = conversation.customerReplyCount;
      if (filter === "hot") return customerReplyCount >= 6;
      if (filter === "warm") return customerReplyCount >= 2 && customerReplyCount <= 5;
      if (filter === "scrap") return customerReplyCount <= 1;
      return true;
    });
    const limitedConversations = take === undefined ? filteredConversations : filteredConversations.slice(0, take);

    return json({
      conversations: limitedConversations.map((conversation) =>
        serializeConversation({
          ...conversation,
          totalMessageCount: conversation._count.messages,
          hasFailedMessages: conversation.messages.length > 0,
          hasMetaDeliveryLimitedMessages: conversation.messages.some((message) =>
            isMetaDeliveryLimitError([message.failureReason, message.metadata])
          )
        })
      )
    });
  } catch (error) {
    return errorResponse(error);
  }
}
