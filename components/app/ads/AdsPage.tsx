"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Megaphone,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Save,
  Send,
  Target,
  Users
} from "lucide-react";
import { FeatureGuard } from "@/components/app/FeatureGuard";
import { PageHeader } from "@/components/app/PageHeader";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";

type ConnectionSnapshot = {
  metaAds: {
    status: string;
    connected: boolean;
    message: string;
    adAccountName: string | null;
    adAccountId: string | null;
    pageName: string | null;
  };
  whatsapp: {
    status: string;
    connected: boolean;
    message: string;
    phoneNumberId: string | null;
  };
};

type AdCampaignRecord = {
  id: string;
  name: string;
  objective: string;
  platform: string;
  status: string;
  displayStatus: string;
  metaAdId: string | null;
  metaCampaignId: string | null;
  budget: {
    dailyBudget?: number;
    lifetimeBudget?: number;
    timezone?: string;
  } | null;
  startDate: string | null;
  endDate: string | null;
  creativeConfig: {
    primaryText?: string;
    headline?: string;
    description?: string;
    welcomeText?: string;
    manualLaunch?: boolean;
  } | null;
  audienceConfig: {
    type?: string;
    targetingNotes?: string;
  } | null;
  automationConfig: {
    tagNewLead?: boolean;
    startAiWorkflow?: boolean;
    assignAgent?: string;
    humanQueueHighIntent?: boolean;
    updateGoogleSheet?: boolean;
  } | null;
  stats: {
    conversationsStarted?: number;
    leadsGenerated?: number;
    hotLeads?: number;
    ordersGenerated?: number;
    humanQueueItems?: number;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type AdsData = {
  connection: ConnectionSnapshot;
  metrics: {
    activeAds: number;
    draftAds: number;
    conversationsStarted: number;
    leadsGenerated: number;
    hotLeads: number;
    ordersGenerated: number;
    humanQueueFromAds: number;
  };
  campaigns: AdCampaignRecord[];
};

const filters = [
  ["ALL", "All"],
  ["DRAFT", "Draft"],
  ["READY_TO_PUBLISH", "Ready"],
  ["RUNNING", "Running"],
  ["PAUSED", "Paused"],
  ["FAILED", "Failed"],
  ["COMPLETED", "Completed"]
] as const;

const steps = [
  "Objective",
  "Platform",
  "Destination",
  "Audience",
  "Creative",
  "Budget",
  "Automation",
  "Review"
];

const initialForm = {
  objective: "Click to WhatsApp",
  platform: "Facebook + Instagram",
  name: "",
  primaryText: "",
  headline: "",
  description: "",
  welcomeText: "Hi, I am interested. Please share more details.",
  audienceType: "Manual targeting",
  targetingNotes: "",
  dailyBudget: "",
  lifetimeBudget: "",
  startDate: "",
  endDate: "",
  timezone: "Asia/Dubai",
  tagNewLead: true,
  startAiWorkflow: true,
  assignAgent: "",
  humanQueueHighIntent: true,
  updateGoogleSheet: false
};

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function metricCards(data: AdsData) {
  return [
    ["Active Ads", data.metrics.activeAds, Megaphone],
    ["Draft Ads", data.metrics.draftAds, Save],
    ["Conversations", data.metrics.conversationsStarted, MessageCircle],
    ["Leads", data.metrics.leadsGenerated, Users],
    ["Hot Leads", data.metrics.hotLeads, Target],
    ["Orders", data.metrics.ordersGenerated, CheckCircle2],
    ["Human Queue", data.metrics.humanQueueFromAds, AlertTriangle],
    ["Spend", "Coming soon", BarChart3]
  ] as const;
}

async function fetchAdsData() {
  const response = await fetch("/api/app/ads", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Unable to load Ads.");
  }
  return payload as AdsData;
}

export function AdsPage() {
  const [data, setData] = useState<AdsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("ALL");
  const [showWizard, setShowWizard] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [manualMap, setManualMap] = useState<Record<string, string>>({});

  async function load() {
    setData(await fetchAdsData());
  }

  useEffect(() => {
    let active = true;
    void fetchAdsData()
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((error: Error) => {
        if (active) setNotice({ type: "error", text: error.message });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredCampaigns = useMemo(() => {
    const rows = data?.campaigns ?? [];
    if (filter === "ALL") return rows;
    return rows.filter((campaign) => campaign.status === filter || campaign.displayStatus === filter);
  }, [data?.campaigns, filter]);

  async function refresh() {
    setBusy("refresh");
    setNotice(null);
    try {
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Refresh failed." });
    } finally {
      setBusy(null);
    }
  }

  async function saveAd(status: "DRAFT" | "READY_TO_PUBLISH") {
    setBusy(status);
    setNotice(null);
    try {
      const response = await fetch("/api/app/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          status
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Ad draft failed.");
      }
      setNotice({ type: "success", text: payload.message });
      setForm(initialForm);
      setShowWizard(false);
      setStep(0);
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Ad draft failed." });
    } finally {
      setBusy(null);
    }
  }

  async function action(id: string, actionType: string, payload?: Record<string, unknown>) {
    setBusy(`${actionType}:${id}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/app/ads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionType, ...payload })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message ?? result.message ?? "Ad action failed.");
      }
      setNotice({ type: "success", text: result.message });
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Ad action failed." });
    } finally {
      setBusy(null);
    }
  }

  function updateForm(key: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function stepContent() {
    if (step === 0) {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {["Click to WhatsApp", "Lead Generation placeholder", "Website Traffic placeholder", "Retarget WhatsApp Leads placeholder"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => updateForm("objective", option)}
              className={cn(
                "rounded-2xl border p-4 text-left transition",
                form.objective === option ? "border-cyan-300/40 bg-cyan-300/[0.10] shadow-glow" : "border-white/10 bg-white/[0.035]"
              )}
            >
              <p className="font-semibold text-white">{option}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {option === "Click to WhatsApp" ? "Fully supported for CRM tracking and WhatsApp inbox attribution." : "Stored as a draft for later rollout."}
              </p>
            </button>
          ))}
        </div>
      );
    }
    if (step === 1) {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          {["Facebook", "Instagram", "Facebook + Instagram"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => updateForm("platform", option)}
              className={cn(
                "rounded-2xl border p-4 text-left transition",
                form.platform === option ? "border-cyan-300/40 bg-cyan-300/[0.10] shadow-glow" : "border-white/10 bg-white/[0.035]"
              )}
            >
              <p className="font-semibold text-white">{option}</p>
              <p className="mt-2 text-xs text-slate-500">Placement preference for the campaign draft.</p>
            </button>
          ))}
        </div>
      );
    }
    if (step === 2) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <p className="text-sm font-semibold text-white">WhatsApp destination</p>
          <p className="mt-2 text-sm text-slate-500">{data?.connection.whatsapp.message}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-white/[0.04] p-3 text-sm text-slate-300">Phone Number ID: {data?.connection.whatsapp.phoneNumberId ?? "Missing"}</div>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Welcome text</span>
              <input
                value={form.welcomeText}
                onChange={(event) => updateForm("welcomeText", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
              />
            </label>
          </div>
        </div>
      );
    }
    if (step === 3) {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Audience type</span>
            <select
              value={form.audienceType}
              onChange={(event) => updateForm("audienceType", event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
            >
              {["Manual targeting", "Existing contacts", "Hot leads", "Warm leads", "CSV upload placeholder", "Retarget previous campaign responders"].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Targeting notes</span>
            <textarea
              value={form.targetingNotes}
              onChange={(event) => updateForm("targetingNotes", event.target.value)}
              className="min-h-24 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
              placeholder="City, age, interests, retargeting notes"
            />
          </label>
        </div>
      );
    }
    if (step === 4) {
      return (
        <div className="grid gap-3 lg:grid-cols-[1fr_0.8fr]">
          <div className="space-y-3">
            {[
              ["name", "Ad name", "Weekend WhatsApp promo"],
              ["primaryText", "Primary text", "Message us on WhatsApp for bulk pricing."],
              ["headline", "Headline", "Bulk orders on WhatsApp"],
              ["description", "Description", "Fast replies from our team."]
            ].map(([key, label, placeholder]) => (
              <label key={key} className="space-y-2 block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
                <input
                  value={form[key as keyof typeof form] as string}
                  onChange={(event) => updateForm(key as keyof typeof form, event.target.value)}
                  placeholder={placeholder}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
                />
              </label>
            ))}
          </div>
          <div className="rounded-2xl border border-blue-300/20 bg-blue-300/[0.08] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-100">Creative preview</p>
            <p className="mt-4 text-lg font-semibold text-white">{form.headline || "Ad headline"}</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{form.primaryText || "Primary text will preview here."}</p>
            <p className="mt-4 inline-flex rounded-full bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950">Send WhatsApp Message</p>
          </div>
        </div>
      );
    }
    if (step === 5) {
      return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["dailyBudget", "Daily budget"],
            ["lifetimeBudget", "Lifetime budget"],
            ["startDate", "Start date"],
            ["endDate", "End date"]
          ].map(([key, label]) => (
            <label key={key} className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
              <input
                type={key.includes("Date") ? "datetime-local" : "number"}
                value={form[key as keyof typeof form] as string}
                onChange={(event) => updateForm(key as keyof typeof form, event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
              />
            </label>
          ))}
          <label className="space-y-2 sm:col-span-2 lg:col-span-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timezone</span>
            <input
              value={form.timezone}
              onChange={(event) => updateForm("timezone", event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
            />
          </label>
        </div>
      );
    }
    if (step === 6) {
      const toggles = [
        ["tagNewLead", "Tag new lead as Ad Lead"],
        ["startAiWorkflow", "Start AI workflow"],
        ["humanQueueHighIntent", "Send high intent to Human Queue"],
        ["updateGoogleSheet", "Update Google Sheet if connected"]
      ] as const;
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {toggles.map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(form[key])}
                onChange={(event) => updateForm(key, event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950"
              />
              {label}
            </label>
          ))}
          <label className="space-y-2 sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assign agent</span>
            <input
              value={form.assignAgent}
              onChange={(event) => updateForm("assignAgent", event.target.value)}
              placeholder="Optional agent name or email"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
            />
          </label>
        </div>
      );
    }
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <p className="text-sm font-semibold text-white">Review</p>
          <dl className="mt-4 space-y-2 text-sm text-slate-400">
            <div className="flex justify-between gap-4"><dt>Ad account</dt><dd>{data?.connection.metaAds.adAccountName ?? "Missing"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Page</dt><dd>{data?.connection.metaAds.pageName ?? "Missing"}</dd></div>
            <div className="flex justify-between gap-4"><dt>WhatsApp</dt><dd>{data?.connection.whatsapp.phoneNumberId ?? "Missing"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Budget</dt><dd>{form.dailyBudget || form.lifetimeBudget || "Not set"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Audience</dt><dd>{form.audienceType}</dd></div>
          </dl>
        </div>
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] p-4 text-sm leading-6 text-cyan-50">
          Compliance checklist: Meta Ads connected, WhatsApp Cloud API connected, approved WhatsApp destination, opted-in lead handling, and no secrets in browser responses.
        </div>
      </div>
    );
  }

  return (
    <FeatureGuard featureKey="ADS">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Ads"
          title="Ads"
          description="Create, track, and optimize Click-to-WhatsApp ads from your CRM."
          actions={
            <>
              <NeonButton type="button" onClick={() => setShowWizard((value) => !value)}>
                <Rocket className="h-4 w-4" />
                Create Ad
              </NeonButton>
              <NeonButton type="button" onClick={refresh} loading={busy === "refresh"}>
                <RefreshCw className="h-4 w-4" />
                Sync Ads
              </NeonButton>
              <a href="https://adsmanager.facebook.com/" target="_blank" rel="noreferrer">
                <NeonButton type="button">
                  <ExternalLink className="h-4 w-4" />
                  Meta Ads Manager
                </NeonButton>
              </a>
            </>
          }
        />

        {notice ? (
          <GlassCard
            className={cn(
              "flex items-center gap-3 p-4 text-sm",
              notice.type === "error" ? "border-rose-300/20 bg-rose-300/10 text-rose-100" : "",
              notice.type === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "",
              notice.type === "info" ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100" : ""
            )}
          >
            {notice.type === "error" ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {notice.text}
          </GlassCard>
        ) : null}

        {loading || !data ? (
          <LoadingSkeleton rows={9} />
        ) : (
          <>
            <GlassCard className="p-5">
              <div className="grid gap-4 lg:grid-cols-4">
                {[
                  ["Meta Ads", data.connection.metaAds.connected, data.connection.metaAds.message],
                  ["WhatsApp Cloud API", data.connection.whatsapp.connected, data.connection.whatsapp.message],
                  ["Facebook Page", Boolean(data.connection.metaAds.pageName), data.connection.metaAds.pageName ?? "Missing"],
                  ["Ad Account", Boolean(data.connection.metaAds.adAccountName), data.connection.metaAds.adAccountName ?? "Missing"]
                ].map(([label, connected, message]) => (
                  <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <StatusBadge value={connected ? "CONNECTED" : "NOT_CONNECTED"} />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-500">{message}</p>
                  </div>
                ))}
              </div>
              {data.connection.metaAds.connected ? null : (
                <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                  Connect Meta Ads in Admin Integrations to publish ads directly. You can still create drafts and map manually launched ads.
                </div>
              )}
            </GlassCard>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards(data).map(([label, value, Icon]) => (
                <GlassCard key={label} className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-400">{label}</p>
                    <Icon className="h-5 w-5 text-cyan-100" />
                  </div>
                  <p className="mt-4 text-2xl font-semibold text-white">{value}</p>
                </GlassCard>
              ))}
            </section>

            {showWizard ? (
              <GlassCard className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Ad creation wizard</h2>
                    <p className="mt-1 text-sm text-slate-500">Step {step + 1} of {steps.length}: {steps[step]}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {steps.map((label, index) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setStep(index)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                          index === step ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-white/[0.035] text-slate-400"
                        )}
                      >
                        {index + 1}. {label}
                      </button>
                    ))}
                  </div>
                </div>

                <form className="mt-5 space-y-5" onSubmit={(event: FormEvent) => event.preventDefault()}>
                  {stepContent()}
                  <div className="flex flex-wrap justify-between gap-3 border-t border-white/10 pt-5">
                    <NeonButton type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>
                      Previous
                    </NeonButton>
                    <div className="flex flex-wrap gap-2">
                      <NeonButton type="button" onClick={() => saveAd("DRAFT")} loading={busy === "DRAFT"}>
                        <Save className="h-4 w-4" />
                        Save Draft
                      </NeonButton>
                      <NeonButton type="button" onClick={() => saveAd("READY_TO_PUBLISH")} loading={busy === "READY_TO_PUBLISH"}>
                        <CheckCircle2 className="h-4 w-4" />
                        Save as Ready
                      </NeonButton>
                      {step < steps.length - 1 ? (
                        <NeonButton type="button" onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}>
                          Next
                        </NeonButton>
                      ) : null}
                    </div>
                  </div>
                </form>
              </GlassCard>
            ) : null}

            <GlassCard className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Existing ads</h2>
                  <p className="mt-1 text-sm text-slate-500">Drafts, ready ads, manual mappings, and CRM attribution.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {filters.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      className={cn(
                        "rounded-full border px-3 py-2 text-xs font-semibold transition",
                        filter === value ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-white/[0.035] text-slate-400"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                {filteredCampaigns.map((campaign) => (
                  <div key={campaign.id} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                    <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr_0.9fr]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-white">{campaign.name}</h3>
                          <StatusBadge value={campaign.displayStatus} />
                        </div>
                        <p className="mt-2 text-sm text-slate-500">{campaign.objective} on {campaign.platform}</p>
                        <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-300">
                          {campaign.creativeConfig?.primaryText || "No primary text saved yet."}
                        </p>
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400">
                          <span className="rounded-xl bg-white/[0.04] p-2">Budget: {campaign.budget?.dailyBudget || campaign.budget?.lifetimeBudget || "Draft"}</span>
                          <span className="rounded-xl bg-white/[0.04] p-2">Meta Ad ID: {campaign.metaAdId ?? "Not mapped"}</span>
                          <span className="rounded-xl bg-white/[0.04] p-2">Start: {formatDate(campaign.startDate)}</span>
                          <span className="rounded-xl bg-white/[0.04] p-2">End: {formatDate(campaign.endDate)}</span>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                        <p className="text-sm font-semibold text-white">Tracking</p>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Conversations {campaign.stats?.conversationsStarted ?? 0}</span>
                          <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Leads {campaign.stats?.leadsGenerated ?? 0}</span>
                          <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Hot {campaign.stats?.hotLeads ?? 0}</span>
                          <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Orders {campaign.stats?.ordersGenerated ?? 0}</span>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-slate-500">
                          Insights sync coming after Meta Ads read permission is verified.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                        <p className="text-sm font-semibold text-white">Manual launch fallback</p>
                        <div className="mt-3 flex gap-2">
                          <input
                            value={manualMap[campaign.id] ?? ""}
                            onChange={(event) => setManualMap((current) => ({ ...current, [campaign.id]: event.target.value }))}
                            placeholder="Paste Meta Ad ID"
                            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
                          />
                          <NeonButton
                            type="button"
                            loading={busy === `mark-manually-launched:${campaign.id}`}
                            onClick={() => action(campaign.id, "mark-manually-launched", { metaAdId: manualMap[campaign.id] })}
                          >
                            Map
                          </NeonButton>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <NeonButton type="button" loading={busy === `launch:${campaign.id}`} onClick={() => action(campaign.id, "launch")}>
                            <Rocket className="h-4 w-4" />
                            Launch
                          </NeonButton>
                          {campaign.status === "PAUSED" ? (
                            <NeonButton type="button" loading={busy === `resume:${campaign.id}`} onClick={() => action(campaign.id, "resume")}>
                              <Play className="h-4 w-4" />
                              Resume
                            </NeonButton>
                          ) : (
                            <NeonButton type="button" loading={busy === `pause:${campaign.id}`} onClick={() => action(campaign.id, "pause")}>
                              <Pause className="h-4 w-4" />
                              Pause
                            </NeonButton>
                          )}
                          <a href="https://adsmanager.facebook.com/" target="_blank" rel="noreferrer">
                            <NeonButton type="button">
                              <ExternalLink className="h-4 w-4" />
                              Open
                            </NeonButton>
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredCampaigns.length ? null : (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-8 text-center text-sm text-slate-500">
                    No ads match this filter. Create a Click-to-WhatsApp draft to start.
                  </div>
                )}
              </div>
            </GlassCard>
          </>
        )}
      </div>
    </FeatureGuard>
  );
}
