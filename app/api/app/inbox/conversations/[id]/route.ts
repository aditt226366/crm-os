import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getTenantConversation, serializeConversation, serializeMessage } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";
import { isMetaDeliveryLimitError } from "@/lib/meta-delivery-limit";
import { DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT, parseBoundedLimit } from "@/lib/egress";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const startedAt = Date.now();
  try {
    const { user } = await requireFeature(request, "INBOX");
    const { id } = await context.params;
    const limit = parseBoundedLimit({
      searchParams: request.nextUrl.searchParams,
      defaultLimit: DEFAULT_MESSAGE_LIMIT,
      maxLimit: MAX_MESSAGE_LIMIT
    });
    const existingConversation = await getTenantConversation(user.tenantId!, id);
    const conversation =
      existingConversation.unreadCount > 0
        ? await prisma.conversation.update({
            where: { id: existingConversation.id },
            data: { unreadCount: 0 },
            include: {
              contact: true,
              leads: { orderBy: { updatedAt: "desc" }, take: 1 },
              queueItems: { orderBy: [{ status: "asc" }, { priority: "desc" }] },
              orders: { orderBy: { createdAt: "desc" }, take: 1 }
            }
          })
        : existingConversation;
    const [messageRows, messageCount, blockedMessages] = await Promise.all([
      prisma.message.findMany({
        where: { tenantId: user.tenantId!, conversationId: id },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        select: {
          id: true,
          conversationId: true,
          contactId: true,
          direction: true,
          type: true,
          body: true,
          templateId: true,
          whatsappMessageId: true,
          status: true,
          failureReason: true,
          metadata: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.message.count({
        where: {
          tenantId: user.tenantId!,
          conversationId: id,
          type: { notIn: ["NOTE", "SYSTEM"] }
        }
      }),
      prisma.message.findMany({
        where: {
          tenantId: user.tenantId!,
          conversationId: id,
          OR: [
            { status: "FAILED" },
            { metadata: { path: ["metaDeliveryLimit", "status"], equals: "META_DELIVERY_LIMITED" } },
            { failureReason: { contains: "healthy ecosystem engagement", mode: "insensitive" } },
            { failureReason: { contains: "131049" } }
          ]
        },
        select: {
          id: true,
          status: true,
          failureReason: true,
          metadata: true
        },
        take: 5
      })
    ]);
    const hasMoreOlderMessages = messageRows.length > limit;
    const messages = messageRows.slice(0, limit);

    return json(
      {
        conversation: serializeConversation({
          ...conversation,
          totalMessageCount: messageCount,
          hasFailedMessages: blockedMessages.length > 0,
          hasMetaDeliveryLimitedMessages: blockedMessages.some((message) =>
            isMetaDeliveryLimitError([message.failureReason, message.metadata])
          )
        }),
        messages: messages.reverse().map(serializeMessage),
        pagination: {
          limit,
          hasMoreOlderMessages,
          before: messages.at(0)?.createdAt.toISOString() ?? null
        }
      },
      { egress: { route: request.nextUrl.pathname, tenantId: user.tenantId!, startedAt } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
