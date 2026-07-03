import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";

type Context = { params: Promise<{ id: string }> };

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function getTenantCampaign(tenantId: string, id: string) {
  const campaign = await prisma.adCampaign.findFirst({ where: { tenantId, id } });
  if (!campaign) {
    throw new ApiError(404, "AD_NOT_FOUND", "Ad campaign not found.");
  }
  return campaign;
}

async function requireLaunchIntegrations(tenantId: string) {
  const [metaAds, whatsapp] = await Promise.all([
    prisma.integration.findUnique({ where: { tenantId_type: { tenantId, type: "META_ADS" } }, select: { status: true } }),
    prisma.integration.findUnique({ where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } }, select: { status: true } })
  ]);
  if (metaAds?.status !== "CONNECTED") {
    throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "Connect Meta Ads integration to publish.");
  }
  if (whatsapp?.status !== "CONNECTED") {
    throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "WhatsApp Cloud API is required for Click-to-WhatsApp ads.");
  }
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "ADS");
    const tenantId = user.tenantId!;
    await Promise.all([ensureIntegrationSchema(), ensureLeadWorkspaceSchema()]);
    const { id } = await context.params;
    const campaign = await getTenantCampaign(tenantId, id);
    return json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        platform: campaign.platform,
        status: campaign.status,
        metaAdId: campaign.metaAdId,
        metaCampaignId: campaign.metaCampaignId,
        budget: campaign.budget,
        creativeConfig: campaign.creativeConfig,
        audienceConfig: campaign.audienceConfig,
        automationConfig: campaign.automationConfig,
        stats: campaign.stats,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString()
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "ADS");
    const tenantId = user.tenantId!;
    await Promise.all([ensureIntegrationSchema(), ensureLeadWorkspaceSchema()]);
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();
    const campaign = await getTenantCampaign(tenantId, id);

    if (action === "mark-manually-launched") {
      const metaAdId = String(body.metaAdId ?? "").trim();
      if (!metaAdId) {
        throw new ApiError(400, "META_AD_ID_REQUIRED", "Meta Ad ID is required.");
      }
      const creative = asRecord(campaign.creativeConfig);
      const updated = await prisma.adCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "RUNNING",
          metaAdId,
          creativeConfig: {
            ...creative,
            manualLaunch: true,
            manualMappedAt: new Date().toISOString(),
            launchUrl: typeof body.launchUrl === "string" ? body.launchUrl : null
          } as Prisma.InputJsonObject,
          stats: (campaign.stats ?? {
            conversationsStarted: 0,
            leadsGenerated: 0,
            hotLeads: 0,
            warmLeads: 0,
            scrapLeads: 0,
            ordersGenerated: 0,
            humanQueueItems: 0
          }) as Prisma.InputJsonValue
        }
      });
      return json({ ok: true, message: "Meta Ad ID mapped. CRM attribution is active.", campaignId: updated.id });
    }

    if (action === "pause") {
      await prisma.adCampaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });
      return json({ ok: true, message: "Ad paused." });
    }

    if (action === "resume") {
      await prisma.adCampaign.update({ where: { id: campaign.id }, data: { status: "RUNNING" } });
      return json({ ok: true, message: "Ad resumed." });
    }

    if (action === "complete") {
      await prisma.adCampaign.update({ where: { id: campaign.id }, data: { status: "COMPLETED" } });
      return json({ ok: true, message: "Ad marked completed." });
    }

    if (action === "launch") {
      await requireLaunchIntegrations(tenantId);
      await prisma.adCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "PENDING_APPROVAL",
          stats: (campaign.stats ?? {
            conversationsStarted: 0,
            leadsGenerated: 0,
            hotLeads: 0,
            warmLeads: 0,
            scrapLeads: 0,
            ordersGenerated: 0,
            humanQueueItems: 0
          }) as Prisma.InputJsonValue
        }
      });
      return json({
        ok: true,
        message: "Ad passed integration checks and is ready for Meta API publishing. Use manual mapping if your Meta app is not approved for publish yet."
      });
    }

    throw new ApiError(400, "AD_ACTION_INVALID", "Ad action is invalid.");
  } catch (error) {
    return errorResponse(error);
  }
}
