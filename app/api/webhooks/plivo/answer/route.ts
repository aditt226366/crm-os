import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { buildHangupXml, buildStreamAnswerXml, startRecording } from "@/lib/plivo-voice";
import { emitTenantEvent } from "@/lib/realtime";
import {
  appBaseUrl,
  loadVoiceAgentConfig,
  readPlivoForm,
  resolveVoiceTenantByNumber,
  signCallToken,
  voiceServiceWsUrl
} from "@/lib/voice-agent";

// Plivo hits this URL when a call is answered (both outbound and inbound). It
// resolves the VoiceCall, starts recording, and returns Plivo XML that opens a
// bidirectional audio stream to the Pipecat media service. Mirrors the shape of
// app/api/webhooks/whatsapp/route.ts (resolve tenant, then process).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function xmlResponse(xml: string) {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

async function handleAnswer(request: NextRequest) {
  try {
    await ensureIntegrationSchema();
    const params = request.nextUrl.searchParams;
    const form = await readPlivoForm(request);
    const callUuid = form.CallUUID || params.get("CallUUID") || "";
    const from = form.From || params.get("From") || "";
    const to = form.To || params.get("To") || "";
    const providedCallId = params.get("callId");
    const origin = appBaseUrl(request.nextUrl.origin);

    let voiceCall;
    if (providedCallId) {
      // Outbound: the VoiceCall row was created when the call was placed.
      const existing = await prisma.voiceCall.findUnique({ where: { id: providedCallId } });
      if (!existing) {
        return xmlResponse(buildHangupXml("Unknown call"));
      }
      voiceCall = await prisma.voiceCall.update({
        where: { id: existing.id },
        data: {
          providerCallId: callUuid || existing.providerCallId,
          status: "IN_PROGRESS",
          startedAt: existing.startedAt ?? new Date()
        }
      });
    } else {
      // Inbound: resolve the tenant that owns the dialed number and create a row.
      const tenantId = await resolveVoiceTenantByNumber(to);
      if (!tenantId) {
        return xmlResponse(buildHangupXml("No voice agent is configured for this number"));
      }
      const last10 = from.replace(/\D/g, "").slice(-10);
      const contact = last10
        ? await prisma.contact.findFirst({ where: { tenantId, last10 }, select: { id: true } })
        : null;
      voiceCall = await prisma.voiceCall.create({
        data: {
          tenantId,
          direction: "INBOUND",
          status: "IN_PROGRESS",
          fromNumber: from,
          toNumber: to,
          providerCallId: callUuid || null,
          contactId: contact?.id ?? null,
          startedAt: new Date()
        }
      });
    }

    const tenantId = voiceCall.tenantId;

    // Start call recording (best-effort). Recording URL arrives later at
    // /api/webhooks/plivo/recording.
    if (callUuid) {
      const voice = await loadVoiceAgentConfig(tenantId);
      if (voice?.config) {
        startRecording({
          config: voice.config,
          callUuid,
          callbackUrl: `${origin}/api/webhooks/plivo/recording?callId=${encodeURIComponent(voiceCall.id)}`
        }).catch((error) =>
          console.error("[plivo.record] failed", error instanceof Error ? error.message : String(error))
        );
      }
    }

    emitTenantEvent(tenantId, "voice.call.updated", {
      id: voiceCall.id,
      status: voiceCall.status,
      direction: voiceCall.direction
    });

    const token = await signCallToken({ callId: voiceCall.id, tenantId });
    const wssUrl = `${voiceServiceWsUrl()}/ws?token=${encodeURIComponent(token)}`;
    return xmlResponse(buildStreamAnswerXml({ wssUrl }));
  } catch (error) {
    console.error("[plivo.answer] failed", error instanceof Error ? error.message : String(error));
    return xmlResponse(buildHangupXml("Voice agent error"));
  }
}

export async function POST(request: NextRequest) {
  return handleAnswer(request);
}

export async function GET(request: NextRequest) {
  return handleAnswer(request);
}
