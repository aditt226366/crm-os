"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  MessageSquareText,
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
    gapMs?: number;
  } | null;
};

type ContactsData = {
  integrations: IntegrationSnapshot[];
  templates: TemplateRecord[];
  contacts: ContactRecord[];
  broadcasts: BroadcastRecord[];
  metrics: {
    totalContacts: number;
    optedIn: number;
    approvedTemplates: number;
    sentTemplates: number;
  };
};

type CsvRow = {
  name: string;
  phone: string;
  optIn: boolean;
  source?: string;
  tags?: string[];
};

const categories = ["MARKETING", "UTILITY", "AUTHENTICATION"];

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

function metricCards(data: ContactsData) {
  return [
    ["Contacts", data.metrics.totalContacts, Users],
    ["Opted in", data.metrics.optedIn, ShieldCheck],
    ["Approved templates", data.metrics.approvedTemplates, CheckCircle2],
    ["Template messages", data.metrics.sentTemplates, MessageSquareText]
  ] as const;
}

export function ContactsBroadcastPage() {
  const [data, setData] = useState<ContactsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateForm, setTemplateForm] = useState({
    name: "",
    language: "en_US",
    category: "MARKETING",
    body: ""
  });

  async function load() {
    const response = await fetch("/api/app/contacts", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Unable to load contacts workflow.");
    }
    setData(payload as ContactsData);
    const firstApproved = (payload as ContactsData).templates.find((template) => template.status === "APPROVED");
    setSelectedTemplateId((current) => current || firstApproved?.id || (payload as ContactsData).templates[0]?.id || "");
  }

  useEffect(() => {
    let active = true;
    load()
      .catch((error: Error) => active && setNotice({ type: "error", text: error.message }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const approvedTemplates = useMemo(
    () => data?.templates.filter((template) => template.status === "APPROVED") ?? [],
    [data?.templates]
  );
  const selectedTemplate = data?.templates.find((template) => template.id === selectedTemplateId) ?? null;
  const optedInContacts = useMemo(
    () => data?.contacts.filter((contact) => contact.optIn && !contact.optOut) ?? [],
    [data?.contacts]
  );
  const broadcastContactIds = selectedContactIds.length ? selectedContactIds : optedInContacts.map((contact) => contact.id);

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

  async function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("template");
    setNotice(null);
    try {
      const response = await fetch("/api/app/contacts/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateForm)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Template submission failed.");
      }
      setNotice({ type: payload.template.status === "APPROVED" ? "success" : "info", text: payload.message });
      await load();
      setSelectedTemplateId(payload.template.id);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Template submission failed." });
    } finally {
      setBusy(null);
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
      const response = await fetch("/api/app/contacts/import", {
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

  async function broadcast() {
    if (!selectedTemplateId) {
      setNotice({ type: "error", text: "Select an approved template before broadcasting." });
      return;
    }
    if (!broadcastContactIds.length) {
      setNotice({ type: "error", text: "Import opted-in contacts before broadcasting." });
      return;
    }
    const confirmed = window.confirm(
      `Broadcast this approved template to ${broadcastContactIds.length} opted-in contacts with a 6000 ms gap between sends?`
    );
    if (!confirmed) return;

    setBusy("broadcast");
    setNotice(null);
    try {
      const response = await fetch("/api/app/contacts/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplateId, contactIds: broadcastContactIds })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Broadcast failed.");
      }
      setNotice({ type: "success", text: payload.message });
      setSelectedContactIds([]);
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Broadcast failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <FeatureGuard featureKey="CONTACTS">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Contacts"
          title="Contacts"
          description="Upload approved WhatsApp templates, import CSV contacts, and broadcast template messages with a 6000 ms send gap."
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

            <section className="grid gap-4 md:grid-cols-3">
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

            <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Meta approved template</h2>
                    <p className="mt-1 text-sm text-slate-500">Submit or sync the template used for large-scale contact broadcasts.</p>
                  </div>
                  <StatusBadge value={approvedTemplates.length ? "CONNECTED" : "PARTIALLY_CONNECTED"} />
                </div>

                <form className="mt-5 space-y-4" onSubmit={submitTemplate}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Template name</span>
                      <input
                        value={templateForm.name}
                        onChange={(event) => setTemplateForm((form) => ({ ...form, name: event.target.value }))}
                        placeholder="welcome_message"
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                        required
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Language</span>
                      <input
                        value={templateForm.language}
                        onChange={(event) => setTemplateForm((form) => ({ ...form, language: event.target.value }))}
                        placeholder="en_US"
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                        required
                      />
                    </label>
                  </div>
                  <label className="space-y-2 block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</span>
                    <select
                      value={templateForm.category}
                      onChange={(event) => setTemplateForm((form) => ({ ...form, category: event.target.value }))}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                    >
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Template body preview</span>
                    <textarea
                      value={templateForm.body}
                      onChange={(event) => setTemplateForm((form) => ({ ...form, body: event.target.value }))}
                      placeholder="Hi {{name}}, thanks for connecting with us."
                      className="min-h-32 w-full resize-y rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-cyan-300/50"
                      required
                    />
                  </label>
                  <NeonButton type="submit" loading={busy === "template"} className="w-full sm:w-auto">
                    <ShieldCheck className="h-4 w-4" />
                    Upload / Sync Meta Template
                  </NeonButton>
                </form>
              </GlassCard>

              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">CSV import and broadcast</h2>
                    <p className="mt-1 text-sm text-slate-500">Import name, phone, opt_in, source, and tags, then send one approved template.</p>
                  </div>
                  <StatusBadge value={selectedTemplate?.status ?? "NOT_CONNECTED"} />
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-cyan-300/25 bg-cyan-300/[0.04] p-5 text-center transition hover:border-cyan-200/50">
                    <Upload className="h-7 w-7 text-cyan-100" />
                    <span className="mt-3 text-sm font-semibold text-white">{csvFileName || "Import contacts from .csv"}</span>
                    <span className="mt-1 text-xs text-slate-500">Columns: name, phone, opt_in, source, tags</span>
                    <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsv} />
                  </label>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-sm font-semibold text-white">Import preview</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-white/[0.04] p-3">
                        <p className="text-slate-500">CSV rows</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{csvRows.length}</p>
                      </div>
                      <div className="rounded-xl bg-white/[0.04] p-3">
                        <p className="text-slate-500">Opted in</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{csvRows.filter((row) => row.optIn).length}</p>
                      </div>
                    </div>
                    <NeonButton type="button" onClick={importContacts} loading={busy === "import"} className="mt-4 w-full">
                      <FileSpreadsheet className="h-4 w-4" />
                      Import contacts
                    </NeonButton>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <label className="space-y-2 block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Broadcast template</span>
                    <select
                      value={selectedTemplateId}
                      onChange={(event) => setSelectedTemplateId(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                    >
                      {data.templates.length ? null : <option value="">No templates yet</option>}
                      {data.templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} - {template.language} - {template.status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-4 rounded-2xl border border-blue-300/20 bg-blue-300/[0.08] p-4">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-100">
                      <MessageSquareText className="h-4 w-4" />
                      Template preview
                    </p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">
                      {selectedTemplate?.body || "Select an approved template to preview the exact message body."}
                    </p>
                  </div>
                  <NeonButton type="button" onClick={broadcast} loading={busy === "broadcast"} className="mt-4 w-full">
                    <Send className="h-4 w-4" />
                    Broadcast
                  </NeonButton>
                  <p className="mt-3 text-xs text-slate-500">
                    Sends to {broadcastContactIds.length} selected or opted-in contacts with a fixed 6000 ms gap between each WhatsApp API call.
                  </p>
                </div>
              </GlassCard>
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
              <GlassCard className="overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Imported contacts</h2>
                    <p className="mt-1 text-sm text-slate-500">Select rows for broadcast, or leave all unselected to send to every opted-in contact.</p>
                  </div>
                  <StatusBadge value="ENABLED" />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Send</th>
                        <th className="px-5 py-3">Name</th>
                        <th className="px-5 py-3">Phone</th>
                        <th className="px-5 py-3">Opt-in</th>
                        <th className="px-5 py-3">Template column</th>
                        <th className="px-5 py-3">Last contacted</th>
                        <th className="px-5 py-3">Lead temp</th>
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
                            <td className="px-5 py-4">
                              {contact.latestTemplate ? (
                                <div className="max-w-md rounded-2xl border border-blue-300/20 bg-blue-300/[0.08] p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-100">
                                      {contact.latestTemplate.name}
                                    </p>
                                    <StatusBadge value={contact.latestTemplate.status} />
                                  </div>
                                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-300">
                                    {contact.latestTemplate.body}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-slate-600">No template sent yet</span>
                              )}
                            </td>
                            <td className="px-5 py-4">{formatDate(contact.lastContactedAt)}</td>
                            <td className="px-5 py-4">
                              <StatusBadge value={contact.leadTemperature} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {data.contacts.length ? null : (
                    <div className="p-8 text-center text-sm text-slate-500">Import a CSV to start broadcasting approved templates.</div>
                  )}
                </div>
              </GlassCard>

              <GlassCard className="p-5">
                <h2 className="text-lg font-semibold text-white">Broadcast history</h2>
                <div className="mt-4 space-y-3">
                  {data.broadcasts.map((broadcastItem) => (
                    <div key={broadcastItem.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">{broadcastItem.name}</p>
                          <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDate(broadcastItem.launchedAt)}
                          </p>
                        </div>
                        <StatusBadge value={broadcastItem.status} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Sent {broadcastItem.stats?.sent ?? 0}</span>
                        <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Failed {broadcastItem.stats?.failed ?? 0}</span>
                        <span className="rounded-xl bg-white/[0.04] p-2 text-slate-400">Gap {broadcastItem.stats?.gapMs ?? 6000}ms</span>
                      </div>
                    </div>
                  ))}
                  {data.broadcasts.length ? null : (
                    <p className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-500">
                      Broadcast activity appears here after the first send.
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
