import { Prisma, type Contact, type ConversationSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone, type NormalizedPhone } from "@/lib/phone/normalizePhone";

type ContactWithConversations = Contact & {
  conversations: Array<{
    id: string;
    source: ConversationSource;
    status: string;
    createdAt: Date;
    lastMessageAt: Date | null;
  }>;
};

type ResolveContactInput = {
  tenantId: string;
  phone: string;
  waId?: string | null;
  name?: string | null;
  source?: ConversationSource;
  optIn?: boolean;
  tags?: string[];
  customFields?: Record<string, unknown>;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sourceRank(contact: ContactWithConversations) {
  if (contact.source === "GOOGLE_SHEET") return 0;
  if (contact.conversations.some((conversation) => conversation.source === "GOOGLE_SHEET")) return 1;
  return 2;
}

function chooseKeeper(contacts: ContactWithConversations[]) {
  return [...contacts].sort((left, right) => {
    const rankDelta = sourceRank(left) - sourceRank(right);
    if (rankDelta !== 0) return rankDelta;
    return left.createdAt.getTime() - right.createdAt.getTime();
  })[0];
}

function bestName(currentName: string, incomingName?: string | null, phone?: string) {
  const incoming = incomingName?.trim();
  if (!incoming) return currentName;
  if (!currentName || currentName === phone) return incoming;
  return incoming.replace(/\s+/g, "").length > currentName.replace(/\s+/g, "").length ? incoming : currentName;
}

function bestMergedName(contacts: ContactWithConversations[], incomingName?: string | null, phone?: string) {
  return contacts.reduce(
    (current, contact) => bestName(current, contact.name, phone),
    bestName(contacts[0]?.name ?? phone ?? "", incomingName, phone)
  );
}

function mergedTags(existing: string[], incoming?: string[]) {
  if (!incoming) return existing;
  return Array.from(new Set([...existing, ...incoming])).slice(0, 24);
}

function contactPhoneData(identity: NormalizedPhone) {
  return {
    phone: identity.e164,
    phoneRaw: identity.raw || null,
    phoneNormalized: identity.e164,
    waId: identity.waId || null,
    last10: identity.last10 || null,
    countryCode: identity.countryCode || null
  };
}

function contactCustomFields({
  existing,
  identity,
  source,
  incomingName
}: {
  existing: unknown;
  identity: NormalizedPhone;
  source?: ConversationSource;
  incomingName?: string | null;
}) {
  const current = asRecord(existing);
  const sheetName =
    source === "GOOGLE_SHEET" && incomingName?.trim()
      ? incomingName.trim()
      : typeof current.sheetName === "string"
        ? current.sheetName
        : null;
  const whatsappProfileName =
    source !== "GOOGLE_SHEET" && incomingName?.trim()
      ? incomingName.trim()
      : typeof current.whatsappProfileName === "string"
        ? current.whatsappProfileName
        : null;

  return {
    ...current,
    ...(sheetName ? { sheetName } : {}),
    ...(whatsappProfileName ? { whatsappProfileName } : {}),
    phoneIdentity: {
      raw: identity.raw,
      e164: identity.e164,
      waId: identity.waId,
      last10: identity.last10,
      countryCode: identity.countryCode
    }
  };
}

function identityWhere(tenantId: string, identity: NormalizedPhone): Prisma.ContactWhereInput {
  const or: Prisma.ContactWhereInput[] = [];
  if (identity.waId) or.push({ waId: identity.waId });
  if (identity.e164) {
    or.push({ phoneNormalized: identity.e164 });
    or.push({ phone: identity.e164 });
  }
  if (identity.last10) {
    or.push({ last10: identity.last10 });
    or.push({ phone: { endsWith: identity.last10 } });
  }
  return { tenantId, OR: or.length ? or : [{ phone: identity.e164 || identity.raw }] };
}

async function openConversationsForContact(tenantId: string, contactId: string) {
  return prisma.conversation.findMany({
    where: { tenantId, contactId, status: { not: "RESOLVED" } },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "asc" }]
  });
}

function chooseConversationKeeper(
  conversations: Awaited<ReturnType<typeof openConversationsForContact>>
) {
  return [...conversations].sort((left, right) => {
    const sourceDelta = (left.source === "GOOGLE_SHEET" ? 0 : 1) - (right.source === "GOOGLE_SHEET" ? 0 : 1);
    if (sourceDelta !== 0) return sourceDelta;
    return left.createdAt.getTime() - right.createdAt.getTime();
  })[0];
}

async function refreshConversationStats(tenantId: string, conversationId: string) {
  const [latestMessage, inboundReplies, totalMessages] = await Promise.all([
    prisma.message.findFirst({
      where: { tenantId, conversationId },
      orderBy: { createdAt: "desc" }
    }),
    prisma.message.count({ where: { tenantId, conversationId, direction: "INBOUND" } }),
    prisma.message.count({ where: { tenantId, conversationId } })
  ]);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      customerReplyCount: inboundReplies,
      totalMessageCount: totalMessages,
      lastMessageText: latestMessage?.body ?? null,
      lastMessageAt: latestMessage?.createdAt ?? null
    }
  });
}

async function mergeOpenConversationsForContact(tenantId: string, contactId: string) {
  const conversations = await openConversationsForContact(tenantId, contactId);
  if (conversations.length <= 1) return conversations[0] ?? null;

  const keeper = chooseConversationKeeper(conversations);
  const duplicates = conversations.filter((conversation) => conversation.id !== keeper.id);
  const preserveGoogleSheetSource =
    keeper.source === "GOOGLE_SHEET" || duplicates.some((conversation) => conversation.source === "GOOGLE_SHEET");
  const serviceWindowDates = conversations
    .map((conversation) => conversation.customerServiceWindowExpiresAt)
    .filter((value): value is Date => Boolean(value));

  for (const duplicate of duplicates) {
    await prisma.message.updateMany({ where: { tenantId, conversationId: duplicate.id }, data: { conversationId: keeper.id } });
    await prisma.lead.updateMany({ where: { tenantId, conversationId: duplicate.id }, data: { conversationId: keeper.id } });
    await prisma.order.updateMany({ where: { tenantId, conversationId: duplicate.id }, data: { conversationId: keeper.id } });
    await prisma.humanQueueItem.updateMany({ where: { tenantId, conversationId: duplicate.id }, data: { conversationId: keeper.id } });
    await prisma.broadcastRecipient.updateMany({ where: { tenantId, conversationId: duplicate.id }, data: { conversationId: keeper.id } });
    await prisma.campaignRecipient.updateMany({ where: { tenantId, conversationId: duplicate.id }, data: { conversationId: keeper.id } });
    await prisma.workflowRun.updateMany({ where: { tenantId, conversationId: duplicate.id }, data: { conversationId: keeper.id } });
    await prisma.conversation.delete({ where: { id: duplicate.id } });
  }

  await prisma.conversation.update({
    where: { id: keeper.id },
    data: {
      source: preserveGoogleSheetSource ? "GOOGLE_SHEET" : keeper.source,
      customerServiceWindowExpiresAt: serviceWindowDates.length
        ? new Date(Math.max(...serviceWindowDates.map((value) => value.getTime())))
        : keeper.customerServiceWindowExpiresAt
    }
  });
  await refreshConversationStats(tenantId, keeper.id);
  return prisma.conversation.findUnique({ where: { id: keeper.id } });
}

async function mergeDuplicateContacts({
  tenantId,
  identity,
  contacts,
  incomingName,
  source
}: {
  tenantId: string;
  identity: NormalizedPhone;
  contacts: ContactWithConversations[];
  incomingName?: string | null;
  source?: ConversationSource;
}) {
  const keeper = chooseKeeper(contacts);
  const duplicates = contacts.filter((contact) => contact.id !== keeper.id);
  const preserveGoogleSheetSource = source === "GOOGLE_SHEET" || contacts.some((contact) => contact.source === "GOOGLE_SHEET");
  const combinedTags = Array.from(new Set(contacts.flatMap((contact) => contact.tags))).slice(0, 24);

  for (const duplicate of duplicates) {
    await prisma.message.updateMany({ where: { tenantId, contactId: duplicate.id }, data: { contactId: keeper.id } });
    await prisma.conversation.updateMany({ where: { tenantId, contactId: duplicate.id }, data: { contactId: keeper.id } });
    await prisma.lead.updateMany({ where: { tenantId, contactId: duplicate.id }, data: { contactId: keeper.id } });
    await prisma.order.updateMany({ where: { tenantId, contactId: duplicate.id }, data: { contactId: keeper.id } });
    await prisma.humanQueueItem.updateMany({ where: { tenantId, contactId: duplicate.id }, data: { contactId: keeper.id } });
    await prisma.broadcastRecipient.updateMany({ where: { tenantId, contactId: duplicate.id }, data: { contactId: keeper.id } });
    await prisma.campaignRecipient.updateMany({ where: { tenantId, contactId: duplicate.id }, data: { contactId: keeper.id } });
    await prisma.workflowRun.updateMany({ where: { tenantId, contactId: duplicate.id }, data: { contactId: keeper.id } });
    await prisma.contact.delete({ where: { id: duplicate.id } });
  }

  const updated = await prisma.contact.update({
    where: { id: keeper.id },
    data: {
      ...contactPhoneData(identity),
      name: bestMergedName(contacts, incomingName, keeper.phone),
      source: preserveGoogleSheetSource ? "GOOGLE_SHEET" : (source ?? keeper.source),
      tags: combinedTags,
      customFields: contactCustomFields({
        existing: keeper.customFields,
        identity,
        source,
        incomingName
      }) as Prisma.InputJsonValue
    }
  });
  await mergeOpenConversationsForContact(tenantId, keeper.id);
  await refreshContactStats(tenantId, keeper.id);
  return updated;
}

async function refreshContactStats(tenantId: string, contactId: string) {
  const [inboundReplies, totalMessages] = await Promise.all([
    prisma.message.count({ where: { tenantId, contactId, direction: "INBOUND" } }),
    prisma.message.count({ where: { tenantId, contactId } })
  ]);
  const leadTemperature = inboundReplies >= 6 ? "HOT" : inboundReplies >= 2 ? "WARM" : "SCRAP";

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      customerReplyCount: inboundReplies,
      totalMessageCount: totalMessages,
      leadTemperature
    }
  });
  await prisma.lead.updateMany({
    where: { tenantId, contactId },
    data: {
      temperature: leadTemperature,
      score: Math.min(100, inboundReplies * 12)
    }
  });
}

export async function resolveContactForPhone({
  tenantId,
  phone,
  waId,
  name,
  source = "ORGANIC",
  optIn,
  tags,
  customFields
}: ResolveContactInput) {
  const identity = normalizePhone(waId || phone);
  const matches = await prisma.contact.findMany({
    where: identityWhere(tenantId, identity),
    include: {
      conversations: {
        where: { status: { not: "RESOLVED" } },
        select: { id: true, source: true, status: true, createdAt: true, lastMessageAt: true }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  if (matches.length > 1) {
    const contact = await mergeDuplicateContacts({ tenantId, identity, contacts: matches, incomingName: name, source });
    return { contact, identity, created: false, merged: true };
  }

  if (matches.length === 1) {
    const existing = matches[0];
    const preserveGoogleSheetSource = existing.source === "GOOGLE_SHEET" || source === "GOOGLE_SHEET";
    const contact = await prisma.contact.update({
      where: { id: existing.id },
      data: {
        ...contactPhoneData(identity),
        name: bestName(existing.name, name, existing.phone),
        source: preserveGoogleSheetSource ? "GOOGLE_SHEET" : existing.source,
        ...(optIn === undefined ? {} : { optIn }),
        ...(tags ? { tags: mergedTags(existing.tags, tags) } : {}),
        customFields: {
          ...contactCustomFields({ existing: existing.customFields, identity, source, incomingName: name }),
          ...asRecord(customFields)
        } as Prisma.InputJsonValue
      }
    });
    await mergeOpenConversationsForContact(tenantId, existing.id);
    return { contact, identity, created: false, merged: false };
  }

  const contact = await prisma.contact.create({
    data: {
      tenantId,
      name: name?.trim() || identity.e164,
      ...contactPhoneData(identity),
      source,
      ...(optIn === undefined ? {} : { optIn }),
      ...(tags ? { tags } : {}),
      customFields: {
        ...contactCustomFields({ existing: customFields, identity, source, incomingName: name }),
        ...asRecord(customFields)
      } as Prisma.InputJsonValue
    }
  });

  return { contact, identity, created: true, merged: false };
}

export async function mergeDuplicateConversationsForTenant(tenantId: string) {
  const contacts = await prisma.contact.findMany({
    where: { tenantId },
    include: {
      conversations: {
        where: { status: { not: "RESOLVED" } },
        select: { id: true, source: true, status: true, createdAt: true, lastMessageAt: true }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  const groups = new Map<string, ContactWithConversations[]>();

  for (const contact of contacts) {
    const identity = normalizePhone(contact.waId || contact.phoneNormalized || contact.phone);
    if (!identity.last10) continue;
    const group = groups.get(identity.last10) ?? [];
    group.push(contact);
    groups.set(identity.last10, group);
  }

  let mergedContacts = 0;
  let normalizedContacts = 0;
  let mergedConversations = 0;

  for (const [last10, group] of groups) {
    const identity = normalizePhone(group.find((contact) => contact.waId || contact.phoneNormalized)?.waId ?? last10);
    if (group.length > 1) {
      const merged = await mergeDuplicateContacts({ tenantId, identity, contacts: group });
      mergedContacts += group.length - 1;
      const before = await openConversationsForContact(tenantId, merged.id);
      await mergeOpenConversationsForContact(tenantId, merged.id);
      const after = await openConversationsForContact(tenantId, merged.id);
      mergedConversations += Math.max(0, before.length - after.length);
    } else {
      const contact = group[0];
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          ...contactPhoneData(identity),
          customFields: contactCustomFields({ existing: contact.customFields, identity }) as Prisma.InputJsonValue
        }
      });
      normalizedContacts += 1;
      const before = await openConversationsForContact(tenantId, contact.id);
      await mergeOpenConversationsForContact(tenantId, contact.id);
      const after = await openConversationsForContact(tenantId, contact.id);
      mergedConversations += Math.max(0, before.length - after.length);
      await refreshContactStats(tenantId, contact.id);
    }
  }

  return {
    groupsChecked: groups.size,
    mergedContacts,
    normalizedContacts,
    mergedConversations
  };
}
