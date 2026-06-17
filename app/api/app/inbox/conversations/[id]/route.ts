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
    const conversation = await getTenantConversation(user.tenantId!, id);
    const messages = await prisma.message.findMany({
      where: { tenantId: user.tenantId!, conversationId: id },
      orderBy: { createdAt: "desc" },
      take: 40
    });

    return json({
      conversation: serializeConversation(conversation),
      messages: messages.reverse().map(serializeMessage)
    });
  } catch (error) {
    return errorResponse(error);
  }
}
