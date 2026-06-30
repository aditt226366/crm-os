import { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword, encryptJson, maskSecret } from "../lib/security";
import {
  INTEGRATION_TYPES,
  MANAGED_FEATURE_KEYS,
  defaultEnabledFeatures,
  type FeatureKey,
  type IntegrationType,
  type Plan
} from "../lib/constants";
import { env } from "../lib/env";

const prisma = new PrismaClient();

const companies: Array<{
  name: string;
  slug: string;
  plan: Plan;
  ownerName: string;
  ownerEmail: string;
  password: string;
}> = [
  {
    name: "Nova Retail",
    slug: "nova-retail",
    plan: "STARTER",
    ownerName: "Mira Patel",
    ownerEmail: "owner@nova-retail.test",
    password: "NovaRetail123!"
  },
  {
    name: "Astra Growth",
    slug: "astra-growth",
    plan: "PRO",
    ownerName: "Aarav Mehta",
    ownerEmail: "owner@astra-growth.test",
    password: "AstraGrowth123!"
  },
  {
    name: "Zenith Commerce",
    slug: "zenith-commerce",
    plan: "ENTERPRISE",
    ownerName: "Nora Ali",
    ownerEmail: "owner@zenith-commerce.test",
    password: "ZenithCommerce123!"
  }
];

async function seedFeatures(tenantId: string, plan: Plan, adminId: string) {
  const enabled = defaultEnabledFeatures(plan);
  await Promise.all(
    MANAGED_FEATURE_KEYS.map((featureKey) =>
      prisma.tenantFeature.upsert({
        where: { tenantId_featureKey: { tenantId, featureKey } },
        create: {
          tenantId,
          featureKey,
          enabled: enabled.has(featureKey),
          updatedById: adminId
        },
        update: {
          enabled: enabled.has(featureKey),
          updatedById: adminId
        }
      })
    )
  );
}

async function seedIntegrations(tenantId: string, adminId: string, connected: IntegrationType[]) {
  await Promise.all(
    INTEGRATION_TYPES.map((type) => {
      const isConnected = connected.includes(type);
      const suffix = tenantId.slice(-6);
      const token = `${type.toLowerCase()}_${suffix}_secret_token`;
      const configByType: Record<IntegrationType, Record<string, string>> = {
        GOOGLE_SHEETS: {
          GOOGLE_SHEETS_ID: `sheet_${suffix}`,
          GOOGLE_SERVICE_ACCOUNT_EMAIL: `service-${suffix}@example.iam.gserviceaccount.com`,
          GOOGLE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${token}\n-----END PRIVATE KEY-----`
        },
        WHATSAPP_CLOUD: {
          WHATSAPP_PHONE_NUMBER_ID: `1555000${suffix.replace(/\D/g, "").slice(0, 3) || "001"}`,
          WHATSAPP_BUSINESS_ACCOUNT_ID: `789000${suffix.replace(/\D/g, "").slice(0, 3) || "001"}`,
          WHATSAPP_ACCESS_TOKEN: token,
          WHATSAPP_VERIFY_TOKEN: `verify_${suffix}`
        },
        WHATSAPP_TEMPLATE_SETTINGS: {
          WHATSAPP_TEMPLATE_NAME: "welcome_offer",
          WHATSAPP_TEMPLATE_LANGUAGE: "en_US"
        },
        META_ADS: {
          META_ADS_ACCESS_TOKEN: token,
          META_AD_ACCOUNT_ID: `act_12345${suffix.replace(/\D/g, "").slice(0, 3) || "001"}`
        },
        KNOWLEDGE_BASE: {
          COMPANY_WEBSITE_URL: `https://${suffix}.example.com`
        },
        AI_MODEL: {
          AI_PROVIDER: "OpenAI",
          AI_MODEL_NAME: "gpt-4.1-mini",
          AI_API_KEY: token
        }
      };
      const config = configByType[type];
      const connectedDisplay = Object.fromEntries(
        Object.entries(config).map(([key, value]) => [
          key,
          /(token|key|email|id)/i.test(key) ? maskSecret(value) : value
        ])
      );
      return prisma.integration.upsert({
        where: { tenantId_type: { tenantId, type } },
        create: {
          tenantId,
          type,
          status: isConnected ? "CONNECTED" : "NOT_CONNECTED",
          encryptedConfig: isConnected ? encryptJson(config) : Prisma.DbNull,
          maskedDisplay: isConnected ? connectedDisplay : { status: "not connected" },
          metadata: isConnected ? { demo: true, provider: type.toLowerCase() } : Prisma.JsonNull,
          lastVerifiedAt: isConnected ? new Date(Date.now() - 1000 * 60 * 60 * 48) : null,
          lastVerificationError: null,
          createdById: adminId
        },
        update: {
          status: isConnected ? "CONNECTED" : "NOT_CONNECTED",
          encryptedConfig: isConnected ? encryptJson(config) : Prisma.DbNull,
          maskedDisplay: isConnected ? connectedDisplay : { status: "not connected" },
          metadata: isConnected ? { demo: true, provider: type.toLowerCase() } : Prisma.JsonNull,
          lastVerifiedAt: isConnected ? new Date(Date.now() - 1000 * 60 * 60 * 48) : null,
          lastVerificationError: null,
          createdById: adminId
        }
      });
    })
  );
}

async function seedUsage(tenantId: string, plan: Plan) {
  await prisma.apiUsageLog.deleteMany({ where: { tenantId } });
  const providers = ["meta", "openai", "google", "internal"];
  const enabled = Array.from(defaultEnabledFeatures(plan));
  const rows = Array.from({ length: 18 }).map((_, index) => {
    const feature = enabled[index % enabled.length] ?? ("INBOX" as FeatureKey);
    const units = 1 + ((index * 7) % 34);
    return {
      tenantId,
      featureKey: feature,
      provider: providers[index % providers.length],
      eventType: index % 3 === 0 ? "message.sent" : index % 3 === 1 ? "ai.intent" : "workflow.run",
      endpoint: `/api/${feature.toLowerCase().replaceAll("_", "-")}`,
      units,
      cost: Number((units * (index % 2 === 0 ? 0.004 : 0.012)).toFixed(6)),
      status: index % 7 === 0 ? "FAILED" : "SUCCESS",
      metadata: { sample: true, batch: index + 1 },
      createdAt: new Date(Date.now() - index * 1000 * 60 * 60 * 5)
    };
  });

  await prisma.apiUsageLog.createMany({ data: rows });
}

function temperatureFromReplies(customerReplyCount: number) {
  if (customerReplyCount >= 6) return "HOT";
  if (customerReplyCount >= 2) return "WARM";
  return "SCRAP";
}

async function resetWorkspaceDemo(tenantId: string) {
  await prisma.workflowRunStep.deleteMany({ where: { tenantId } });
  await prisma.workflowRun.deleteMany({ where: { tenantId } });
  await prisma.knowledgeChunk.deleteMany({ where: { tenantId } });
  await prisma.knowledgeDocument.deleteMany({ where: { tenantId } });
  await prisma.humanQueueItem.deleteMany({ where: { tenantId } });
  await prisma.order.deleteMany({ where: { tenantId } });
  await prisma.broadcastRecipient.deleteMany({ where: { tenantId } });
  await prisma.campaignRecipient.deleteMany({ where: { tenantId } });
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });
  await prisma.conversation.deleteMany({ where: { tenantId } });
  await prisma.contact.deleteMany({ where: { tenantId } });
  await prisma.broadcast.deleteMany({ where: { tenantId } });
  await prisma.campaign.deleteMany({ where: { tenantId } });
  await prisma.adCampaign.deleteMany({ where: { tenantId } });
  await prisma.workflow.deleteMany({ where: { tenantId } });
  await prisma.whatsAppTemplate.deleteMany({ where: { tenantId } });
}

async function seedWorkspaceDemo(tenantId: string, ownerId: string, slug: string) {
  await resetWorkspaceDemo(tenantId);

  const templates = await Promise.all([
    prisma.whatsAppTemplate.create({
      data: {
        tenantId,
        metaTemplateId: `${slug}_welcome_offer`,
        name: "welcome_offer",
        category: "MARKETING",
        language: "en",
        status: "APPROVED",
        body: "Hi {{1}}, thanks for your interest. Reply with what you need and our AI agent will help.",
        variables: { "1": "name" },
        components: { body: ["name"] }
      }
    }),
    prisma.whatsAppTemplate.create({
      data: {
        tenantId,
        metaTemplateId: `${slug}_order_update`,
        name: "order_update",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        body: "Your order {{1}} is now {{2}}. Reply here if you need help.",
        variables: { "1": "orderNumber", "2": "status" },
        components: { body: ["orderNumber", "status"] }
      }
    })
  ]);

  const contactSeeds = [
    {
      name: "Aisha Khan",
      phone: "+15550001001",
      source: "AD" as const,
      tags: ["vip", "order-intent"],
      inbound: [
        "Hi, I saw your WhatsApp ad.",
        "Need pricing for 50 pieces.",
        "Can you do blue color?",
        "Delivery to Dubai?",
        "I want to confirm today.",
        "Send payment details."
      ],
      outbound: ["Thanks Aisha, we can help.", "Blue is available. Sharing estimate now."],
      status: "OPEN" as const,
      hasOrder: true
    },
    {
      name: "Rohan Mehta",
      phone: "+15550001002",
      source: "CAMPAIGN" as const,
      tags: ["needs-human"],
      inbound: ["I got your campaign.", "Can someone call me?", "This is urgent."],
      outbound: ["Sure, an agent can help.", "I am moving this to our human queue."],
      status: "PENDING" as const,
      queue: true
    },
    {
      name: "Meera Shah",
      phone: "+15550001003",
      source: "ORGANIC" as const,
      tags: ["new"],
      inbound: ["Do you have a catalog?"],
      outbound: ["Yes, sharing our catalog template."],
      status: "OPEN" as const,
      expiredWindow: true
    },
    {
      name: "Dev Patel",
      phone: "+15550001004",
      source: "BROADCAST" as const,
      tags: ["broadcast-audience"],
      inbound: [],
      outbound: ["Hi Dev, our monsoon offer is live. Reply if interested."],
      status: "OPEN" as const
    }
  ];

  const created: Array<{
    contactId: string;
    conversationId: string;
    source: "AD" | "CAMPAIGN" | "ORGANIC" | "BROADCAST";
    firstOutboundMessageId?: string;
  }> = [];

  for (const [contactIndex, seed] of contactSeeds.entries()) {
    const customerReplyCount = seed.inbound.length;
    const totalMessageCount = seed.inbound.length + seed.outbound.length;
    const temperature = temperatureFromReplies(customerReplyCount);
    const now = Date.now();
    const messagePlan = [
      ...seed.outbound.map((body, index) => ({ body, direction: "OUTBOUND" as const, offset: 180 - index * 18 })),
      ...seed.inbound.map((body, index) => ({ body, direction: "INBOUND" as const, offset: 120 - index * 14 }))
    ].sort((a, b) => b.offset - a.offset);
    const lastMessage = messagePlan[messagePlan.length - 1];
    const lastMessageAt = new Date(now - (lastMessage?.offset ?? 60) * 60 * 1000);

    const contact = await prisma.contact.create({
      data: {
        tenantId,
        name: seed.name,
        phone: seed.phone,
        email: `${seed.name.toLowerCase().replaceAll(" ", ".")}@example.com`,
        source: seed.source,
        tags: seed.tags,
        leadTemperature: temperature,
        customerReplyCount,
        totalMessageCount,
        lastMessageAt,
        lastContactedAt: seed.outbound.length ? lastMessageAt : null
      }
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        contactId: contact.id,
        assignedUserId: seed.queue ? ownerId : null,
        source: seed.source,
        sourceId: `${seed.source.toLowerCase()}-${contactIndex + 1}`,
        status: seed.status,
        unreadCount: seed.inbound.length ? Math.min(seed.inbound.length, 3) : 0,
        humanTakeover: Boolean(seed.queue),
        customerReplyCount,
        totalMessageCount,
        lastMessageText: lastMessage?.body ?? null,
        lastMessageAt,
        customerServiceWindowExpiresAt: seed.expiredWindow
          ? new Date(now - 2 * 60 * 60 * 1000)
          : customerReplyCount
            ? new Date(now + 18 * 60 * 60 * 1000)
            : null
      }
    });

    let firstOutboundMessageId: string | undefined;
    for (const [messageIndex, message] of messagePlan.entries()) {
      const createdMessage = await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          contactId: contact.id,
          direction: message.direction,
          type: message.direction === "OUTBOUND" && message.body.includes("offer") ? "TEMPLATE" : "TEXT",
          body: message.body,
          templateId: message.direction === "OUTBOUND" && message.body.includes("offer") ? templates[0].id : null,
          whatsappMessageId: `${slug}-${contactIndex + 1}-${message.direction.toLowerCase()}-${messageIndex + 1}`,
          status: message.direction === "INBOUND" ? "RECEIVED" : messageIndex % 2 === 0 ? "READ" : "DELIVERED",
          metadata: { demo: true },
          createdAt: new Date(now - message.offset * 60 * 1000)
        }
      });
      if (message.direction === "OUTBOUND" && !firstOutboundMessageId) {
        firstOutboundMessageId = createdMessage.id;
      }
    }

    await prisma.lead.create({
      data: {
        tenantId,
        contactId: contact.id,
        conversationId: conversation.id,
        source: seed.source,
        temperature,
        status: seed.hasOrder ? "ORDER_INTENT" : seed.queue ? "QUALIFIED" : "NEW",
        score: Math.min(100, customerReplyCount * 12),
        productInterest: seed.hasOrder ? "Bulk custom apparel" : "WhatsApp product catalog",
        location: seed.hasOrder ? "Dubai" : null,
        assignedUserId: seed.queue ? ownerId : null
      }
    });

    if (seed.hasOrder) {
      await prisma.order.create({
        data: {
          tenantId,
          contactId: contact.id,
          conversationId: conversation.id,
          orderNumber: `${slug.toUpperCase().slice(0, 3)}-100${contactIndex + 1}`,
          products: [{ name: "Custom t-shirts", quantity: 50 }],
          quantity: 50,
          location: "Dubai",
          notes: "Customer asked for blue color and payment details.",
          status: "DRAFT",
          extractedByAI: true,
          confidence: 0.86,
          source: seed.source,
          assignedUserId: ownerId
        }
      });
    }

    if (seed.queue) {
      const queueItem = await prisma.humanQueueItem.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          contactId: contact.id,
          assignedUserId: ownerId,
          reason: "Customer requested a human callback",
          priority: 75,
          status: "ASSIGNED",
          slaDueAt: new Date(now + 24 * 60 * 1000)
        }
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { humanQueueId: queueItem.id }
      });
    }

    created.push({ contactId: contact.id, conversationId: conversation.id, source: seed.source, firstOutboundMessageId });
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      tenantId,
      name: "Monsoon offer broadcast",
      status: "COMPLETED",
      templateId: templates[0].id,
      launchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      createdById: ownerId,
      stats: { sent: 240, delivered: 226, read: 168, replied: 0, failed: 6 }
    }
  });
  const broadcastContact = created.find((item) => item.source === "BROADCAST");
  if (broadcastContact?.firstOutboundMessageId) {
    await prisma.broadcastRecipient.create({
      data: {
        tenantId,
        broadcastId: broadcast.id,
        contactId: broadcastContact.contactId,
        conversationId: broadcastContact.conversationId,
        messageId: broadcastContact.firstOutboundMessageId,
        status: "READ",
        sentAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        deliveredAt: new Date(Date.now() - 170 * 60 * 1000),
        readAt: new Date(Date.now() - 150 * 60 * 1000)
      }
    });
  }

  const campaign = await prisma.campaign.create({
    data: {
      tenantId,
      name: "June lead nurture",
      goal: "Lead Nurturing",
      status: "RUNNING",
      templateId: templates[0].id,
      audienceType: "CSV",
      scheduleConfig: { timezone: "Asia/Dubai", quietHours: true },
      retargetRules: { replied: true, noResponseAfterHours: 24 },
      stats: { sent: 180, delivered: 170, read: 118, replied: 32, converted: 4 },
      createdById: ownerId
    }
  });
  const campaignContact = created.find((item) => item.source === "CAMPAIGN");
  if (campaignContact?.firstOutboundMessageId) {
    await prisma.campaignRecipient.create({
      data: {
        tenantId,
        campaignId: campaign.id,
        contactId: campaignContact.contactId,
        conversationId: campaignContact.conversationId,
        messageId: campaignContact.firstOutboundMessageId,
        status: "REPLIED",
        replied: true,
        metadata: { demo: true }
      }
    });
  }

  await prisma.adCampaign.create({
    data: {
      tenantId,
      name: "Click to WhatsApp blue collection",
      objective: "Click to WhatsApp",
      platform: "Facebook + Instagram",
      status: "RUNNING",
      budget: { daily: 35, currency: "USD" },
      startDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      audienceConfig: { location: "UAE", leadTemperature: ["WARM", "HOT"] },
      creativeConfig: { headline: "Custom apparel quotes on WhatsApp", cta: "Send WhatsApp Message" },
      automationConfig: { workflow: "AI qualification", assignAgentId: ownerId },
      stats: { conversationsStarted: 48, leadsGenerated: 39, hotLeadsGenerated: 8 },
      createdById: ownerId
    }
  });

  await prisma.workflow.create({
    data: {
      tenantId,
      name: "Inbound qualification agent",
      description: "Qualifies inbound WhatsApp replies and escalates hot order intent.",
      status: "ACTIVE",
      graphJson: {
        nodes: [
          { id: "trigger", type: "Incoming WhatsApp Message" },
          { id: "intent", type: "AI Intent Detection" },
          { id: "handoff", type: "Add to Human Queue" }
        ],
        edges: [
          { source: "trigger", target: "intent" },
          { source: "intent", target: "handoff", condition: "order_intent_or_human_request" }
        ]
      },
      version: 1,
      createdById: ownerId
    }
  });

  const document = await prisma.knowledgeDocument.create({
    data: {
      tenantId,
      title: "Demo product catalog FAQ",
      type: "FAQ",
      status: "INDEXED",
      metadata: { source: "seed" },
      createdById: ownerId
    }
  });
  await prisma.knowledgeChunk.create({
    data: {
      tenantId,
      documentId: document.id,
      content: "Custom apparel orders support colors, sizes, quantities, delivery location, and payment confirmation.",
      embedding: { demo: true },
      metadata: { section: "orders" }
    }
  });
}

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: env.PLATFORM_ADMIN_EMAIL },
    create: {
      name: "Platform Admin",
      email: env.PLATFORM_ADMIN_EMAIL,
      username: env.PLATFORM_ADMIN_EMAIL,
      passwordHash: await hashPassword(env.PLATFORM_ADMIN_PASSWORD),
      role: "PLATFORM_ADMIN",
      status: "ACTIVE"
    },
    update: {
      passwordHash: await hashPassword(env.PLATFORM_ADMIN_PASSWORD),
      status: "ACTIVE",
      role: "PLATFORM_ADMIN"
    }
  });

  for (const company of companies) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: company.slug },
      create: {
        name: company.name,
        slug: company.slug,
        plan: company.plan,
        status: "ACTIVE"
      },
      update: {
        name: company.name,
        plan: company.plan,
        status: "ACTIVE",
        deactivatedAt: null
      }
    });

    const owner = await prisma.user.upsert({
      where: { email: company.ownerEmail },
      create: {
        tenantId: tenant.id,
        name: company.ownerName,
        email: company.ownerEmail,
        username: company.ownerEmail,
        passwordHash: await hashPassword(company.password),
        role: "COMPANY_OWNER",
        status: "ACTIVE",
        forcePasswordReset: true
      },
      update: {
        tenantId: tenant.id,
        passwordHash: await hashPassword(company.password),
        role: "COMPANY_OWNER",
        status: "ACTIVE"
      }
    });

    await seedFeatures(tenant.id, company.plan, admin.id);
    await seedIntegrations(
      tenant.id,
      admin.id,
      company.plan === "STARTER"
        ? ["GOOGLE_SHEETS"]
        : company.plan === "PRO"
          ? ["WHATSAPP_CLOUD", "GOOGLE_SHEETS", "AI_MODEL"]
          : [...INTEGRATION_TYPES]
    );
    await seedUsage(tenant.id, company.plan);
    await seedWorkspaceDemo(tenant.id, owner.id, company.slug);

    await prisma.auditLog.create({
      data: {
        actorUserId: admin.id,
        tenantId: tenant.id,
        action: "seed.company_ready",
        entityType: "Tenant",
        entityId: tenant.id,
        newValue: { plan: company.plan, slug: company.slug }
      }
    });
  }

  console.log(`Seed complete. Platform admin: ${env.PLATFORM_ADMIN_EMAIL}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
