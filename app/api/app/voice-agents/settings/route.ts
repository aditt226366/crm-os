import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json, ApiError } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { encryptIntegrationConfig, readEncryptedConfig } from "@/lib/integration-vault";
import { emitTenantEvent } from "@/lib/realtime";

// Agent persona is edited here by the company user (moved out of the admin
// integration panel). It merges the persona fields into the tenant's VOICE_AGENT
// integration config, leaving the admin-managed secrets (Plivo/Sarvam/Anthropic
// keys) untouched.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "VOICE_AGENTS");
    const tenantId = user.tenantId!;
    await ensureIntegrationSchema();

    const integration = await prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "VOICE_AGENT" } }
    });
    if (!integration) {
      throw new ApiError(409, "VOICE_AGENT_NOT_SET_UP", "Ask your admin to connect the Voice Agent integration first.");
    }

    const body = (await request.json().catch(() => ({}))) as {
      companyName?: unknown;
      outboundGreeting?: unknown;
      inboundGreeting?: unknown;
      systemPrompt?: unknown;
      maxCallSeconds?: unknown;
      useKnowledgeBase?: unknown;
    };

    const config = readEncryptedConfig(integration.encryptedConfig);
    const setText = (key: string, value: unknown, max: number) => {
      if (typeof value === "string") config[key] = value.trim().slice(0, max);
    };
    setText("COMPANY_DISPLAY_NAME", body.companyName, 120);
    setText("OUTBOUND_GREETING", body.outboundGreeting, 600);
    setText("INBOUND_GREETING", body.inboundGreeting, 600);
    setText("SYSTEM_PROMPT", body.systemPrompt, 4000);
    if (body.maxCallSeconds != null) {
      const parsed = Number.parseInt(String(body.maxCallSeconds), 10);
      config.MAX_CALL_SECONDS = String(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 30), 3600) : 300);
    }
    if (typeof body.useKnowledgeBase === "boolean") {
      config.USE_KNOWLEDGE_BASE = body.useKnowledgeBase ? "Yes" : "No";
    }

    await prisma.integration.update({
      where: { id: integration.id },
      data: { encryptedConfig: encryptIntegrationConfig(config), updatedById: user.id }
    });

    emitTenantEvent(tenantId, "voice.agent.updated", { companyName: config.COMPANY_DISPLAY_NAME ?? null });

    return json({
      ok: true,
      agent: {
        companyName: config.COMPANY_DISPLAY_NAME ?? "",
        outboundGreeting: config.OUTBOUND_GREETING ?? "",
        inboundGreeting: config.INBOUND_GREETING ?? "",
        systemPrompt: config.SYSTEM_PROMPT ?? "",
        maxCallSeconds: Number(config.MAX_CALL_SECONDS ?? 300) || 300,
        useKnowledgeBase: (config.USE_KNOWLEDGE_BASE ?? "Yes").toLowerCase() !== "no"
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
