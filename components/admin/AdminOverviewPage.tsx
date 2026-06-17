"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  PlugZap,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  XCircle
} from "lucide-react";
import { OverviewMetricCard } from "@/components/admin/OverviewMetricCard";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";

type OverviewData = {
  metrics: {
    totalCompanies: number;
    activeCompanies: number;
    deactivatedCompanies: number;
    totalUsers: number;
    apiCallsToday: number;
    estimatedCostThisMonth: number;
    activeIntegrations: number;
    featuresEnabledCount: number;
  };
  recentCompanies: Array<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    ownerEmail: string;
    ownerUsername?: string;
    enabledFeaturesCount: number;
    createdAt: string;
  }>;
  recentActions: Array<{
    id: string;
    action: string;
    entityType: string;
    actor: string;
    company: string | null;
    createdAt: string;
  }>;
};

export function AdminOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load overview");
        setData((await response.json()) as OverviewData);
      })
      .catch((overviewError: Error) => setError(overviewError.message));
  }, []);

  if (error) {
    return (
      <GlassCard className="p-6">
        <p className="text-rose-100">{error}</p>
      </GlassCard>
    );
  }

  if (!data) {
    return <LoadingSkeleton rows={8} />;
  }

  const metrics = [
    ["Total Companies", data.metrics.totalCompanies, Building2, "All tenants on the platform"],
    ["Active Companies", data.metrics.activeCompanies, ShieldCheck, "Able to log in"],
    ["Deactivated", data.metrics.deactivatedCompanies, XCircle, "Blocked at auth and API"],
    ["Total Users", data.metrics.totalUsers, Users, "Owners and agents"],
    ["Active Integrations", data.metrics.activeIntegrations, PlugZap, "Connected integrations"],
    ["Enabled Features", data.metrics.featuresEnabledCount, SlidersHorizontal, "Tenant feature switches on"]
  ] as const;

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Overview</p>
        <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Platform command center</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Manage tenant access, feature gates, and integration metadata from one neon-dark control plane.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, icon, detail]) => (
          <OverviewMetricCard key={label} label={label} value={value} icon={icon} detail={detail} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Recent companies</h2>
              <p className="mt-1 text-sm text-slate-400">Latest tenants created in the platform.</p>
            </div>
            <StatusBadge value="LIVE" />
          </div>
          <div className="mt-5 space-y-3">
            {data.recentCompanies.map((company) => (
              <div key={company.id} className="rounded-[20px] border border-white/10 bg-white/[0.035] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{company.name}</p>
                    <p className="text-sm text-slate-500">{company.ownerUsername ?? company.ownerEmail}</p>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge value={company.plan} />
                    <StatusBadge value={company.status} />
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {company.enabledFeaturesCount} features enabled. Created {new Date(company.createdAt).toLocaleDateString()}.
                </p>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-xl font-semibold text-white">Recent admin actions</h2>
          <div className="mt-5 space-y-3">
            {data.recentActions.map((action) => (
              <div key={action.id} className="rounded-[18px] border border-white/10 bg-slate-950/40 p-4">
                <p className="font-medium text-white">{action.action.replaceAll("_", " ")}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {action.actor} {action.company ? `for ${action.company}` : ""} on {action.entityType}
                </p>
                <p className="mt-2 text-xs text-slate-600">{new Date(action.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </section>

    </div>
  );
}
