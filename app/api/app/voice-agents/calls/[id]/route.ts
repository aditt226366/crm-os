import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json, ApiError } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { serializeVoiceCall } from "@/lib/voice-agent";

// Full call detail incl. transcript + recording URL + summary.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireFeature(request, "VOICE_AGENTS");
    const tenantId = user.tenantId!;
    const { id } = await params;

    const call = await prisma.voiceCall.findFirst({
      where: { id, tenantId },
      include: { contact: { select: { name: true } } }
    });
    if (!call) {
      throw new ApiError(404, "VOICE_CALL_NOT_FOUND", "Call not found");
    }

    return json({ call: serializeVoiceCall(call, { includeTranscript: true }) });
  } catch (error) {
    return errorResponse(error);
  }
}
