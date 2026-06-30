"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  DatabaseZap,
  FileSpreadsheet,
  Flame,
  MessageCircle,
  Play,
  RefreshCw,
  Search,
  Send,
  ThermometerSun,
  Users
} from "lucide-react";
import { FeatureGuard } from "@/components/app/FeatureGuard";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";
import { StatusBadge } from "@/components/shared/StatusBadge";

type IntegrationStatus = {
  type: string;
  name: string;
  status: string;
  ready: boolean;
  message: string | null;
};

type TemplateRecord = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  updatedAt: string;
};

type LeadRecord = {
  id: string;
  status: string;
  temperature: string;
  source: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string;
    phone: string;
    optOut: boolean;
    customerReplyCount: number;
    totalMessageCount: number;
    lastContactedAt: string | null;
  };
  conversation: {
    id: string;
    status: string;
    humanTakeover: boolean;
    lastMessageText: string | null;
    lastMessageAt: string | null;
    lastMessageStatus: string | null;
  } | null;
};

type LeadData = {
  integrations: IntegrationStatus[];
  templates: TemplateRecord[];
  metrics: {
    total: number;
    hot: number;
    warm: number;
    scrap: number;
  };
  leads: LeadRecord[];
};

type RunResult = {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  deliveryLimited?: number;
  results: Array<{
    phone: string;
    status: string;
    reason: string | null;
    retryAfter?: string;
    conversationId?: string;
    messageId?: string;
    whatsappMessageId?: string | null;
  }>;
};

const flowIcons: Record<string, typeof FileSpreadsheet> = {
  GOOGLE_SHEETS: FileSpreadsheet,
  WHATSAPP_CLOUD: MessageCircle,
  WHATSAPP_TEMPLATE_SETTINGS: Send,
  KNOWLEDGE_BASE: DatabaseZap,
  AI_MODEL: Bot
};

function metricCards(data: LeadData) {
  return [
    ["Total Leads", data.metrics.total, Users],
    ["Hot", data.metrics.hot, Flame],
    ["Warm", data.metrics.warm, ThermometerSun],
    ["Scrap", data.metrics.scrap, CircleAlert]
  ] as const;
}

function formatDate(value: string | null) {
  if (!value) return "No activity";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function LeadManagementPage({ initialSearch = "" }: { initialSearch?: string }) {
  const [data, setData] = useState<LeadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [leadQuery, setLeadQuery] = useState(initialSearch);
  const [templateId, setTemplateId] = useState("");
  const [range, setRange] = useState("A:Z");
  const [maxRows, setMaxRows] = useState(200);
  const flowRunningRef = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/app/leads", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message ?? payload.message ?? "Unable to load lead flow");
    }
    setData(payload as LeadData);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadInitial() {
      try {
        const response = await fetch("/api/app/leads", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error?.message ?? payload.message ?? "Unable to load lead flow");
        }
        if (active) setData(payload as LeadData);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load lead flow");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadInitial();
    return () => {
      active = false;
    };
  }, []);

  const ready = useMemo(() => data?.integrations.every((integration) => integration.ready) ?? false, [data]);
  const selectedTemplate = data?.templates.find((template) => template.id === templateId) ?? data?.templates[0] ?? null;
  const filteredLeads = useMemo(() => {
    const leads = data?.leads ?? [];
    const needle = leadQuery.trim().toLowerCase();
    if (!needle) return leads;

    return leads.filter((lead) =>
      [
        lead.contact.name,
        lead.contact.phone,
        lead.status,
        lead.temperature,
        lead.source,
        lead.conversation?.status,
        lead.conversation?.lastMessageText,
        lead.conversation?.lastMessageStatus
      ].some((value) => value?.toLowerCase().includes(needle))
    );
  }, [data?.leads, leadQuery]);

  const runFlow = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (flowRunningRef.current) return;
    flowRunningRef.current = true;
    if (silent) setAutoSyncing(true);
    else setRunning(true);
    setError(null);
    if (!silent) setResult(null);
    try {
      const response = await fetch("/api/app/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: templateId || undefined,
          range,
          maxRows
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? payload.message ?? "Lead flow failed");
      }
      setData(payload as LeadData);
      setResult(payload.result as RunResult);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Lead flow failed");
    } finally {
      if (silent) setAutoSyncing(false);
      else setRunning(false);
      flowRunningRef.current = false;
    }
  }, [maxRows, range, templateId]);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFlow();
  }

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const sync = async () => {
      if (flowRunningRef.current) return;
      setAutoSyncing(true);
      try {
        await load();
      } catch (syncError) {
        if (active) setError(syncError instanceof Error ? syncError.message : "Unable to refresh lead flow");
      } finally {
        if (active) setAutoSyncing(false);
      }
    };
    const interval = window.setInterval(sync, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [load, ready]);

  return (
    <FeatureGuard featureKey="LEAD_MANAGEMENT">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Lead Management"
          title="Lead Management"
          description="Google Sheets intake, approved template outreach, and AI-led WhatsApp follow-up for tenant leads."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {autoSyncing ? <StatusBadge value="AUTO SYNCING" /> : <StatusBadge value="AUTO SYNC ENABLED" />}
              <NeonButton type="button" onClick={() => load().catch((loadError: Error) => setError(loadError.message))}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </NeonButton>
            </div>
          }
        />

        {error ? (
          <GlassCard className="border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</GlassCard>
        ) : null}

        {loading || !data ? (
          <LoadingSkeleton rows={8} />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards(data).map(([label, value, Icon]) => (
                <GlassCard key={label} className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-400">{label}</p>
                    <Icon className="h-5 w-5 text-cyan-100" />
                  </div>
                  <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
                </GlassCard>
              ))}
            </section>

            <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Flow Readiness</h2>
                    <p className="mt-1 text-sm text-slate-500">Sheets, WhatsApp, templates, knowledge base, and AI agent.</p>
                  </div>
                  <StatusBadge value={ready ? "CONNECTED" : "PARTIALLY_CONNECTED"} />
                </div>
                <div className="mt-5 space-y-3">
                  {data.integrations.map((integration) => {
                    const Icon = flowIcons[integration.type] ?? CircleAlert;
                    return (
                      <div key={integration.type} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-cyan-100">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{integration.name}</p>
                            <p className="truncate text-xs text-slate-500">{integration.message ?? integration.type.replaceAll("_", " ")}</p>
                          </div>
                        </div>
                        <StatusBadge value={integration.status} />
                      </div>
                    );
                  })}
                </div>
              </GlassCard>

              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Run Sheet Outreach</h2>
                    <p className="mt-1 text-sm text-slate-500">Imports numbers and sends the selected approved template.</p>
                  </div>
                  <Send className="h-5 w-5 text-cyan-100" />
                </div>
                <form onSubmit={run} className="mt-5 grid gap-3 md:grid-cols-[1fr_0.55fr_0.45fr]">
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Template</span>
                    <select
                      value={templateId}
                      onChange={(event) => setTemplateId(event.target.value)}
                      className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none"
                    >
                      <option value="">Configured default</option>
                      {data.templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} - {template.language}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Range</span>
                    <input
                      value={range}
                      onChange={(event) => setRange(event.target.value)}
                      className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rows</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={maxRows}
                      onChange={(event) => setMaxRows(Number(event.target.value))}
                      className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none"
                    />
                  </label>
                  <div className="md:col-span-3 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{selectedTemplate?.name ?? "Configured default template"}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{selectedTemplate?.body ?? "Template settings integration will supply the approved template."}</p>
                    </div>
                    <NeonButton loading={running} disabled={!ready} className="shrink-0">
                      <Play className="h-4 w-4" />
                      Run Flow
                    </NeonButton>
                  </div>
                </form>
              </GlassCard>
            </section>

            {result ? (
              <GlassCard className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">Last Run</h2>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge value={`SCANNED ${result.scanned}`} />
                    <StatusBadge value={`SENT ${result.sent}`} />
                    <StatusBadge value={`FAILED ${result.failed}`} />
                    <StatusBadge value={`SKIPPED ${result.skipped}`} />
                    {result.deliveryLimited ? <StatusBadge value={`META LIMITED ${result.deliveryLimited}`} /> : null}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {result.results.slice(0, 8).map((item) => (
                    <div key={`${item.phone}-${item.messageId ?? item.status}`} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                      <p className="truncate text-sm font-semibold text-white">{item.phone}</p>
                      <div className="mt-2">
                        <StatusBadge value={item.status} />
                      </div>
                      {item.reason ? <p className="mt-2 text-xs leading-5 text-rose-100">{item.reason}</p> : null}
                      {item.retryAfter ? <p className="mt-2 text-xs leading-5 text-amber-100">Retry after {new Date(item.retryAfter).toLocaleString()}</p> : null}
                    </div>
                  ))}
                </div>
              </GlassCard>
            ) : null}

            <section>
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <h2 className="text-xl font-semibold text-white">Recent Leads</h2>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex h-10 min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-sm focus-within:border-cyan-200/35 sm:w-80">
                    <Search className="h-4 w-4 shrink-0 text-slate-500" />
                    <input
                      value={leadQuery}
                      onChange={(event) => setLeadQuery(event.target.value)}
                      placeholder="Search recent leads"
                      className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-slate-600"
                    />
                  </div>
                  <StatusBadge value="LIVE DATA" />
                </div>
              </div>
              {filteredLeads.length ? (
                <div className="overflow-hidden rounded-[24px] border border-white/10">
                  <div className="custom-scrollbar max-h-[34rem] overflow-auto">
                    <div className="min-w-[760px] divide-y divide-white/10">
                      {filteredLeads.map((lead) => (
                        <div key={lead.id} className="grid grid-cols-[1.15fr_0.75fr_0.75fr_1fr_0.75fr] items-center gap-4 bg-white/[0.025] px-4 py-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{lead.contact.name}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">{lead.contact.phone}</p>
                          </div>
                          <StatusBadge value={lead.temperature} />
                          <StatusBadge value={lead.status} />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-slate-300">{lead.conversation?.lastMessageText ?? lead.source.replaceAll("_", " ")}</p>
                            {lead.conversation?.lastMessageStatus ? <StatusBadge value={lead.conversation.lastMessageStatus} className="mt-2" /> : null}
                          </div>
                          <p className="text-right text-xs text-slate-500">{formatDate(lead.conversation?.lastMessageAt ?? lead.updatedAt)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title={data.leads.length ? "No matching leads" : "No leads yet"}
                  description={
                    data.leads.length
                      ? "Adjust the search text to see more recent leads."
                      : "Google Sheets leads and WhatsApp conversations will appear here after the first flow run."
                  }
                />
              )}
            </section>
          </>
        )}
      </div>
    </FeatureGuard>
  );
}
