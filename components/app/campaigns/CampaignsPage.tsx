"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Megaphone,
  Pause,
  Play,
  RefreshCw,
  Send,
  Target,
  Users,
  XCircle
} from "lucide-react";
import { FeatureGuard } from "@/components/app/FeatureGuard";
import { PageHeader } from "@/components/app/PageHeader";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";

type IntegrationSnapshot = {
  type: string;
  status: string;
  ready: boolean;
  message: string;
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

type ContactRecord = {
  id: string;
  name: string;
  phone: string;
  optIn: boolean;
  optOut: boolean;
  source: string;
  tags: string[];
  leadTemperature: string;
  customerReplyCount: number;
  lastMessageAt: string | null;
};

type CampaignRecord = {
  id: string;
  name: string;
  goal: string;
  status: string;
  templateId: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  audienceType: string | null;
  scheduleConfig: unknown;
  stats: {
    total?: number;
    queued?: number;
    sent?: number;
    failed?: number;
    skipped?: number;
    deliveryLimited?: number;
    replied?: number;
    converted?: number;
    gapMs?: number;
  } | null;
  createdAt: string;
  updatedAt: string;
  recipients: Array<{
    id: string;
    status: string;
    clicked: boolean;
    replied: boolean;
    converted: boolean;
    contact: {
      id: string;
      name: string;
      phone: string;
      leadTemperature: string;
      source: string;
    };
  }>;
};

type CampaignsData = {
  integrations: IntegrationSnapshot[];
  templates: TemplateRecord[];
  contacts: ContactRecord[];
  campaigns: CampaignRecord[];
  metrics: {
    totalCampaigns: number;
    running: number;
    scheduled: number;
    completed: number;
    optedInContacts: number;
    approvedTemplates: number;
  };
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

function scheduledAtFromConfig(value: unknown) {
  const config = value && typeof value === "object" ? (value as { scheduledAt?: unknown }) : {};
  return typeof config.scheduledAt === "string" && config.scheduledAt ? config.scheduledAt : null;
}

async function fetchCampaignsData() {
  const response = await fetch("/api/app/campaigns", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Unable to load campaigns.");
  }
  return payload as CampaignsData;
}

export function CampaignsPage() {
  const [data, setData] = useState<CampaignsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    name: "",
    goal: "",
    templateId: "",
    scheduledAt: ""
  });

  async function load() {
    const payload = await fetchCampaignsData();
    setData(payload);
    const firstApproved = payload.templates.find((template) => template.status === "APPROVED");
    setForm((current) => ({ ...current, templateId: current.templateId || firstApproved?.id || "" }));
  }

  useEffect(() => {
    let active = true;
    void fetchCampaignsData()
      .then((payload) => {
        if (!active) return;
        setData(payload);
        const firstApproved = payload.templates.find((template) => template.status === "APPROVED");
        setForm((current) => ({ ...current, templateId: current.templateId || firstApproved?.id || "" }));
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

  const approvedTemplates = useMemo(
    () => data?.templates.filter((template) => template.status === "APPROVED") ?? [],
    [data?.templates]
  );
  const selectedTemplate = approvedTemplates.find((template) => template.id === form.templateId) ?? null;
  const optedInContacts = useMemo(
    () => data?.contacts.filter((contact) => contact.optIn && !contact.optOut) ?? [],
    [data?.contacts]
  );
  const audienceIds = selectedContactIds.length ? selectedContactIds : optedInContacts.map((contact) => contact.id);

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

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.templateId) {
      setNotice({ type: "error", text: "Select an approved template before creating a campaign." });
      return;
    }
    if (!audienceIds.length) {
      setNotice({ type: "error", text: "Import opted-in contacts before creating a campaign." });
      return;
    }

    setBusy("create");
    setNotice(null);
    try {
      const response = await fetch("/api/app/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          goal: form.goal,
          templateId: form.templateId,
          audienceType: selectedContactIds.length ? "selected_contacts" : "all_opted_in",
          contactIds: audienceIds,
          scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Campaign creation failed.");
      }
      setNotice({ type: "success", text: payload.message });
      setForm((current) => ({ ...current, name: "", goal: "", scheduledAt: "" }));
      setSelectedContactIds([]);
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Campaign creation failed." });
    } finally {
      setBusy(null);
    }
  }

  async function runAction(campaignId: string, action: "launch" | "pause" | "resume" | "cancel") {
    if (action === "launch") {
      const confirmed = window.confirm("Launch this campaign now? WhatsApp sends use a 6000 ms gap per contact.");
      if (!confirmed) return;
    }
    setBusy(`${action}:${campaignId}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/app/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `Campaign ${action} failed.`);
      }
      setNotice({ type: "success", text: payload.message });
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : `Campaign ${action} failed.` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <FeatureGuard featureKey="CAMPAIGNS">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Campaigns"
          title="Campaigns"
          description="Create template campaigns, select an audience, schedule drafts, and launch WhatsApp sends from the company workspace."
          actions={
            <NeonButton type="button" onClick={refresh} loading={busy === "refresh"}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </NeonButton>
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
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {([
                ["Campaigns", data.metrics.totalCampaigns, Megaphone],
                ["Scheduled", data.metrics.scheduled, CalendarClock],
                ["Running", data.metrics.running, Play],
                ["Completed", data.metrics.completed, CheckCircle2],
                ["Audience", data.metrics.optedInContacts, Users]
              ] as const).map(([label, value, Icon]) => (
                <GlassCard key={String(label)} className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-400">{label}</p>
                    <Icon className="h-5 w-5 text-cyan-100" />
                  </div>
                  <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
                </GlassCard>
              ))}
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              {data.integrations.map((integration) => (
                <GlassCard key={integration.type} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{integration.type.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{integration.message}</p>
                    </div>
                    <StatusBadge value={integration.status} />
                  </div>
                </GlassCard>
              ))}
            </section>

            <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Campaign draft</h2>
                    <p className="mt-1 text-sm text-slate-500">Draft now or add a schedule time before saving.</p>
                  </div>
                  <StatusBadge value={selectedTemplate?.status ?? "NOT_CONNECTED"} />
                </div>

                <form className="mt-5 space-y-4" onSubmit={createCampaign}>
                  <label className="block space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Campaign name</span>
                    <input
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Admissions July nurture"
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                      required
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Goal</span>
                    <input
                      value={form.goal}
                      onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}
                      placeholder="Book counseling calls"
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                      required
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved template</span>
                    <select
                      value={form.templateId}
                      onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                    >
                      {approvedTemplates.length ? null : <option value="">No approved templates</option>}
                      {approvedTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} - {template.language}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schedule time</span>
                    <input
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                    />
                  </label>
                  <div className="rounded-2xl border border-blue-300/20 bg-blue-300/[0.08] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-100">Template preview</p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">
                      {selectedTemplate?.body || "Connect approved templates to preview the message body."}
                    </p>
                  </div>
                  <NeonButton type="submit" loading={busy === "create"} className="w-full">
                    <Target className="h-4 w-4" />
                    Create campaign
                  </NeonButton>
                  <p className="text-xs text-slate-500">Audience: {audienceIds.length} selected or opted-in contacts.</p>
                </form>
              </GlassCard>

              <GlassCard className="overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Audience</h2>
                    <p className="mt-1 text-sm text-slate-500">Select contacts for this campaign, or leave blank to use all opted-in contacts.</p>
                  </div>
                  <StatusBadge value="ENABLED" />
                </div>
                <div className="max-h-[32rem] overflow-auto">
                  <table className="min-w-[820px] w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Use</th>
                        <th className="px-5 py-3">Name</th>
                        <th className="px-5 py-3">Phone</th>
                        <th className="px-5 py-3">Lead temp</th>
                        <th className="px-5 py-3">Replies</th>
                        <th className="px-5 py-3">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {data.contacts.map((contact) => {
                        const blocked = !contact.optIn || contact.optOut;
                        const checked = selectedContactIds.includes(contact.id);
                        return (
                          <tr key={contact.id} className="align-top text-slate-300">
                            <td className="px-5 py-4">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={blocked}
                                onChange={(event) =>
                                  setSelectedContactIds((ids) =>
                                    event.target.checked ? [...ids, contact.id] : ids.filter((id) => id !== contact.id)
                                  )
                                }
                                className="h-4 w-4 rounded border-white/20 bg-slate-950"
                              />
                            </td>
                            <td className="px-5 py-4 font-semibold text-white">{contact.name}</td>
                            <td className="px-5 py-4">{contact.phone}</td>
                            <td className="px-5 py-4">
                              <StatusBadge value={contact.leadTemperature} />
                            </td>
                            <td className="px-5 py-4">{contact.customerReplyCount}</td>
                            <td className="px-5 py-4">{contact.source.replaceAll("_", " ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {data.contacts.length ? null : (
                    <div className="p-8 text-center text-sm text-slate-500">Import contacts in Broadcasts before creating campaigns.</div>
                  )}
                </div>
              </GlassCard>
            </section>

            <GlassCard className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Campaigns</h2>
                  <p className="mt-1 text-sm text-slate-500">Launch sends immediately, or manage scheduled and paused campaigns.</p>
                </div>
                <StatusBadge value="ENABLED" />
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[1100px] w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Campaign</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Template</th>
                      <th className="px-5 py-3">Schedule</th>
                      <th className="px-5 py-3">Audience</th>
                      <th className="px-5 py-3">Outcomes</th>
                      <th className="px-5 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {data.campaigns.map((campaign) => {
                      const schedule = scheduledAtFromConfig(campaign.scheduleConfig);
                      const actionBusy = (action: string) => busy === `${action}:${campaign.id}`;
                      return (
                        <tr key={campaign.id} className="align-top text-slate-300">
                          <td className="px-5 py-4">
                            <p className="font-semibold text-white">{campaign.name}</p>
                            <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{campaign.goal}</p>
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge value={campaign.status} />
                          </td>
                          <td className="px-5 py-4">
                            <p>{campaign.templateName ?? "Template missing"}</p>
                            <p className="mt-1 text-xs text-slate-500">{campaign.templateLanguage ?? ""}</p>
                          </td>
                          <td className="px-5 py-4">{formatDate(schedule)}</td>
                          <td className="px-5 py-4">
                            <p>{campaign.stats?.total ?? campaign.recipients.length} contacts</p>
                            <p className="mt-1 text-xs text-slate-500">{campaign.audienceType?.replaceAll("_", " ") ?? "selected contacts"}</p>
                          </td>
                          <td className="px-5 py-4">
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Sent {campaign.stats?.sent ?? 0}</span>
                              <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Failed {campaign.stats?.failed ?? 0}</span>
                              <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Replies {campaign.stats?.replied ?? 0}</span>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              <NeonButton
                                type="button"
                                onClick={() => runAction(campaign.id, "launch")}
                                loading={actionBusy("launch")}
                                disabled={campaign.status === "COMPLETED" || campaign.status === "CANCELLED" || campaign.status === "RUNNING"}
                              >
                                <Send className="h-4 w-4" />
                                Launch
                              </NeonButton>
                              {campaign.status === "PAUSED" ? (
                                <NeonButton type="button" onClick={() => runAction(campaign.id, "resume")} loading={actionBusy("resume")}>
                                  <Play className="h-4 w-4" />
                                  Resume
                                </NeonButton>
                              ) : (
                                <NeonButton
                                  type="button"
                                  onClick={() => runAction(campaign.id, "pause")}
                                  loading={actionBusy("pause")}
                                  disabled={campaign.status !== "SCHEDULED" && campaign.status !== "RUNNING"}
                                >
                                  <Pause className="h-4 w-4" />
                                  Pause
                                </NeonButton>
                              )}
                              <NeonButton
                                type="button"
                                onClick={() => runAction(campaign.id, "cancel")}
                                loading={actionBusy("cancel")}
                                disabled={campaign.status === "COMPLETED" || campaign.status === "CANCELLED"}
                              >
                                <XCircle className="h-4 w-4" />
                                Cancel
                              </NeonButton>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {data.campaigns.length ? null : (
                  <div className="p-8 text-center text-sm text-slate-500">Create the first campaign draft to start tracking sends and outcomes.</div>
                )}
              </div>
            </GlassCard>
          </>
        )}
      </div>
    </FeatureGuard>
  );
}
