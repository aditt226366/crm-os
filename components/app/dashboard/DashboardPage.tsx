"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  Flame,
  MessagesSquare,
  Package,
  Send,
  Snowflake,
  ThermometerSun,
  UserRound,
  Users
} from "lucide-react";
import { DashboardMetricCard } from "@/components/app/dashboard/DashboardMetricCard";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { useAppShell } from "@/components/app/AppLayout";
import { cn } from "@/lib/utils";

type DashboardData = {
  metrics: Record<
    | "totalLeads"
    | "hotLeads"
    | "warmLeads"
    | "scrapLeads"
    | "newConversationsToday"
    | "openConversations"
    | "humanQueueCount"
    | "ordersCaptured"
    | "activeCampaigns"
    | "broadcastsSent"
    | "messagesSent"
    | "deliveryRate"
    | "readRate"
    | "replyRate"
    | "failedMessages"
    | "inboundMessages"
    | "outboundMessages"
    | "totalConversationMessages",
    number
  >;
  charts: {
    leadFunnel: Array<{ label: string; value: number }>;
    campaignPerformance: Array<{ label: string; status: string; value: number }>;
    messageStatus: Array<{ label: string; value: number }>;
    messageDirection: Array<{ label: string; value: number }>;
    topLeadSources: Array<{ label: string; value: number }>;
    handling: Array<{ label: string; value: number }>;
  };
  recent: {
    conversations: Array<{
      id: string;
      contactName: string;
      phone: string;
      source: string;
      status: string;
      temperature: string;
      lastMessageText: string | null;
      lastMessageAt: string | null;
      unreadCount: number;
    }>;
    orders: Array<{ id: string; orderNumber: string; contactName: string; status: string; source: string; createdAt: string }>;
    humanQueue: Array<{ id: string; conversationId: string; contactName: string; reason: string; priority: number; status: string; latestMessage: string | null; createdAt: string }>;
    broadcasts: Array<{ id: string; name: string; status: string; createdAt: string }>;
    campaigns: Array<{ id: string; name: string; goal: string; status: string; createdAt: string }>;
  };
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

/* ------------------------------------------------------------------ Charts */

/** Single-hue donut showing one share (e.g. % handled by AI) on a recessive track. */
function ShareRing({ percent, centerLabel, centerCaption }: { percent: number; centerLabel: string; centerCaption: string }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative grid h-40 w-40 shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="h-40 w-40 -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="12" className="stroke-white/10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          className="stroke-cyan-300"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-3xl font-semibold text-white">{centerLabel}</p>
        <p className="mt-0.5 text-xs text-slate-500">{centerCaption}</p>
      </div>
    </div>
  );
}

/** Horizontal progress meter for a single percentage (magnitude, one hue). */
function MeterBar({ label, percent, hint }: { label: string; percent: number; hint?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-white">{formatNumber(clamped)}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(2, clamped)}%` }} />
      </div>
      {hint ? <p className="mt-1.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const statusTone: Record<string, string> = {
  Sent: "bg-cyan-300",
  Delivered: "bg-cyan-300",
  Read: "bg-cyan-300",
  Failed: "bg-rose-400",
  "Meta delivery-limited": "bg-amber-400"
};

/** Count bars with a recessive track; negative outcomes wear reserved status hues. */
function CountBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) {
    return <EmptyState title="No data yet" description="This fills in as messages are sent and received." />;
  }
  return (
    <div className="space-y-3.5">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">{row.label}</span>
            <span className="font-semibold text-white">{formatNumber(row.value)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className={cn("h-full rounded-full", statusTone[row.label] ?? "bg-cyan-300")}
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const funnelStages = [
  { label: "Scrap", icon: Snowflake, tone: "text-slate-300", ring: "border-white/15 bg-white/[0.05]" },
  { label: "Warm", icon: ThermometerSun, tone: "text-amber-100", ring: "border-amber-300/25 bg-amber-300/10" },
  { label: "Hot", icon: Flame, tone: "text-rose-200", ring: "border-rose-300/25 bg-rose-300/10" },
  { label: "Order", icon: Package, tone: "text-cyan-100", ring: "border-cyan-300/25 bg-cyan-300/10" }
] as const;

function LeadFunnel({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const byLabel = new Map(rows.map((row) => [row.label, row.value]));
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {funnelStages.map((stage, index) => {
        const Icon = stage.icon;
        return (
          <div key={stage.label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between">
              <span className={cn("grid h-9 w-9 place-items-center rounded-xl border", stage.ring, stage.tone)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-xs text-slate-600">0{index + 1}</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-white">{formatNumber(byLabel.get(stage.label) ?? 0)}</p>
            <p className="mt-0.5 text-sm text-slate-300">{stage.label}</p>
          </div>
        );
      })}
    </div>
  );
}

function SourceBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) {
    return <EmptyState title="No sources yet" description="Leads grouped by where they came from will show here." />;
  }
  return (
    <div className="space-y-3.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <span className="w-24 shrink-0 truncate text-sm capitalize text-slate-300">{row.label.toLowerCase().replaceAll("_", " ")}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
            <span className="block h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} />
          </span>
          <span className="w-8 shrink-0 text-right text-sm font-semibold text-white">{formatNumber(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Card shells */

function SectionCard({
  title,
  caption,
  children,
  className
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <GlassCard className={cn("p-5", className)}>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {caption ? <p className="mt-1 text-sm text-slate-500">{caption}</p> : null}
      <div className="mt-5">{children}</div>
    </GlassCard>
  );
}

/* ------------------------------------------------------------------- Page */

export function DashboardPage() {
  const { user } = useAppShell();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app/dashboard")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load dashboard");
        setData((await response.json()) as DashboardData);
      })
      .catch((dashboardError: Error) => setError(dashboardError.message));
  }, []);

  const companyName = user?.tenant?.name ?? "your company";

  const kpiCards = useMemo(() => {
    if (!data) return [];
    const m = data.metrics;
    return [
      ["Total messages", m.totalConversationMessages, MessagesSquare, "Everything sent and received"],
      ["Messages sent", m.outboundMessages, Send, "By your team and the AI"],
      ["Messages received", m.inboundMessages, ArrowDownLeft, "From your customers"],
      ["Conversations", m.openConversations, Users, `${formatNumber(m.newConversationsToday)} new today`],
      ["Leads", m.totalLeads, Flame, `${formatNumber(m.hotLeads)} hot · ${formatNumber(m.warmLeads)} warm`],
      ["Orders", m.ordersCaptured, Package, "Captured from chats"]
    ] as const;
  }, [data]);

  const handling = useMemo(() => {
    const rows = data?.charts.handling ?? [];
    const ai = rows.find((row) => row.label === "AI handled")?.value ?? 0;
    const human = rows.find((row) => row.label === "Human handled")?.value ?? 0;
    const total = ai + human;
    return { ai, human, total, aiPercent: total ? Math.round((ai / total) * 100) : 0 };
  }, [data]);

  if (error) {
    return (
      <GlassCard className="p-6">
        <p className="text-rose-100">{error}</p>
      </GlassCard>
    );
  }

  if (!data) {
    return <LoadingSkeleton rows={12} />;
  }

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-white md:text-4xl">
            Welcome, {companyName}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            A simple, at-a-glance view of how your WhatsApp is performing — messages, conversations, leads, and orders.
          </p>
        </div>
        <StatusBadge value="LIVE DATA" />
      </section>

      {/* KPI tiles */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map(([label, value, icon, detail]) => (
          <DashboardMetricCard key={label} label={label} value={value} icon={icon} detail={detail} />
        ))}
      </section>

      {/* Handling + delivery performance */}
      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Who is handling chats" caption="How much your AI assistant handles on its own versus your team.">
          <div className="flex items-center gap-6">
            <ShareRing
              percent={handling.aiPercent}
              centerLabel={`${handling.aiPercent}%`}
              centerCaption="by AI"
            />
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
                  <Bot className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">AI handled</p>
                  <p className="text-xs text-slate-500">{formatNumber(handling.ai)} conversations</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/[0.05] text-slate-300">
                  <UserRound className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">Human handled</p>
                  <p className="text-xs text-slate-500">{formatNumber(handling.human)} conversations</p>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="How your messages perform"
          caption="Of the messages you send, how many are delivered, opened, and replied to."
        >
          <div className="space-y-5">
            <MeterBar label="Delivered" percent={data.metrics.deliveryRate} hint="Reached the customer's phone" />
            <MeterBar label="Read" percent={data.metrics.readRate} hint="Opened by the customer" />
            <MeterBar label="Replied" percent={data.metrics.replyRate} hint="Customer wrote back" />
          </div>
        </SectionCard>
      </section>

      {/* Lead funnel */}
      <SectionCard
        title="Your leads, sorted by interest"
        caption="Every contact is scored from how they reply — cold (Scrap) to ready-to-buy (Hot), then Orders."
      >
        <LeadFunnel rows={data.charts.leadFunnel} />
      </SectionCard>

      {/* Message status + sources */}
      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Message delivery breakdown" caption="What happened to the messages you sent.">
          <CountBars rows={data.charts.messageStatus} />
        </SectionCard>
        <SectionCard title="Where your leads come from" caption="The top sources bringing customers into your inbox.">
          <SourceBars rows={data.charts.topLeadSources} />
        </SectionCard>
      </section>

      {/* Recent lists */}
      <section className="grid gap-5 xl:grid-cols-2">
        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Recent conversations</h2>
          <div className="mt-4 space-y-3">
            {data.recent.conversations.length ? (
              data.recent.conversations.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{item.contactName}</p>
                      <p className="truncate text-sm text-slate-500">{item.lastMessageText ?? item.phone}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <StatusBadge value={item.temperature} />
                      <StatusBadge value={item.source} />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No conversations yet" description="New WhatsApp chats will show up here." />
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Waiting for a human</h2>
          <div className="mt-4 space-y-3">
            {data.recent.humanQueue.length ? (
              data.recent.humanQueue.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{item.contactName}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.reason}</p>
                    </div>
                    <StatusBadge value={`P${item.priority}`} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="Queue is clear" description="Chats that need a person will appear here." />
            )}
          </div>
        </GlassCard>
      </section>
    </div>
  );
}
