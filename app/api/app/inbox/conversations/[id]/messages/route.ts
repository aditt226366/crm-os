import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getTenantConversation, serializeMessage } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT, parseBoundedLimit, parseOptionalDate } from "@/lib/egress";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const startedAt = Date.now();
  try {
    const { user } = await requireFeature(request, "INBOX");
    const { id } = await context.params;
    await getTenantConversation(user.tenantId!, id);
    const before = parseOptionalDate(request.nextUrl.searchParams.get("before"));
    const limit = parseBoundedLimit({
      searchParams: request.nextUrl.searchParams,
      defaultLimit: DEFAULT_MESSAGE_LIMIT,
      maxLimit: MAX_MESSAGE_LIMIT
    });

    const rows = await prisma.message.findMany({
      where: {
        tenantId: user.tenantId!,
        conversationId: id,
        ...(before ? { createdAt: { lt: before } } : {})
      },
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
    });
    const messages = rows.slice(0, limit);

    return json(
      {
        messages: messages.reverse().map(serializeMessage),
        hasMore: rows.length > limit,
        pagination: {
          limit,
          before: messages.at(0)?.createdAt.toISOString() ?? null
        }
      },
      { egress: { route: request.nextUrl.pathname, tenantId: user.tenantId!, startedAt } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
