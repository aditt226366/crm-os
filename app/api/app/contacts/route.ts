import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function integrationMessage(type: string, status?: string | null, error?: string | null) {
  if (status === "CONNECTED") {
    return `${type.replaceAll("_", " ")} connected.`;
  }
  if (error) return error;
  if (type === "WHATSAPP_CLOUD") return "WhatsApp Cloud API is not connected for this company.";
  if (type === "WHATSAPP_TEMPLATE_SETTINGS") return "Template settings are not configured for this company.";
  return `${type.replaceAll("_", " ")} missing.`;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "CONTACTS");
    const tenantId = user.tenantId!;
    await ensureLeadWorkspaceSchema();

    const [integrations, templates, contacts, broadcasts, sentTemplates] = await Promise.all([
      prisma.integration.findMany({
        where: { tenantId, type: { in: ["WHATSAPP_CLOUD", "WHATSAPP_TEMPLATE_SETTINGS", "META_ADS"] } },
        select: { type: true, status: true, lastVerificationError: true, metadata: true }
      }),
      prisma.whatsAppTemplate.findMany({
        where: { tenantId },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
      }),
      prisma.contact.findMany({
        where: { tenantId },
        orderBy: [{ lastContactedAt: "desc" }, { updatedAt: "desc" }],
        take: 250,
        include: {
          messages: {
            where: { direction: "OUTBOUND", type: "TEMPLATE" },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }),
      prisma.broadcast.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 8
      }),
      prisma.message.count({
        where: { tenantId, direction: "OUTBOUND", type: "TEMPLATE" }
      })
    ]);

    const templateById = new Map(templates.map((template) => [template.id, template]));
    const integrationByType = new Map(integrations.map((integration) => [integration.type, integration]));

    return json({
      integrations: ["WHATSAPP_CLOUD", "WHATSAPP_TEMPLATE_SETTINGS", "META_ADS"].map((type) => {
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
      contacts: contacts.map((contact) => {
        const latestMessage = contact.messages[0];
        const template = latestMessage?.templateId ? templateById.get(latestMessage.templateId) : null;
        const metadata = asRecord(latestMessage?.metadata);
        return {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          optIn: contact.optIn,
          optOut: contact.optOut,
          source: contact.source,
          tags: contact.tags,
          leadTemperature: contact.leadTemperature,
          customerReplyCount: contact.customerReplyCount,
          lastMessageAt: contact.lastMessageAt?.toISOString() ?? null,
          lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
          latestTemplate: latestMessage
            ? {
                name: template?.name ?? String(metadata.templateName ?? "Template"),
                body: latestMessage.body,
                status: latestMessage.status,
                sentAt: latestMessage.createdAt.toISOString()
              }
            : null
        };
      }),
      broadcasts: broadcasts.map((broadcast) => ({
        id: broadcast.id,
        name: broadcast.name,
        status: broadcast.status,
        launchedAt: broadcast.launchedAt?.toISOString() ?? null,
        completedAt: broadcast.completedAt?.toISOString() ?? null,
        stats: broadcast.stats
      })),
      metrics: {
        totalContacts: contacts.length,
        optedIn: contacts.filter((contact) => contact.optIn && !contact.optOut).length,
        approvedTemplates: templates.filter((template) => template.status === "APPROVED").length,
        sentTemplates
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
