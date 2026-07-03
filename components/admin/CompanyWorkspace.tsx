"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Building2,
  Coins,
  CreditCard,
  KeyRound,
  PlugZap,
  Power,
  SlidersHorizontal,
  Users
} from "lucide-react";
import { FeatureRecord, FeatureToggleCard } from "@/components/admin/FeatureToggleCard";
import { CompanyIntegrationManager, type IntegrationCompanySummary } from "@/components/admin/IntegrationsPage";
import { IntegrationRecord } from "@/components/admin/IntegrationCard";
import { ResetPasswordModal } from "@/components/admin/ResetPasswordModal";
import { CompanySummary } from "@/components/admin/CompanyCard";
import { Donut, Legend, StatTile, type DonutSegment } from "@/components/admin/AdminCharts";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NeonButton } from "@/components/shared/NeonButton";
import { cn } from "@/lib/utils";

type CompanyUser = {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  forcePasswordReset: boolean;
  createdAt: string;
  updatedAt: string;
};

type CompanyDetail = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  users: CompanyUser[];
  features: FeatureRecord[];
  integrations: IntegrationRecord[];
};

const TABS = [
  ["overview", "Overview"],
  ["features", "Features"],
  ["integrations", "Integrations"],
  ["billing", "Billing"]
] as const;
type TabKey = (typeof TABS)[number][0];

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function CompanyWorkspace({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/companies/${companyId}`);
      const data = (await response.json().catch(() => null)) as { company?: CompanyDetail; error?: { message?: string } } | null;
      if (!response.ok || !data?.company) {
        setError(data?.error?.message ?? "Company not found.");
        return;
      }
      setCompany(data.company);
      setError(null);
    } catch {
      setError("Could not reach the company API.");
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <GlassCard className="p-6">
        <p className="text-rose-100">{error}</p>
        <Link href="/admin/companies" className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-100 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Back to companies
        </Link>
      </GlassCard>
    );
  }

  if (!company) {
    return <LoadingSkeleton rows={8} />;
  }

  const owner = company.users.find((user) => user.role === "COMPANY_OWNER") ?? company.users[0];
  const lastLogin =
    company.users
      .map((user) => user.lastLoginAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  const featuresEnabled = company.features.filter((feature) => feature.enabled).length;
  const integrationsConnected = company.integrations.filter((integration) => integration.status === "CONNECTED").length;
  const integrationsError = company.integrations.filter((integration) => integration.status === "ERROR").length;

  const summaryForReset: CompanySummary = {
    id: company.id,
    name: company.name,
    slug: company.slug,
    plan: company.plan,
    status: company.status,
    ownerEmail: owner?.email ?? "No owner",
    ownerUsername: owner?.username,
    ownerName: owner?.name,
    lastLoginAt: lastLogin,
    usersCount: company.users.length,
    enabledFeaturesCount: featuresEnabled,
    createdAt: company.createdAt
  };

  const integrationSummary: IntegrationCompanySummary = {
    id: company.id,
    name: company.name,
    slug: company.slug,
    plan: company.plan,
    status: company.status,
    ownerEmail: owner?.email ?? "No owner",
    ownerUsername: owner?.username ?? "",
    ownerName: owner?.name ?? "",
    lastLoginAt: lastLogin,
    totalIntegrationsCount: company.integrations.length,
    connectedIntegrationsCount: integrationsConnected,
    errorIntegrationsCount: integrationsError
  };

  async function toggleStatus() {
    const active = company!.status === "ACTIVE";
    const action = active ? "deactivate" : "reactivate";
    const response = await fetch(`/api/admin/companies/${companyId}/${action}`, { method: "POST" });
    if (response.ok) {
      setNotice(`${company!.name} ${active ? "deactivated" : "reactivated"}.`);
      await load();
    } else {
      setNotice(`Could not ${action} ${company!.name}.`);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/companies" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Companies
      </Link>

      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
            <Building2 className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-semibold text-white md:text-4xl">{company.name}</h1>
            <p className="mt-1 text-sm text-slate-400">{company.slug}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge value={company.plan} />
              <StatusBadge value={company.status} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <NeonButton variant="secondary" onClick={() => setResetOpen(true)}>
            <KeyRound className="h-4 w-4" />
            Reset Password
          </NeonButton>
          <NeonButton variant="secondary" onClick={toggleStatus}>
            <Power className="h-4 w-4" />
            {company.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
          </NeonButton>
        </div>
      </section>

      {notice ? <GlassCard className="border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">{notice}</GlassCard> : null}

      <div className="inline-flex flex-wrap rounded-full border border-white/10 bg-white/[0.04] p-1">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition",
              tab === value ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:text-white"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab
          company={company}
          owner={owner}
          lastLogin={lastLogin}
          featuresEnabled={featuresEnabled}
          integrationsConnected={integrationsConnected}
        />
      ) : null}
      {tab === "features" ? <FeaturesTab companyId={companyId} onChanged={load} /> : null}
      {tab === "integrations" ? <CompanyIntegrationManager key={companyId} company={integrationSummary} onChanged={load} /> : null}
      {tab === "billing" ? <BillingTab company={company} /> : null}

      <ResetPasswordModal company={resetOpen ? summaryForReset : null} onClose={() => setResetOpen(false)} />
    </div>
  );
}

function OverviewTab({
  company,
  owner,
  lastLogin,
  featuresEnabled,
  integrationsConnected
}: {
  company: CompanyDetail;
  owner: CompanyUser | undefined;
  lastLogin: string | null;
  featuresEnabled: number;
  integrationsConnected: number;
}) {
  const integrationSegments: DonutSegment[] = [
    { label: "Connected", value: integrationsConnected, color: "#25D366" },
    { label: "Not connected", value: Math.max(0, company.integrations.length - integrationsConnected), color: "#cbd5e1" }
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Users" value={company.users.length} icon={Users} accent="blue" detail="Owners and agents" />
        <StatTile label="Features enabled" value={`${featuresEnabled} / ${company.features.length}`} icon={SlidersHorizontal} accent="amber" detail="Capabilities switched on" />
        <StatTile label="Integrations" value={`${integrationsConnected} / ${company.integrations.length}`} icon={PlugZap} accent="cyan" detail="Connected credentials" />
        <StatTile label="Plan" value={company.plan} icon={CreditCard} accent="emerald" detail="Current subscription tier" />
      </div>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Integration health</h2>
          <p className="mt-1 text-sm text-slate-400">Connected vs pending integrations.</p>
          <div className="mt-5 flex items-center gap-6">
            <Donut segments={integrationSegments} centerLabel={`${integrationsConnected}`} centerSub={`of ${company.integrations.length}`} />
            <div className="flex-1">
              <Legend segments={integrationSegments} />
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-lg font-semibold text-white">Company details</h2>
          <dl className="mt-5 space-y-3 text-sm">
            {[
              ["Owner", owner ? `${owner.name} · ${owner.email}` : "No owner"],
              ["Login username", owner?.username ?? "—"],
              ["Status", company.status],
              ["Created", new Date(company.createdAt).toLocaleString()],
              ["Last login", displayDate(lastLogin)],
              ["Deactivated", company.deactivatedAt ? new Date(company.deactivatedAt).toLocaleString() : "—"]
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-white/5 pb-2 last:border-0">
                <dt className="text-slate-400">{label}</dt>
                <dd className="truncate text-right font-medium text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </GlassCard>
      </section>

      <GlassCard className="p-5">
        <h2 className="text-lg font-semibold text-white">Team</h2>
        <p className="mt-1 text-sm text-slate-400">Every user in this company workspace.</p>
        <div className="mt-5 space-y-3">
          {company.users.map((user) => (
            <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-white/[0.035] p-4">
              <div>
                <p className="font-medium text-white">{user.name}</p>
                <p className="text-sm text-slate-500">{user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                  {user.role.replace("COMPANY_", "").toLowerCase()}
                </span>
                <StatusBadge value={user.status} />
                <span className="text-xs text-slate-500">{displayDate(user.lastLoginAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function FeaturesTab({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/companies/${companyId}/features`);
    const data = (await response.json().catch(() => ({}))) as { features?: FeatureRecord[] };
    setFeatures(data.features ?? []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(feature: FeatureRecord) {
    const previous = features;
    const nextEnabled = !feature.enabled;
    setFeatures((current) => current.map((item) => (item.featureKey === feature.featureKey ? { ...item, enabled: nextEnabled } : item)));
    const response = await fetch(`/api/admin/companies/${companyId}/features/${feature.featureKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: nextEnabled })
    });
    if (!response.ok) {
      setFeatures(previous);
      setToast("Feature update failed. Rolled back.");
      return;
    }
    setToast(`${feature.name} ${nextEnabled ? "enabled" : "disabled"}.`);
    onChanged();
    await load();
  }

  if (loading) {
    return <LoadingSkeleton rows={6} />;
  }

  return (
    <div className="space-y-4">
      {toast ? <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">{toast}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {features.map((feature) => (
          <FeatureToggleCard key={feature.featureKey} feature={feature} onToggle={toggle} />
        ))}
      </div>
    </div>
  );
}

function BillingTab({ company }: { company: CompanyDetail }) {
  const [usage, setUsage] = useState<{ units: number; cost: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const response = await fetch("/api/admin/billing/by-company");
      const data = (await response.json().catch(() => null)) as { byCompany?: Array<{ tenantId: string; units: number; cost: number }> } | null;
      if (!active) return;
      const row = data?.byCompany?.find((item) => item.tenantId === company.id);
      setUsage({ units: row?.units ?? 0, cost: row?.cost ?? 0 });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [company.id]);

  if (loading || !usage) {
    return <LoadingSkeleton rows={4} />;
  }

  const enabledFeatures = company.features.filter((feature) => feature.enabled);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Plan" value={company.plan} icon={CreditCard} accent="blue" detail="Billed monthly" />
        <StatTile label="Metered Units" value={usage.units.toLocaleString()} icon={Activity} accent="cyan" detail="Across every provider" />
        <StatTile label="Est. Cost" value={`₹${usage.cost.toLocaleString()}`} icon={Coins} accent="emerald" detail="Usage-based estimate" />
      </div>

      <GlassCard className="p-5">
        <h2 className="text-lg font-semibold text-white">Billable features</h2>
        <p className="mt-1 text-sm text-slate-400">Capabilities currently enabled for {company.name}.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {enabledFeatures.length ? (
            enabledFeatures.map((feature) => (
              <span key={feature.featureKey} className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
                {feature.name}
              </span>
            ))
          ) : (
            <p className="text-sm text-slate-500">No features enabled.</p>
          )}
        </div>
      </GlassCard>

      <p className="text-xs leading-5 text-slate-500">
        Usage is metered across WhatsApp, AI, Google, and workflow providers, then billed against the {company.plan} plan.
        Deactivating this company immediately halts new metered usage.
      </p>
    </div>
  );
}
