export const ROLES = ["PLATFORM_ADMIN", "COMPANY_OWNER", "COMPANY_AGENT"] as const;
export const PLANS = ["STARTER", "PRO", "ENTERPRISE"] as const;
export const TENANT_STATUSES = ["ACTIVE", "DEACTIVATED"] as const;
export const USER_STATUSES = ["ACTIVE", "DEACTIVATED"] as const;

export type Role = (typeof ROLES)[number];
export type Plan = (typeof PLANS)[number];
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];
export type IntegrationStatus = "CONNECTED" | "NOT_CONNECTED" | "ERROR" | "PARTIALLY_CONNECTED";

export const FEATURE_KEYS = [
  "ADS",
  "BULK_MESSAGING",
  "CAMPAIGNS",
  "AI_WORKFLOW_BUILDER",
  "LEAD_MANAGEMENT",
  "INBOX",
  "CONTACTS",
  "TEMPLATES",
  "ORDERS",
  "KNOWLEDGE_BASE",
  "SETTINGS",
  "ANALYTICS",
  "HUMAN_TAKEOVER",
  "GOOGLE_SHEETS_IMPORT",
  "META_WHATSAPP_INTEGRATION",
  "AI_AGENTS"
] as const;

export const MANAGED_FEATURE_KEYS = [
  "ADS",
  "BULK_MESSAGING",
  "CAMPAIGNS",
  "AI_WORKFLOW_BUILDER",
  "LEAD_MANAGEMENT",
  "INBOX"
] as const satisfies readonly FeatureKey[];

const managedFeatureKeySet = new Set<FeatureKey>(MANAGED_FEATURE_KEYS);

export function isManagedFeatureKey(value: string): value is (typeof MANAGED_FEATURE_KEYS)[number] {
  return managedFeatureKeySet.has(value as FeatureKey);
}

export function managedFeatureOrder(value: string) {
  const index = MANAGED_FEATURE_KEYS.findIndex((featureKey) => featureKey === value);
  return index === -1 ? MANAGED_FEATURE_KEYS.length : index;
}

export const FEATURE_DEFINITIONS: Record<
  FeatureKey,
  { name: string; description: string; navLabel: string; route: string; showInNavigation?: boolean }
> = {
  ADS: {
    name: "Ads",
    navLabel: "Ads",
    route: "/app/ads",
    description: "Click-to-WhatsApp ads, source attribution, ROI, and lead tracking."
  },
  BULK_MESSAGING: {
    name: "Bulk Messaging",
    navLabel: "Broadcasts",
    route: "/app/broadcasts",
    description: "CSV import, template selection, scheduled sends, retries, and limits."
  },
  CAMPAIGNS: {
    name: "Campaigns",
    navLabel: "Campaigns",
    route: "/app/campaigns",
    description: "Draft, schedule, launch, pause, and measure template campaigns."
  },
  AI_WORKFLOW_BUILDER: {
    name: "AI Workflow Builder",
    navLabel: "AI Workflow Builder",
    route: "/app/workflows",
    description: "Triggers, conditions, AI replies, scoring, handoff, delays, and webhooks."
  },
  LEAD_MANAGEMENT: {
    name: "Lead Management",
    navLabel: "Lead Management",
    route: "/app/leads",
    description: "Track lead score, source, labels, owner, and conversion status."
  },
  INBOX: {
    name: "Inbox",
    navLabel: "Inbox",
    route: "/app/inbox",
    description: "WhatsApp-style live conversations with assignment and status tracking."
  },
  CONTACTS: {
    name: "Contacts",
    navLabel: "Contacts",
    route: "/app/contacts",
    description: "Company contact records, search, tags, and segmentation basics."
  },
  TEMPLATES: {
    name: "Templates",
    navLabel: "Templates",
    route: "/app/templates",
    description: "WhatsApp template metadata and approval status for future sending."
  },
  ORDERS: {
    name: "Orders",
    navLabel: "Orders",
    route: "/app/orders",
    description: "Order intent, draft orders, fulfillment states, and conversation-linked updates."
  },
  KNOWLEDGE_BASE: {
    name: "Knowledge Base",
    navLabel: "Knowledge Base",
    route: "/app/knowledge-base",
    description: "Company-specific documents, FAQs, and RAG grounding for AI replies."
  },
  SETTINGS: {
    name: "Settings",
    navLabel: "Settings",
    route: "/app/settings",
    description: "Team, integrations, workspace controls, and secure connection status."
  },
  ANALYTICS: {
    name: "Analytics",
    navLabel: "Reports",
    route: "/app/reports",
    description: "Performance summaries for campaigns, inbox, delivery, and cost.",
    showInNavigation: false
  },
  HUMAN_TAKEOVER: {
    name: "Human Takeover",
    navLabel: "Human Queue",
    route: "/app/human-queue",
    description: "Pause AI automation and route priority conversations to agents."
  },
  GOOGLE_SHEETS_IMPORT: {
    name: "Google Sheets Import",
    navLabel: "Sheets Import",
    route: "/app/settings/integrations",
    description: "Import audiences from Google Sheets with validation and dedupe.",
    showInNavigation: false
  },
  META_WHATSAPP_INTEGRATION: {
    name: "Meta WhatsApp Integration",
    navLabel: "Meta WhatsApp",
    route: "/app/settings/integrations",
    description: "Meta Cloud API connection state and webhook readiness.",
    showInNavigation: false
  },
  AI_AGENTS: {
    name: "AI Agents",
    navLabel: "AI Agents",
    route: "/app/settings/integrations",
    description: "AI providers, agent prompts, and automated response configuration.",
    showInNavigation: false
  }
};

export const DASHBOARD_NAVIGATION = {
  featureKey: null,
  label: "Dashboard",
  href: "/app/dashboard"
} as const;

export const INTEGRATION_TYPES = [
  "GOOGLE_SHEETS",
  "WHATSAPP_CLOUD",
  "WHATSAPP_TEMPLATE_SETTINGS",
  "META_ADS",
  "KNOWLEDGE_BASE",
  "AI_MODEL"
] as const;

export const INTEGRATION_DEFINITIONS: Record<
  IntegrationType,
  { name: string; description: string; provider: string }
> = {
  GOOGLE_SHEETS: {
    name: "Google Sheets",
    provider: "google",
    description: "Connect Google Sheets for lead storage, lead sync, CSV-style audience import, and campaign data."
  },
  WHATSAPP_CLOUD: {
    name: "WhatsApp Cloud API",
    provider: "meta",
    description: "Connect Meta WhatsApp Cloud API for inbox, manual replies, broadcast, campaigns, templates, and webhook events."
  },
  WHATSAPP_TEMPLATE_SETTINGS: {
    name: "Broadcast & Campaign Templates",
    provider: "meta",
    description: "Set the default approved WhatsApp template used for broadcasts and campaigns."
  },
  META_ADS: {
    name: "Meta Ads",
    provider: "meta",
    description: "Connect Meta Ads for Click-to-WhatsApp campaign publishing, audience sync, and ad performance tracking."
  },
  KNOWLEDGE_BASE: {
    name: "Knowledge Base",
    provider: "knowledge",
    description: "Upload company knowledge or connect a company website so the AI agent can answer using RAG."
  },
  AI_MODEL: {
    name: "AI Model for Messaging",
    provider: "ai",
    description: "Connect the AI model used for AI replies, AI workflow builder, lead qualification, and RAG answers."
  }
};

export function defaultEnabledFeatures(plan: Plan): Set<FeatureKey> {
  if (plan === "ENTERPRISE" || plan === "PRO") {
    return new Set(MANAGED_FEATURE_KEYS);
  }

  return new Set(["INBOX", "LEAD_MANAGEMENT"]);
}

export function getEnabledNavigation(features: Array<{ featureKey: string; enabled: boolean }>) {
  return features
    .filter((feature) => {
      const definition = FEATURE_DEFINITIONS[feature.featureKey as FeatureKey];
      return Boolean(
        feature.enabled &&
        definition &&
        isManagedFeatureKey(feature.featureKey) &&
        definition.showInNavigation !== false
      );
    })
    .map((feature) => {
      const definition = FEATURE_DEFINITIONS[feature.featureKey as FeatureKey];
      return {
        featureKey: feature.featureKey as FeatureKey,
        label: definition.navLabel,
        href: definition.route
      };
    });
}

export function routeFeatureKey(module: string): FeatureKey | null {
  const normalized = module.toLowerCase().replace(/^\/app\/?/, "");
  if (!normalized || normalized === "dashboard") {
    return null;
  }
  if (normalized === "settings/integrations" || normalized === "settings/team") {
    return "SETTINGS";
  }
  const match = Object.entries(FEATURE_DEFINITIONS).find(
    ([, definition]) => definition.route.replace(/^\/app\/?/, "") === normalized || definition.route.split("/").pop() === normalized
  );
  return match ? (match[0] as FeatureKey) : null;
}
