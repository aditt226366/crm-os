"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  MessageSquareText,
  RadioTower,
  RefreshCw,
  Send,
  ShieldCheck,
  Upload,
  Users
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
  lastContactedAt: string | null;
  latestTemplate: {
    name: string;
    body: string;
    status: string;
    sentAt: string;
  } | null;
};

type BroadcastRecord = {
  id: string;
  name: string;
  status: string;
  launchedAt: string | null;
  completedAt: string | null;
  stats: {
    queued?: number;
    sent?: number;
    failed?: number;
    skipped?: number;
    deliveryLimited?: number;
    gapMs?: number;
  } | null;
};

type BroadcastsData = {
  integrations: IntegrationSnapshot[];
  templates: TemplateRecord[];
  contacts: ContactRecord[];
  broadcasts: BroadcastRecord[];
  metrics: {
    totalContacts: number;
    optedIn: number;
    approvedTemplates: number;
    sentTemplates: number;
    completedBroadcasts: number;
  };
};

type CsvRow = {
  name: string;
  phone: string;
  optIn: boolean;
  source?: string;
  tags?: string[];
};

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseBoolean(value: string) {
  return ["true", "yes", "y", "1", "opted in", "opt-in"].includes(value.trim().toLowerCase());
}

function parseCsvContacts(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase().replace(/\s+/g, "_"));
  const phoneIndex = headers.findIndex((header) => ["phone", "mobile", "number", "whatsapp", "whatsapp_number"].includes(header));
  if (phoneIndex < 0) {
    throw new Error("CSV must include a phone column.");
  }

  const nameIndex = headers.findIndex((header) => ["name", "customer_name", "full_name"].includes(header));
  const optInIndex = headers.findIndex((header) => ["opt_in", "optin", "consent", "subscribed"].includes(header));
  const sourceIndex = headers.findIndex((header) => header === "source");
  const tagsIndex = headers.findIndex((header) => header === "tags");

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const phone = cells[phoneIndex] ?? "";
    return {
      name: nameIndex >= 0 ? cells[nameIndex] || phone : phone,
      phone,
      optIn: optInIndex >= 0 ? parseBoolean(cells[optInIndex] ?? "") : true,
      source: sourceIndex >= 0 ? cells[sourceIndex] : "CSV",
      tags: tagsIndex >= 0 ? cells[tagsIndex]?.split(/[|;]/).map((tag) => tag.trim()).filter(Boolean) : []
    };
  });
}

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function fetchBroadcastsData() {
  const response = await fetch("/api/app/broadcasts", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Unable to load broadcasts.");
  }
  return payload as BroadcastsData;
}

export function BroadcastsPage() {
  const [data, setData] = useState<BroadcastsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [broadcastName, setBroadcastName] = useState("");

  async function load() {
    const payload = await fetchBroadcastsData();
    setData(payload);
    const firstApproved = payload.templates.find((template) => template.status === "APPROVED");
    setSelectedTemplateId((current) => current || firstApproved?.id || "");
  }

  useEffect(() => {
    let active = true;
    void fetchBroadcastsData()
      .then((payload) => {
        if (!active) return;
        setData(payload);
        const firstApproved = payload.templates.find((template) => template.status === "APPROVED");
        setSelectedTemplateId((current) => current || firstApproved?.id || "");
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
  const selectedTemplate = approvedTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const optedInContacts = useMemo(
    () => data?.contacts.filter((contact) => contact.optIn && !contact.optOut) ?? [],
    [data?.contacts]
  );
  const sendContactIds = selectedContactIds.length ? selectedContactIds : optedInContacts.map((contact) => contact.id);

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

  async function handleCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setNotice(null);
    try {
      const text = await file.text();
      const rows = parseCsvContacts(text);
      setCsvRows(rows);
      setNotice({ type: "info", text: `${rows.length} CSV rows ready to import.` });
    } catch (error) {
      setCsvRows([]);
      setNotice({ type: "error", text: error instanceof Error ? error.message : "CSV import failed." });
    }
  }

  async function importContacts() {
    if (!csvRows.length) {
      setNotice({ type: "error", text: "Upload a CSV before importing contacts." });
      return;
    }
    setBusy("import");
    setNotice(null);
    try {
      const response = await fetch("/api/app/broadcasts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: csvRows, fileName: csvFileName })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Contact import failed.");
      }
      setNotice({ type: "success", text: payload.message });
      setCsvRows([]);
      setCsvFileName("");
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Contact import failed." });
    } finally {
      setBusy(null);
    }
  }

  async function sendBroadcast() {
    if (!selectedTemplateId) {
      setNotice({ type: "error", text: "Select an approved template before sending." });
      return;
    }
    if (!sendContactIds.length) {
      setNotice({ type: "error", text: "Import opted-in contacts before sending." });
      return;
    }
    const confirmed = window.confirm(`Send this broadcast to ${sendContactIds.length} opted-in contacts with a 6000 ms gap?`);
    if (!confirmed) return;

    setBusy("send");
    setNotice(null);
    try {
      const response = await fetch("/api/app/broadcasts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplateId, contactIds: sendContactIds, name: broadcastName })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Broadcast failed.");
      }
      setNotice({ type: "success", text: payload.message });
      setSelectedContactIds([]);
      setBroadcastName("");
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Broadcast failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <FeatureGuard featureKey="BULK_MESSAGING">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Broadcasts"
          title="Broadcasts"
          description="Import an opted-in audience, select an approved WhatsApp template, and send tenant-scoped bulk messages."
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
                ["Contacts", data.metrics.totalContacts, Users],
                ["Opted in", data.metrics.optedIn, ShieldCheck],
                ["Templates", data.metrics.approvedTemplates, MessageSquareText],
                ["Sent", data.metrics.sentTemplates, Send],
                ["Completed", data.metrics.completedBroadcasts, RadioTower]
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

            <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Audience import</h2>
                    <p className="mt-1 text-sm text-slate-500">CSV columns: name, phone, opt_in, source, tags.</p>
                  </div>
                  <StatusBadge value="ENABLED" />
                </div>

                <label className="mt-5 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-cyan-300/25 bg-cyan-300/[0.04] p-5 text-center transition hover:border-cyan-200/50">
                  <Upload className="h-7 w-7 text-cyan-100" />
                  <span className="mt-3 text-sm font-semibold text-white">{csvFileName || "Import contacts from .csv"}</span>
                  <span className="mt-1 text-xs text-slate-500">Duplicates are matched by normalized phone identity.</span>
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsv} />
                </label>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-slate-500">Rows ready</p>
                    <p className="mt-1 text-2xl font-semibold text-white">{csvRows.length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-slate-500">Opted in</p>
                    <p className="mt-1 text-2xl font-semibold text-white">{csvRows.filter((row) => row.optIn).length}</p>
                  </div>
                </div>
                <NeonButton type="button" onClick={importContacts} loading={busy === "import"} className="mt-4 w-full">
                  <FileSpreadsheet className="h-4 w-4" />
                  Import audience
                </NeonButton>
              </GlassCard>

              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Template send</h2>
                    <p className="mt-1 text-sm text-slate-500">Sends to selected contacts, or every opted-in contact when none are selected.</p>
                  </div>
                  <StatusBadge value={selectedTemplate?.status ?? "NOT_CONNECTED"} />
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-4">
                    <label className="block space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Broadcast name</span>
                      <input
                        value={broadcastName}
                        onChange={(event) => setBroadcastName(event.target.value)}
                        placeholder="July admissions follow-up"
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved template</span>
                      <select
                        value={selectedTemplateId}
                        onChange={(event) => setSelectedTemplateId(event.target.value)}
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
                    <NeonButton type="button" onClick={sendBroadcast} loading={busy === "send"} className="w-full">
                      <Send className="h-4 w-4" />
                      Send broadcast
                    </NeonButton>
                    <p className="text-xs text-slate-500">
                      Audience: {sendContactIds.length} contacts. Delivery gap: 6000 ms.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-blue-300/20 bg-blue-300/[0.08] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-100">Template preview</p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">
                      {selectedTemplate?.body || "Connect approved templates to preview the message body."}
                    </p>
                  </div>
                </div>
              </GlassCard>
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
              <GlassCard className="overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Broadcast audience</h2>
                    <p className="mt-1 text-sm text-slate-500">Select individual contacts or leave blank to use all opted-in contacts.</p>
                  </div>
                  <StatusBadge value="ENABLED" />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[820px] w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Send</th>
                        <th className="px-5 py-3">Name</th>
                        <th className="px-5 py-3">Phone</th>
                        <th className="px-5 py-3">Opt-in</th>
                        <th className="px-5 py-3">Source</th>
                        <th className="px-5 py-3">Last contacted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {data.contacts.map((contact) => {
                        const checked = selectedContactIds.includes(contact.id);
                        const blocked = !contact.optIn || contact.optOut;
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
                              <StatusBadge value={blocked ? "DISABLED" : "CONNECTED"} />
                            </td>
                            <td className="px-5 py-4">{contact.source.replaceAll("_", " ")}</td>
                            <td className="px-5 py-4">{formatDate(contact.lastContactedAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {data.contacts.length ? null : (
                    <div className="p-8 text-center text-sm text-slate-500">Import a CSV audience to send the first broadcast.</div>
                  )}
                </div>
              </GlassCard>

              <GlassCard className="p-5">
                <h2 className="text-lg font-semibold text-white">Delivery progress</h2>
                <div className="mt-4 space-y-3">
                  {data.broadcasts.map((broadcast) => (
                    <div key={broadcast.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">{broadcast.name}</p>
                          <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDate(broadcast.launchedAt)}
                          </p>
                        </div>
                        <StatusBadge value={broadcast.status} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Sent {broadcast.stats?.sent ?? 0}</span>
                        <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Failed {broadcast.stats?.failed ?? 0}</span>
                        <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Skipped {broadcast.stats?.skipped ?? 0}</span>
                      </div>
                    </div>
                  ))}
                  {data.broadcasts.length ? null : (
                    <p className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-500">
                      Delivery results appear after the first broadcast send.
                    </p>
                  )}
                </div>
              </GlassCard>
            </section>
          </>
        )}
      </div>
    </FeatureGuard>
  );
}
