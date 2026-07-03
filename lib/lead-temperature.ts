import { prisma } from "@/lib/prisma";

export type LeadTemperature = "HOT" | "WARM" | "SCRAP";

export function calculateLeadTemperature(customerReplyCount: number): LeadTemperature {
  if (customerReplyCount >= 6) {
    return "HOT";
  }
  if (customerReplyCount >= 2) {
    return "WARM";
  }
  return "SCRAP";
}

export async function recalculateConversationLeadTemperature({
  tenantId,
  contactId,
  conversationId
}: {
  tenantId: string;
  contactId: string;
  conversationId: string;
}) {
  const [customerReplyCount, totalMessageCount, contact, conversation] = await Promise.all([
    prisma.message.count({
      where: {
        tenantId,
        conversationId,
        direction: "INBOUND"
      }
    }),
    prisma.message.count({
      where: {
        tenantId,
        conversationId
      }
    }),
    prisma.contact.findFirst({
      where: { id: contactId, tenantId },
      select: { leadTemperatureOverride: true }
    }),
    prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { source: true, assignedUserId: true }
    })
  ]);

  const automaticTemperature = calculateLeadTemperature(customerReplyCount);
  const effectiveTemperature = contact?.leadTemperatureOverride ?? automaticTemperature;

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        customerReplyCount,
        totalMessageCount
      }
    });

    await tx.contact.update({
      where: { id: contactId },
      data: {
        customerReplyCount,
        totalMessageCount,
        leadTemperature: effectiveTemperature
      }
    });

    const existingLead = await tx.lead.findFirst({
      where: {
        tenantId,
        contactId,
        conversationId
      }
    });

    if (existingLead) {
      await tx.lead.update({
        where: { id: existingLead.id },
        data: {
          temperature: effectiveTemperature,
          source: conversation?.source ?? "ORGANIC",
          score: Math.min(100, customerReplyCount * 12)
        }
      });
      return;
    }

    await tx.lead.create({
      data: {
        tenantId,
        contactId,
        conversationId,
        source: conversation?.source ?? "ORGANIC",
        temperature: effectiveTemperature,
        assignedUserId: conversation?.assignedUserId ?? null,
        score: Math.min(100, customerReplyCount * 12)
      }
    });
  });

  return {
    automaticTemperature,
    effectiveTemperature,
    customerReplyCount,
    totalMessageCount
  };
}
