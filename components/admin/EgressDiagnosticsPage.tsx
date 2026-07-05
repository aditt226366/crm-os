"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Clock, DatabaseZap } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";

type Diagnostics = {
  safeMode: boolean;
  polling: {
    inboxListMs: number;
    selectedConversationMs: number;
    dashboardRefreshMs: number;
  };
  cache: {
    dashboardEntries: number;
    integrationStatusEntries: number;
    featureEntries: number;
  };
  largeResponses: Array<{
    route: string;
    status: number;
    responseBytes: number;
    tenantId: string | null;
    durationMs: number | null;
    at: string;
  }>;
  routes: Array<{
    route: string;
    count: number;
    responseBytes: number;
    averageResponseBytes: number;
    lastCalledAt: string;
  }>;
  warnings: string[];
};

function kb(bytes: number) {
  return `${Math.round(bytes / 1024).toLocaleString()} KB`;
}

function seconds(ms: number) {
  return `${Math.round(ms / 1000)}s`;
}

export function EgressDiagnosticsPage() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/usage/egress-diagnostics", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Unable to load egress diagnostics");
        setData(payload as Diagnostics);
      })
      .catch((loadError: Error) => setError(loadError.message));
  }, []);

  if (error) {
    return <GlassCard className="p-5 text-sm text-rose-100">{error}</GlassCard>;
  }

  if (!data) {
    return <LoadingSkeleton rows={10} />;
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Security / Usage</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold text-white md:text-4xl">Egress Diagnostics</h1>
          <StatusBadge value={data.safeMode ? "EGRESS SAFE MODE" : "STANDARD MODE"} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <GlassCard className="p-5">
          <Clock className="h-5 w-5 text-cyan-100" />
          <p className="mt-4 text-sm text-slate-400">Inbox list polling</p>
          <p className="mt-2 text-3xl font-semibold text-white">{seconds(data.polling.inboxListMs)}</p>
        </GlassCard>
        <GlassCard className="p-5">
          <Activity className="h-5 w-5 text-cyan-100" />
          <p className="mt-4 text-sm text-slate-400">Selected chat polling</p>
          <p className="mt-2 text-3xl font-semibold text-white">{seconds(data.polling.selectedConversationMs)}</p>
        </GlassCard>
        <GlassCard className="p-5">
          <DatabaseZap className="h-5 w-5 text-cyan-100" />
          <p className="mt-4 text-sm text-slate-400">Cache entries</p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {data.cache.dashboardEntries + data.cache.integrationStatusEntries + data.cache.featureEntries}
          </p>
        </GlassCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-100" />
            <h2 className="text-lg font-semibold text-white">Route Volume</h2>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <div className="custom-scrollbar max-h-[28rem] overflow-auto">
              <div className="min-w-[720px] divide-y divide-white/10">
                {data.routes.map((route) => (
                  <div key={route.route} className="grid grid-cols-[1.4fr_0.4fr_0.5fr_0.5fr] gap-4 bg-white/[0.025] px-4 py-3 text-sm">
                    <p className="truncate font-semibold text-white">{route.route}</p>
                    <p className="text-slate-300">{route.count}</p>
                    <p className="text-slate-300">{kb(route.averageResponseBytes)}</p>
                    <p className="text-right text-slate-500">{kb(route.responseBytes)}</p>
                  </div>
                ))}
                {!data.routes.length ? <p className="p-4 text-sm text-slate-400">No API responses recorded yet.</p> : null}
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-100" />
            <h2 className="text-lg font-semibold text-white">Large Responses</h2>
          </div>
          <div className="mt-4 space-y-3">
            {data.largeResponses.map((entry) => (
              <div key={`${entry.route}-${entry.at}`} className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
                <p className="truncate text-sm font-semibold text-white">{entry.route}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusBadge value={kb(entry.responseBytes)} />
                  <StatusBadge value={`HTTP ${entry.status}`} />
                  {entry.durationMs ? <StatusBadge value={`${entry.durationMs}MS`} /> : null}
                </div>
              </div>
            ))}
            {!data.largeResponses.length ? <p className="text-sm text-slate-400">No large API responses recorded.</p> : null}
          </div>
        </GlassCard>
      </section>
    </div>
  );
}
