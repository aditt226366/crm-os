import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { serializeConversation } from "@/lib/inbox";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { isMetaDeliveryLimitError } from "@/lib/meta-delivery-limit";
import { DEFAULT_CONVERSATION_LIMIT, MAX_CONVERSATION_LIMIT, parseBoundedLimit, parseOptionalDate } from "@/lib/egress";

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
const activeHumanQueueWhere = {
  OR: [
    { humanTakeover: true },
    { queueItems: { some: { status: { in: ["OPEN", "ASSIGNED"] } } } }
  ]
} satisfies Prisma.ConversationWhereInput;
const notInHumanQueueWhere = {
  humanTakeover: false,
  queueItems: { none: { status: { in: ["OPEN", "ASSIGNED"] } } }
} satisfies Prisma.ConversationWhereInput;

function temperatureFilter(value: string) {
  if (value === "hot") return "HOT";
  if (value === "warm") return "WARM";
  if (value === "scrap") return "SCRAP";
  return null;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { user } = await requireFeature(request, "INBOX");
    await ensureLeadWorkspaceSchema();
    const tenantId = user.tenantId!;
    const { searchParams } = request.nextUrl;
    const filter = searchParams.get("filter") ?? "all";
    const query = searchParams.get("q")?.trim().slice(0, 80);
    const limit = parseBoundedLimit({
      searchParams,
      defaultLimit: DEFAULT_CONVERSATION_LIMIT,
      maxLimit: MAX_CONVERSATION_LIMIT
    });
    const cursor = searchParams.get("cursor");
    const since = parseOptionalDate(searchParams.get("since"));
    const leadTemperature = temperatureFilter(filter);

    const where: Prisma.ConversationWhereInput = { tenantId };
    const and: Prisma.ConversationWhereInput[] = [];

    if (query) {
      and.push({
        OR: [
          { lastMessageText: { contains: query, mode: "insensitive" } },
          { contact: { is: { name: { contains: query, mode: "insensitive" } } } },
          { contact: { is: { phone: { contains: query, mode: "insensitive" } } } },
          { contact: { is: { phoneNormalized: { contains: query, mode: "insensitive" } } } },
          { contact: { is: { waId: { contains: query, mode: "insensitive" } } } },
          { contact: { is: { last10: { contains: query, mode: "insensitive" } } } }
        ]
      });
    }
    if (since) {
      and.push({ updatedAt: { gt: since } });
    }

    if (filter === "unread") {
      and.push({ unreadCount: { gt: 0 } });
    }
    if (filter === "assigned") {
      and.push({ assignedUserId: user.id });
    }
    if (filter === "human-queue") {
      and.push(activeHumanQueueWhere);
    }
    if (filter !== "all" && filter !== "human-queue" && !leadTemperature) {
      and.push(notInHumanQueueWhere);
    }
    if (leadTemperature) {
      and.push({ leads: { some: { temperature: leadTemperature } } });
    }
    if (filter === "orders") {
      and.push({ orders: { some: { status: { in: [...confirmedOrderStatuses] } } } });
    }
    if (filter === "broadcast" || filter === "campaign" || filter === "ads") {
      and.push({ source: filter === "ads" ? "AD" : filter.toUpperCase() as "BROADCAST" | "CAMPAIGN" });
    }
    if (filter !== "all" && !leadTemperature) {
      and.push({ messages: { none: blockedMessageWhere } });
    }

    if (and.length) {
      where.AND = and;
    }

    const conversations = await prisma.conversation.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        contactId: true,
        assignedUserId: true,
        source: true,
        sourceId: true,
        status: true,
        unreadCount: true,
        humanTakeover: true,
        aiRepliesStopped: true,
        customerReplyCount: true,
        totalMessageCount: true,
        lastMessageText: true,
        lastMessageAt: true,
        customerServiceWindowExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            phoneNormalized: true,
            waId: true,
            last10: true,
            email: true,
            optIn: true,
            optOut: true,
            source: true,
            tags: true,
            leadTemperature: true,
            leadTemperatureOverride: true,
            leadTemperatureOverrideReason: true,
            customerReplyCount: true,
            totalMessageCount: true,
            lastMessageAt: true,
            lastContactedAt: true
          }
        },
        leads: {
          ...(leadTemperature ? { where: { temperature: leadTemperature } } : {}),
          select: { temperature: true },
          orderBy: { updatedAt: "desc" },
          take: 1
        },
        queueItems: {
          where: { status: { in: ["OPEN", "ASSIGNED"] } },
          select: { id: true, status: true, priority: true, reason: true },
          orderBy: { priority: "desc" },
          take: 1
        },
        orders: {
          ...(filter === "orders" ? { where: { status: { in: [...confirmedOrderStatuses] } } } : {}),
          select: { id: true, status: true, orderNumber: true },
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
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1
    });

    const page = conversations.slice(0, limit);
    const hasMore = conversations.length > limit;

    return json(
      {
        conversations: page.map((conversation) =>
          serializeConversation({
            ...conversation,
            totalMessageCount: conversation._count.messages,
            hasFailedMessages: conversation.messages.length > 0,
            hasMetaDeliveryLimitedMessages: conversation.messages.some((message) =>
              isMetaDeliveryLimitError([message.failureReason, message.metadata])
            )
          })
        ),
        pagination: {
          limit,
          hasMore,
          nextCursor: hasMore ? page.at(-1)?.id ?? null : null
        },
        sync: {
          since: new Date().toISOString()
        }
      },
      { egress: { route: request.nextUrl.pathname, tenantId, startedAt } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
