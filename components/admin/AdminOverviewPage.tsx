"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Building2,
  Coins,
  PlugZap,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  XCircle
} from "lucide-react";
import { BarRow, Donut, EmptyChart, Legend, StatTile, type DonutSegment } from "@/components/admin/AdminCharts";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";

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

type CompanySummary = { id: string; plan: string; status: string };
type ProviderBreakdown = { provider: string; units: number; cost: number };
type FeatureUsage = { featureKey: string; feature: string; units: number };
type CompanyUsage = { tenantId: string; company: string; units: number; cost: number };

const PLAN_META: Array<{ key: string; label: string; color: string }> = [
  { key: "STARTER", label: "Starter", color: "#a3a3a3" },
  { key: "PRO", label: "Pro", color: "#25D366" },
  { key: "ENTERPRISE", label: "Enterprise", color: "#0f766e" }
];

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function AdminOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [providers, setProviders] = useState<ProviderBreakdown[]>([]);
  const [featureUsage, setFeatureUsage] = useState<FeatureUsage[]>([]);
  const [companyUsage, setCompanyUsage] = useState<CompanyUsage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      // Fetch everything in parallel to avoid a request waterfall.
      const [overview, companyList, summary, byFeature, byCompany] = await Promise.all([
        safeJson<OverviewData>("/api/admin/overview"),
        safeJson<{ companies: CompanySummary[] }>("/api/admin/companies"),
        safeJson<{ providerBreakdown: ProviderBreakdown[] }>("/api/admin/billing/summary"),
        safeJson<{ byFeature: FeatureUsage[] }>("/api/admin/billing/by-feature"),
        safeJson<{ byCompany: CompanyUsage[] }>("/api/admin/billing/by-company")
      ]);
      if (!active) return;
      if (!overview) {
        setError("Unable to load platform analytics.");
        return;
      }
      setData(overview);
      setCompanies(companyList?.companies ?? []);
      setProviders(summary?.providerBreakdown ?? []);
      setFeatureUsage(byFeature?.byFeature ?? []);
      setCompanyUsage(byCompany?.byCompany ?? []);
    })();
    return () => {
      active = false;
    };
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

  const m = data.metrics;

  const statusSegments: DonutSegment[] = [
    { label: "Active", value: m.activeCompanies, color: "#25D366" },
    { label: "Deactivated", value: m.deactivatedCompanies, color: "#f43f5e" }
  ];

  const planCounts = PLAN_META.map((plan) => ({
    ...plan,
    value: companies.filter((company) => company.plan === plan.key).length
  }));
  const planMax = Math.max(...planCounts.map((plan) => plan.value), 1);

  const providerMax = Math.max(...providers.map((p) => p.units), 1);
  const featureMax = Math.max(...featureUsage.map((f) => f.units), 1);
  const topCompanies = companyUsage.slice(0, 6);
  const companyMax = Math.max(...topCompanies.map((c) => c.units), 1);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Overview</p>
        <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Platform analytics</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Every company on WhatsApp-OS, combined — accounts, access, integrations, and usage across the whole platform.
        </p>
      </section>

      {/* KPI tiles */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile label="Total Companies" value={m.totalCompanies} icon={Building2} accent="cyan" detail="All tenants on the platform" />
        <StatTile label="Active Companies" value={m.activeCompanies} icon={ShieldCheck} accent="emerald" detail="Able to log in and use the app" />
        <StatTile label="Deactivated" value={m.deactivatedCompanies} icon={XCircle} accent="rose" detail="Blocked at auth and API" />
        <StatTile label="Total Users" value={m.totalUsers} icon={Users} accent="blue" detail="Company owners and agents" />
        <StatTile label="Active Integrations" value={m.activeIntegrations} icon={PlugZap} accent="cyan" detail="Connected across all tenants" />
        <StatTile label="Enabled Features" value={m.featuresEnabledCount} icon={SlidersHorizontal} accent="amber" detail="Feature switches turned on" />
      </section>

      {/* Usage highlights */}
      <section className="grid gap-4 sm:grid-cols-2">
        <StatTile label="API Calls Today" value={m.apiCallsToday.toLocaleString()} icon={Activity} accent="cyan" detail="Units metered across every provider since midnight" />
        <StatTile label="Est. Spend This Month" value={`₹${m.estimatedCostThisMonth.toLocaleString()}`} icon={Coins} accent="emerald" detail="Estimated platform cost month-to-date" />
      </section>

      {/* Distributions */}
      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Company status</h2>
          <p className="mt-1 text-sm text-slate-400">Active vs deactivated tenants.</p>
          <div className="mt-5 flex items-center gap-6">
            <Donut segments={statusSegments} centerLabel={m.totalCompanies} centerSub="companies" />
            <div className="flex-1">
              <Legend segments={statusSegments} />
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Plan distribution</h2>
          <p className="mt-1 text-sm text-slate-400">How tenants are spread across pricing tiers.</p>
          <div className="mt-6 space-y-4">
            {companies.length ? (
              planCounts.map((plan) => (
                <BarRow key={plan.key} label={plan.label} value={plan.value} max={planMax} color={plan.color} />
              ))
            ) : (
              <EmptyChart label="No companies yet." />
            )}
          </div>
        </GlassCard>
      </section>

      {/* Usage breakdowns */}
      <section className="grid gap-5 xl:grid-cols-2">
        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Usage by provider</h2>
          <p className="mt-1 text-sm text-slate-400">Metered units per upstream provider.</p>
          <div className="mt-6 space-y-4">
            {providers.length ? (
              providers.map((provider) => (
                <BarRow key={provider.provider} label={provider.provider} value={provider.units} max={providerMax} color="#25D366" />
              ))
            ) : (
              <EmptyChart label="No usage recorded yet." />
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Usage by feature</h2>
          <p className="mt-1 text-sm text-slate-400">Which capabilities drive the most activity.</p>
          <div className="mt-6 space-y-4">
            {featureUsage.length ? (
              featureUsage.slice(0, 6).map((feature) => (
                <BarRow key={feature.featureKey} label={feature.feature} value={feature.units} max={featureMax} color="#0f766e" />
              ))
            ) : (
              <EmptyChart label="No usage recorded yet." />
            )}
          </div>
        </GlassCard>
      </section>

      {/* Top companies by usage */}
      <GlassCard className="p-5">
        <h2 className="text-lg font-semibold text-white">Top companies by usage</h2>
        <p className="mt-1 text-sm text-slate-400">The heaviest tenants across metered API units.</p>
        <div className="mt-6 space-y-4">
          {topCompanies.length ? (
            topCompanies.map((company) => (
              <BarRow key={company.tenantId} label={company.company} value={company.units} max={companyMax} color="#25D366" />
            ))
          ) : (
            <EmptyChart label="No usage recorded yet." />
          )}
        </div>
      </GlassCard>
    </div>
  );
}
