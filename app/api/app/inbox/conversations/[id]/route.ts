import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getTenantConversation, serializeConversation, serializeMessage } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const { id } = await context.params;
    const existingConversation = await getTenantConversation(user.tenantId!, id);
    const conversation =
      existingConversation.unreadCount > 0
        ? await prisma.conversation.update({
            where: { id: existingConversation.id },
            data: { unreadCount: 0 },
            include: {
              contact: true,
              queueItems: { orderBy: [{ status: "asc" }, { priority: "desc" }] },
              orders: { orderBy: { createdAt: "desc" }, take: 1 }
            }
          })
        : existingConversation;
    const [messages, messageCount] = await Promise.all([
      prisma.message.findMany({
        where: { tenantId: user.tenantId!, conversationId: id },
        orderBy: { createdAt: "desc" },
        take: 40
      }),
      prisma.message.count({
        where: {
          tenantId: user.tenantId!,
          conversationId: id,
          type: { notIn: ["NOTE", "SYSTEM"] }
        }
      })
    ]);

    return json({
      conversation: serializeConversation({
        ...conversation,
        totalMessageCount: messageCount
      }),
      messages: messages.reverse().map(serializeMessage)
    });
  } catch (error) {
    return errorResponse(error);
  }
}
