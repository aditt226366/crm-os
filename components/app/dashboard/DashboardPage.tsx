"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  CircleAlert,
  Clock3,
  Flame,
  MessagesSquare,
  ThermometerSun,
  Users
} from "lucide-react";
import { DashboardMetricCard } from "@/components/app/dashboard/DashboardMetricCard";
import { PageHeader } from "@/components/app/PageHeader";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";

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

function maxValue(rows: Array<{ value: number }>) {
  return Math.max(1, ...rows.map((row) => row.value));
}

function MiniBarList({ rows }: { rows: Array<{ label: string; value: number; status?: string }> }) {
  const max = maxValue(rows);
  if (!rows.length) {
    return <EmptyState title="No data yet" description="Tenant activity will appear here as conversations and campaigns run." />;
  }
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={`${row.label}-${row.status ?? ""}`}>
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-slate-300">{row.label}</span>
            <span className="font-semibold text-white">{formatNumber(row.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.35)]"
              style={{ width: `${Math.max(8, (row.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentList({
  title,
  rows,
  render
}: {
  title: string;
  rows: unknown[];
  render: (row: unknown) => React.ReactNode;
}) {
  return (
    <GlassCard className="p-5">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length ? rows.map(render) : <EmptyState title="Nothing here yet" description="Seed or live tenant data will fill this panel." />}
      </div>
    </GlassCard>
  );
}

export function DashboardPage() {
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

  const metricCards = useMemo(() => {
    if (!data) return [];
    return [
      ["Total Leads", data.metrics.totalLeads, Users, "All tenant-scoped leads"],
      ["Hot Leads", data.metrics.hotLeads, Flame, "6+ inbound customer replies"],
      ["Warm Leads", data.metrics.warmLeads, ThermometerSun, "2-5 inbound customer replies"],
      ["Scrap Leads", data.metrics.scrapLeads, CircleAlert, "Fewer than 2 inbound replies"]
    ] as const;
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
      <PageHeader
        eyebrow="Dashboard"
        title="Company CRM Command Center"
        description="Tenant-scoped WhatsApp AI CRM metrics, inbox pressure, campaign signal, and order activity in one operational view."
        actions={<StatusBadge value="LIVE DATA" />}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(([label, value, icon, detail]) => (
          <DashboardMetricCard key={label} label={label} value={value} icon={icon} detail={detail} />
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <DashboardMetricCard
          label="Inbound Messages"
          value={data.metrics.inboundMessages}
          icon={ArrowDownLeft}
          detail="Customer messages"
        />
        <DashboardMetricCard
          label="Outbound Messages"
          value={data.metrics.outboundMessages}
          icon={ArrowUpRight}
          detail="Agent and automation messages"
        />
        <DashboardMetricCard
          label="Conversation Messages"
          value={data.metrics.totalConversationMessages}
          icon={MessagesSquare}
          detail="Inbound plus outbound"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Lead Funnel</h2>
              <p className="mt-1 text-sm text-slate-500">Scrap to warm to hot to order.</p>
            </div>
            <Bot className="h-5 w-5 text-cyan-100" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {data.charts.leadFunnel.map((step, index) => (
              <div key={step.label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <p className="text-xs text-slate-500">0{index + 1}</p>
                <p className="mt-3 text-2xl font-semibold text-white">{formatNumber(step.value)}</p>
                <p className="mt-1 text-sm text-slate-300">{step.label}</p>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Message Status</h2>
          <div className="mt-5">
            <MiniBarList rows={data.charts.messageStatus} />
          </div>
        </GlassCard>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <GlassCard className="p-5 lg:col-span-3">
          <h2 className="text-lg font-semibold text-white">AI vs Human Handling</h2>
          <div className="mt-5">
            <MiniBarList rows={data.charts.handling} />
          </div>
        </GlassCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <RecentList
          title="Recent Conversations"
          rows={data.recent.conversations}
          render={(row) => {
            const item = row as DashboardData["recent"]["conversations"][number];
            return (
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
            );
          }}
        />
        <RecentList
          title="Recent Human Queue"
          rows={data.recent.humanQueue}
          render={(row) => {
            const item = row as DashboardData["recent"]["humanQueue"][number];
            return (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{item.contactName}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.reason}</p>
                  </div>
                  <StatusBadge value={`P${item.priority}`} />
                </div>
              </div>
            );
          }}
        />
      </section>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Inbox Response Time</h2>
            <p className="mt-1 text-sm text-slate-500">Live response-time tracking will tighten as message timestamps grow.</p>
          </div>
          <Clock3 className="h-5 w-5 text-cyan-100" />
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-2/3 rounded-full bg-cyan-300 shadow-glow" />
        </div>
      </GlassCard>
    </div>
  );
}
