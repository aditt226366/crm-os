import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { safeCreateAuditLog } from "@/lib/audit";

function integrationMessage(type: string, status?: string | null, error?: string | null) {
  if (status === "CONNECTED") {
    return `${type.replaceAll("_", " ")} connected.`;
  }
  if (error) return error;
  if (type === "WHATSAPP_CLOUD") return "WhatsApp Cloud API is not connected for this company.";
  if (type === "WHATSAPP_TEMPLATE_SETTINGS") return "Template settings are not configured for this company.";
  return `${type.replaceAll("_", " ")} missing.`;
}

function asDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function recipientCounts(recipients: Array<{ status: string; replied: boolean; converted: boolean }>) {
  return recipients.reduce(
    (counts, recipient) => {
      counts.total += 1;
      if (recipient.status === "QUEUED") counts.queued += 1;
      if (recipient.status === "SENT") counts.sent += 1;
      if (recipient.status === "FAILED") counts.failed += 1;
      if (recipient.status === "SKIPPED") counts.skipped += 1;
      if (recipient.replied || recipient.status === "REPLIED") counts.replied += 1;
      if (recipient.converted || recipient.status === "CONVERTED") counts.converted += 1;
      return counts;
    },
    { total: 0, queued: 0, sent: 0, failed: 0, skipped: 0, replied: 0, converted: 0 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "CAMPAIGNS");
    const tenantId = user.tenantId!;
    await Promise.all([ensureIntegrationSchema(), ensureLeadWorkspaceSchema()]);

    const [integrations, templates, contacts, campaigns] = await Promise.all([
      prisma.integration.findMany({
        where: { tenantId, type: { in: ["WHATSAPP_CLOUD", "WHATSAPP_TEMPLATE_SETTINGS"] } },
        select: { type: true, status: true, lastVerificationError: true }
      }),
      prisma.whatsAppTemplate.findMany({
        where: { tenantId },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
      }),
      prisma.contact.findMany({
        where: { tenantId },
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        take: 500
      }),
      prisma.campaign.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          recipients: {
            orderBy: { createdAt: "asc" },
            take: 1000,
            include: {
              contact: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  leadTemperature: true,
                  source: true
                }
              }
            }
          }
        }
      })
    ]);

    const templateById = new Map(templates.map((template) => [template.id, template]));
    const integrationByType = new Map(integrations.map((integration) => [integration.type, integration]));

    return json({
      integrations: ["WHATSAPP_CLOUD", "WHATSAPP_TEMPLATE_SETTINGS"].map((type) => {
        const integration = integrationByType.get(type as "WHATSAPP_CLOUD");
        return {
          type,
          status: integration?.status ?? "NOT_CONNECTED",
          ready: integration?.status === "CONNECTED",
          message: integrationMessage(type, integration?.status, integration?.lastVerificationError)
        };
      }),
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        body: template.body,
        updatedAt: template.updatedAt.toISOString()
      })),
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        optIn: contact.optIn,
        optOut: contact.optOut,
        source: contact.source,
        tags: contact.tags,
        leadTemperature: contact.leadTemperature,
        customerReplyCount: contact.customerReplyCount,
        lastMessageAt: contact.lastMessageAt?.toISOString() ?? null
      })),
      campaigns: campaigns.map((campaign) => {
        const template = campaign.templateId ? templateById.get(campaign.templateId) : null;
        return {
          id: campaign.id,
          name: campaign.name,
          goal: campaign.goal,
          status: campaign.status,
          templateId: campaign.templateId,
          templateName: template?.name ?? null,
          templateLanguage: template?.language ?? null,
          audienceType: campaign.audienceType,
          scheduleConfig: campaign.scheduleConfig,
          retargetRules: campaign.retargetRules,
          stats: campaign.stats ?? recipientCounts(campaign.recipients),
          createdAt: campaign.createdAt.toISOString(),
          updatedAt: campaign.updatedAt.toISOString(),
          recipients: campaign.recipients.slice(0, 8).map((recipient) => ({
            id: recipient.id,
            status: recipient.status,
            clicked: recipient.clicked,
            replied: recipient.replied,
            converted: recipient.converted,
            contact: recipient.contact
          }))
        };
      }),
      metrics: {
        totalCampaigns: campaigns.length,
        running: campaigns.filter((campaign) => campaign.status === "RUNNING").length,
        scheduled: campaigns.filter((campaign) => campaign.status === "SCHEDULED").length,
        completed: campaigns.filter((campaign) => campaign.status === "COMPLETED").length,
        optedInContacts: contacts.filter((contact) => contact.optIn && !contact.optOut).length,
        approvedTemplates: templates.filter((template) => template.status === "APPROVED").length
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "CAMPAIGNS");
    const tenantId = user.tenantId!;
    await Promise.all([ensureIntegrationSchema(), ensureLeadWorkspaceSchema()]);

    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const goal = String(body.goal ?? "").trim();
    const templateId = String(body.templateId ?? "").trim();
    const audienceType = String(body.audienceType ?? "selected_contacts").trim() || "selected_contacts";
    const scheduledAt = asDate(body.scheduledAt);
    const contactIds = Array.isArray(body.contactIds)
      ? Array.from(new Set(body.contactIds.map((id) => String(id).trim()).filter(Boolean)))
      : [];

    if (name.length < 3) {
      throw new ApiError(400, "CAMPAIGN_NAME_REQUIRED", "Campaign name must be at least 3 characters.");
    }
    if (!goal) {
      throw new ApiError(400, "CAMPAIGN_GOAL_REQUIRED", "Campaign goal is required.");
    }
    if (!templateId) {
      throw new ApiError(400, "TEMPLATE_REQUIRED", "Select an approved template before creating a campaign.");
    }

    const [template, contacts] = await Promise.all([
      prisma.whatsAppTemplate.findFirst({
        where: { tenantId, id: templateId, status: "APPROVED" }
      }),
      prisma.contact.findMany({
        where: contactIds.length
          ? { tenantId, id: { in: contactIds }, optIn: true, optOut: false }
          : { tenantId, optIn: true, optOut: false },
        orderBy: { createdAt: "asc" },
        take: 1000
      })
    ]);

    if (!template) {
      throw new ApiError(404, "TEMPLATE_NOT_APPROVED", "Approved template not found for this company.");
    }
    if (!contacts.length) {
      throw new ApiError(400, "AUDIENCE_REQUIRED", "Select or import opted-in contacts before creating a campaign.");
    }
    if (contacts.length > 1000) {
      throw new ApiError(413, "CAMPAIGN_TOO_LARGE", "Create campaigns with up to 1000 contacts.");
    }

    const status = scheduledAt && scheduledAt.getTime() > Date.now() ? "SCHEDULED" : "DRAFT";
    const stats = {
      total: contacts.length,
      queued: contacts.length,
      sent: 0,
      failed: 0,
      skipped: 0,
      replied: 0,
      converted: 0
    };
    const campaign = await prisma.campaign.create({
      data: {
        tenantId,
        name,
        goal,
        status,
        templateId: template.id,
        audienceType,
        scheduleConfig: {
          scheduledAt: scheduledAt?.toISOString() ?? null
        } as Prisma.InputJsonValue,
        stats: stats as Prisma.InputJsonValue,
        createdById: user.id,
        recipients: {
          create: contacts.map((contact) => ({
            tenantId,
            contactId: contact.id,
            status: "QUEUED"
          }))
        }
      }
    });

    void safeCreateAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "campaigns.created",
      entityType: "Campaign",
      entityId: campaign.id,
      newValue: {
        name,
        status,
        audienceSize: contacts.length
      }
    });

    return json({
      ok: true,
      campaignId: campaign.id,
      message: status === "SCHEDULED" ? "Campaign scheduled." : "Campaign draft created.",
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
