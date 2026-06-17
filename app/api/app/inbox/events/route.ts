import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse } from "@/lib/api";
import { subscribeTenantEvents } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const stream = subscribeTenantEvents(user.tenantId!, request.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
