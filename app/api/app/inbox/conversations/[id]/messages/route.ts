import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getTenantConversation, serializeMessage } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const { id } = await context.params;
    await getTenantConversation(user.tenantId!, id);
    const before = request.nextUrl.searchParams.get("before");
    const take = Math.min(Number(request.nextUrl.searchParams.get("take") ?? 40), 80);

    const messages = await prisma.message.findMany({
      where: {
        tenantId: user.tenantId!,
        conversationId: id,
        ...(before ? { createdAt: { lt: new Date(before) } } : {})
      },
      orderBy: { createdAt: "desc" },
      take
    });

    return json({
      messages: messages.reverse().map(serializeMessage),
      hasMore: messages.length === take
    });
  } catch (error) {
    return errorResponse(error);
  }
}
