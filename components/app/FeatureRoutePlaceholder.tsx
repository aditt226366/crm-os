"use client";

import {
  BarChart3,
  Bot,
  ContactRound,
  FileText,
  Megaphone,
  RadioTower,
  Settings,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
  Workflow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { routeFeatureKey, FEATURE_DEFINITIONS } from "@/lib/constants";
import { FeatureGuard } from "@/components/app/FeatureGuard";
import { PageHeader } from "@/components/app/PageHeader";
import { GlassCard } from "@/components/shared/GlassCard";
import { StatusBadge } from "@/components/shared/StatusBadge";

type PlaceholderCopy = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyBody: string;
  highlights: string[];
};

const routeCopy: Record<string, PlaceholderCopy> = {
  leads: {
    title: "Lead Management",
    subtitle: "Manage lead scoring, temperature, source, ownership, and lead status.",
    icon: BarChart3,
    emptyTitle: "No lead list selected yet",
    emptyBody: "Conversation-linked leads will appear here with temperature, source, owner, and status controls.",
    highlights: ["Lead temperature", "Source attribution", "Owner and status"]
  },
  orders: {
    title: "Orders",
    subtitle: "Track customer orders, quantities, products, and delivery details.",
    icon: ShoppingBag,
    emptyTitle: "No orders captured yet",
    emptyBody: "Orders created from conversations will appear here with product, quantity, delivery, and fulfillment details.",
    highlights: ["Conversation-linked orders", "Products and quantities", "Delivery details"]
  },
  contacts: {
    title: "Contacts",
    subtitle: "Manage imported contacts, segmentation, tags, and source data.",
    icon: ContactRound,
    emptyTitle: "No contact segment selected yet",
    emptyBody: "Imported and WhatsApp-created contacts will appear here with tags, opt-in state, and source data.",
    highlights: ["Imported contacts", "Tags and segments", "Source data"]
  },
  templates: {
    title: "Templates",
    subtitle: "Manage approved WhatsApp templates and message previews.",
    icon: FileText,
    emptyTitle: "No template preview selected",
    emptyBody: "Approved WhatsApp templates will appear here with category, language, approval state, and preview copy.",
    highlights: ["Approved templates", "Message previews", "Language and category"]
  },
  settings: {
    title: "Settings",
    subtitle: "Manage workspace preferences, integrations, and team access.",
    icon: Settings,
    emptyTitle: "Workspace settings are ready",
    emptyBody: "Use this area to manage integrations, team access, and company workspace preferences.",
    highlights: ["Workspace preferences", "Integrations", "Team access"]
  },
  "settings/integrations": {
    title: "Integrations",
    subtitle: "Manage workspace integrations and connection health.",
    icon: Bot,
    emptyTitle: "No integration selected",
    emptyBody: "Meta WhatsApp, AI provider, Google Sheets, webhook, and CRM API connection states will appear here.",
    highlights: ["Connection status", "Masked credentials", "Sync health"]
  },
  "settings/team": {
    title: "Team Access",
    subtitle: "Manage company owners, agents, and workspace access.",
    icon: Users,
    emptyTitle: "No team member selected",
    emptyBody: "Company owners and agents will appear here with role, status, and access controls.",
    highlights: ["Owners and agents", "Roles", "Access state"]
  },
  broadcasts: {
    title: "Broadcasts",
    subtitle: "Create and monitor bulk WhatsApp broadcasts.",
    icon: RadioTower,
    emptyTitle: "No broadcast selected",
    emptyBody: "Broadcast drafts and delivery progress will appear here once this module is built out.",
    highlights: ["Audience import", "Template send", "Delivery progress"]
  },
  campaigns: {
    title: "Campaigns",
    subtitle: "Draft, schedule, launch, pause, and measure template campaigns.",
    icon: Megaphone,
    emptyTitle: "No campaign selected",
    emptyBody: "Campaign drafts, schedules, audiences, and reply outcomes will appear here.",
    highlights: ["Campaign drafts", "Scheduling", "Reply outcomes"]
  },
  ads: {
    title: "Ads",
    subtitle: "Track click-to-WhatsApp ads, source attribution, ROI, and leads.",
    icon: Target,
    emptyTitle: "No ad source selected",
    emptyBody: "Ad sources and conversation attribution will appear here once ads data is connected.",
    highlights: ["Source attribution", "Lead tracking", "ROI signals"]
  },
  workflows: {
    title: "AI Workflow Builder",
    subtitle: "Build triggers, conditions, AI replies, scoring, handoff, delays, and webhooks.",
    icon: Workflow,
    emptyTitle: "No workflow selected",
    emptyBody: "Automation workflows will appear here with trigger, branch, reply, and handoff logic.",
    highlights: ["Triggers", "AI replies", "Human handoff"]
  },
  "human-queue": {
    title: "Human Queue",
    subtitle: "Review priority conversations that need agent attention.",
    icon: Users,
    emptyTitle: "No queue item selected",
    emptyBody: "Human takeover items will appear here with priority, reason, owner, and SLA context.",
    highlights: ["Priority", "Reason", "SLA context"]
  }
};

function copyForRoute(module: string): PlaceholderCopy {
  const normalized = module.toLowerCase();
  const featureKey = routeFeatureKey(module);
  const definition = featureKey ? FEATURE_DEFINITIONS[featureKey] : null;

  return routeCopy[normalized] ?? {
    title: definition?.name ?? module,
    subtitle: definition?.description ?? "This module is available in the company panel.",
    icon: Sparkles,
    emptyTitle: `${definition?.navLabel ?? "Module"} is ready`,
    emptyBody: "Module-specific data and actions will appear here as this area is built out.",
    highlights: ["Tenant scoped", "Feature gated", "Inbox linked"]
  };
}

export function FeatureRoutePlaceholder({ module }: { module: string }) {
  const featureKey = routeFeatureKey(module);
  const copy = copyForRoute(module);
  const Icon = copy.icon;

  return (
    <FeatureGuard featureKey={featureKey}>
      <div className="space-y-6">
        <PageHeader
          eyebrow={copy.title}
          title={copy.title}
          description={copy.subtitle}
          actions={<StatusBadge value="ENABLED" />}
        />
        <GlassCard className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100 shadow-glow">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-white">{copy.emptyTitle}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{copy.emptyBody}</p>
              </div>
            </div>
            <StatusBadge value={featureKey ?? "MODULE"} />
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {copy.highlights.map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <p className="text-sm font-semibold text-white">{item}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </FeatureGuard>
  );
}
