import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function optionalDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function integrationMessage(type: "META_ADS" | "WHATSAPP_CLOUD", status?: string | null) {
  if (status === "CONNECTED") return `${type.replaceAll("_", " ")} connected.`;
  return type === "META_ADS"
    ? "Connect Meta Ads integration to publish."
    : "WhatsApp Cloud API is required for Click-to-WhatsApp ads.";
}

function displayStatus(campaign: { status: string; metaAdId: string | null; creativeConfig: unknown }) {
  const creative = asRecord(campaign.creativeConfig);
  if (campaign.metaAdId && creative.manualLaunch) return "MANUALLY_LAUNCHED";
  return campaign.status;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "ADS");
    const tenantId = user.tenantId!;
    await Promise.all([ensureIntegrationSchema(), ensureLeadWorkspaceSchema()]);

    const [integrations, campaigns, conversationsStarted, leadsGenerated, hotLeads, ordersGenerated, humanQueueFromAds] =
      await Promise.all([
        prisma.integration.findMany({
          where: { tenantId, type: { in: ["META_ADS", "WHATSAPP_CLOUD"] } },
          select: { type: true, status: true, metadata: true, lastVerificationError: true }
        }),
        prisma.adCampaign.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 100
        }),
        prisma.conversation.count({ where: { tenantId, source: "AD" } }),
        prisma.lead.count({ where: { tenantId, source: "AD" } }),
        prisma.lead.count({ where: { tenantId, source: "AD", temperature: "HOT" } }),
        prisma.order.count({ where: { tenantId, source: "AD" } }),
        prisma.humanQueueItem.count({ where: { tenantId, conversation: { source: "AD" } } })
      ]);

    const integrationByType = new Map(integrations.map((integration) => [integration.type, integration]));
    const metaAds = integrationByType.get("META_ADS");
    const whatsapp = integrationByType.get("WHATSAPP_CLOUD");
    const metaMetadata = asRecord(metaAds?.metadata);
    const whatsappMetadata = asRecord(whatsapp?.metadata);

    return json({
      connection: {
        metaAds: {
          status: metaAds?.status ?? "NOT_CONNECTED",
          connected: metaAds?.status === "CONNECTED",
          message: metaAds?.lastVerificationError ?? integrationMessage("META_ADS", metaAds?.status),
          adAccountName: typeof metaMetadata.adAccountName === "string" ? metaMetadata.adAccountName : null,
          adAccountId: typeof metaMetadata.adAccountId === "string" ? metaMetadata.adAccountId : null,
          pageName: typeof metaMetadata.pageName === "string" ? metaMetadata.pageName : null
        },
        whatsapp: {
          status: whatsapp?.status ?? "NOT_CONNECTED",
          connected: whatsapp?.status === "CONNECTED",
          message: whatsapp?.lastVerificationError ?? integrationMessage("WHATSAPP_CLOUD", whatsapp?.status),
          phoneNumberId: typeof whatsappMetadata.phoneNumberId === "string" ? whatsappMetadata.phoneNumberId : null
        }
      },
      metrics: {
        activeAds: campaigns.filter((campaign) => campaign.status === "RUNNING").length,
        draftAds: campaigns.filter((campaign) => campaign.status === "DRAFT").length,
        conversationsStarted,
        leadsGenerated,
        hotLeads,
        ordersGenerated,
        humanQueueFromAds
      },
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        platform: campaign.platform,
        status: campaign.status,
        displayStatus: displayStatus(campaign),
        metaAdId: campaign.metaAdId,
        metaCampaignId: campaign.metaCampaignId,
        budget: campaign.budget,
        startDate: campaign.startDate?.toISOString() ?? null,
        endDate: campaign.endDate?.toISOString() ?? null,
        creativeConfig: campaign.creativeConfig,
        audienceConfig: campaign.audienceConfig,
        automationConfig: campaign.automationConfig,
        stats: campaign.stats,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString()
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "ADS");
    const tenantId = user.tenantId!;
    await Promise.all([ensureIntegrationSchema(), ensureLeadWorkspaceSchema()]);
    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    if (!name) {
      throw new ApiError(400, "AD_NAME_REQUIRED", "Ad name is required.");
    }
    const status = body.status === "READY_TO_PUBLISH" ? "READY_TO_PUBLISH" : "DRAFT";
    const dailyBudget = numberOrUndefined(body.dailyBudget);
    const lifetimeBudget = numberOrUndefined(body.lifetimeBudget);

    const campaign = await prisma.adCampaign.create({
      data: {
        tenantId,
        name,
        objective: String(body.objective ?? "Click to WhatsApp"),
        platform: String(body.platform ?? "Facebook + Instagram"),
        status,
        budget: {
          dailyBudget: dailyBudget ?? null,
          lifetimeBudget: lifetimeBudget ?? null,
          timezone: String(body.timezone ?? "Asia/Dubai")
        } as Prisma.InputJsonObject,
        startDate: optionalDate(body.startDate),
        endDate: optionalDate(body.endDate),
        audienceConfig: {
          type: String(body.audienceType ?? "Manual targeting"),
          targetingNotes: String(body.targetingNotes ?? "")
        } as Prisma.InputJsonObject,
        creativeConfig: {
          primaryText: String(body.primaryText ?? ""),
          headline: String(body.headline ?? ""),
          description: String(body.description ?? ""),
          cta: "Send WhatsApp Message",
          welcomeText: String(body.welcomeText ?? "")
        } as Prisma.InputJsonObject,
        automationConfig: {
          tagNewLead: Boolean(body.tagNewLead),
          startAiWorkflow: Boolean(body.startAiWorkflow),
          assignAgent: String(body.assignAgent ?? ""),
          humanQueueHighIntent: Boolean(body.humanQueueHighIntent),
          updateGoogleSheet: Boolean(body.updateGoogleSheet)
        } as Prisma.InputJsonObject,
        stats: {
          conversationsStarted: 0,
          leadsGenerated: 0,
          hotLeads: 0,
          warmLeads: 0,
          scrapLeads: 0,
          ordersGenerated: 0,
          humanQueueItems: 0
        } as Prisma.InputJsonObject,
        createdById: user.id
      }
    });

    return json(
      {
        ok: true,
        message: status === "READY_TO_PUBLISH" ? "Ad saved as ready to publish." : "Ad draft saved.",
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status
        }
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
