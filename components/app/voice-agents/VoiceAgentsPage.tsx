"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Clock3,
  FileText,
  Globe,
  Languages,
  LifeBuoy,
  Mic,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
  User,
  X
} from "lucide-react";
import { FeatureGuard } from "@/components/app/FeatureGuard";
import { PageHeader } from "@/components/app/PageHeader";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";

type CallSummary = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  fromNumber: string;
  toNumber: string;
  contactName: string | null;
  language: string | null;
  durationSec: number | null;
  hasRecording: boolean;
  recordingUrl: string | null;
  summary: string | null;
  needsSupport: boolean;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

type TranscriptTurn = { role: string; text: string; lang?: string; tsMs?: number };
type CallDetail = CallSummary & { transcript?: TranscriptTurn[] };

type KnowledgeDoc = { id: string; title: string; type: string; status: string; updatedAt: string };

type DashboardData = {
  agent: {
    connected: boolean;
    status: string;
    virtualNumber: string | null;
    companyName: string | null;
    outboundGreeting: string;
    inboundGreeting: string;
    systemPrompt: string;
    maxCallSeconds: number;
    defaultLanguage: string;
    ttsVoice: string;
    useKnowledgeBase: boolean;
    languages: string[];
    voice: string;
    role: string;
  };
  knowledgeDocuments: KnowledgeDoc[];
  metrics: { total: number; completed: number; inbound: number; outbound: number };
  calls: CallSummary[];
};

const LANGUAGE_OPTIONS = [
  { label: "Auto detect", value: "" },
  { label: "English", value: "en-IN" },
  { label: "Hindi", value: "hi-IN" },
  { label: "Tamil", value: "ta-IN" }
];

const ACTIVE_STATUSES = new Set(["QUEUED", "RINGING", "IN_PROGRESS"]);

function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString();
}

export function VoiceAgentsPage() {
  return (
    <FeatureGuard featureKey="VOICE_AGENTS">
      <VoiceAgentsInner />
    </FeatureGuard>
  );
}

function VoiceAgentsInner() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [language, setLanguage] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/app/voice-agents", { cache: "no-store", credentials: "include" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? "Could not load voice agents.");
    }
    return (await response.json()) as DashboardData;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await load();
      setData(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load voice agents.");
    }
  }, [load]);

  useEffect(() => {
    let active = true;
    load()
      .then((next) => {
        if (active) setData(next);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load voice agents.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  // Poll while a call is in-flight so status/transcript land quickly.
  const hasActiveCall = useMemo(() => (data?.calls ?? []).some((call) => ACTIVE_STATUSES.has(call.status)), [data]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, hasActiveCall ? 4000 : 20000);
    return () => clearInterval(interval);
  }, [hasActiveCall, refresh]);

  const placeCall = useCallback(async () => {
    setPlaceError(null);
    setNotice(null);
    setPlacing(true);
    try {
      const response = await fetch("/api/app/voice-agents/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to: to.trim(), language: language || null })
      });
      const payload = (await response.json().catch(() => null)) as
        | { call?: CallSummary; error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not place the call.");
      }
      setTo("");
      setNotice("Calling — the agent will greet the customer when they answer.");
      await refresh();
    } catch (callError) {
      setPlaceError(callError instanceof Error ? callError.message : "Could not place the call.");
    } finally {
      setPlacing(false);
    }
  }, [language, refresh, to]);

  if (loading) {
    return <LoadingSkeleton rows={8} />;
  }

  if (error && !data) {
    return (
      <GlassCard className="p-6">
        <p className="text-sm font-semibold text-rose-100">{error}</p>
        <NeonButton className="mt-4" onClick={() => void refresh()}>
          Retry
        </NeonButton>
      </GlassCard>
    );
  }

  const agent = data!.agent;
  const metrics = data!.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voice Agents"
        title="AI Voice Calling"
        description="Place outbound calls and answer inbound calls with an AI inquiry agent. Calls are recorded and transcribed."
        actions={
          <NeonButton variant="secondary" onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </NeonButton>
        }
      />

      {!agent.connected ? (
        <GlassCard className="border-amber-300/20 bg-amber-300/[0.06] p-5">
          <p className="text-sm text-amber-100">
            The Voice Agent integration is not connected yet. Ask your admin to configure Plivo, Sarvam, and Claude in the
            integration panel to start placing and receiving calls.
          </p>
        </GlassCard>
      ) : null}

      {/* Agent status */}
      <div className="grid gap-4 lg:grid-cols-4">
        <GlassCard className="p-5 lg:col-span-2">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10">
              <PhoneCall className="h-5 w-5 text-cyan-100" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{agent.companyName ?? "Voice agent"}</p>
              <p className="text-xs text-slate-400">{agent.virtualNumber ?? "No number configured"}</p>
            </div>
            <StatusBadge value={agent.status} className="ml-auto" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
            <InfoTile icon={<User className="h-3.5 w-3.5" />} label="Role" value={agent.role} />
            <InfoTile icon={<Mic className="h-3.5 w-3.5" />} label="Voice" value={agent.voice} />
            <InfoTile icon={<Languages className="h-3.5 w-3.5" />} label="Languages" value={agent.languages.join(", ")} />
          </div>
        </GlassCard>

        {/* Place a call */}
        <GlassCard className="p-5 lg:col-span-2">
          <p className="text-sm font-semibold text-white">Place a call</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="+9198XXXXXXXX"
              inputMode="tel"
              disabled={!agent.connected}
              className="min-h-11 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/40 focus:outline-none"
            />
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={!agent.connected}
              className="min-h-11 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white focus:border-cyan-300/40 focus:outline-none"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-slate-900">
                  {option.label}
                </option>
              ))}
            </select>
            <NeonButton onClick={() => void placeCall()} loading={placing} disabled={!agent.connected || !to.trim()}>
              <Phone className="h-4 w-4" />
              Call
            </NeonButton>
          </div>
          {placeError ? <p className="mt-2 text-xs text-rose-200">{placeError}</p> : null}
          {notice ? <p className="mt-2 text-xs text-emerald-200">{notice}</p> : null}
        </GlassCard>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile label="Total calls" value={metrics.total} />
        <MetricTile label="Completed" value={metrics.completed} />
        <MetricTile label="Inbound" value={metrics.inbound} />
        <MetricTile label="Outbound" value={metrics.outbound} />
      </div>

      {/* Agent settings (edited by the company user) */}
      <AgentSettingsCard agent={agent} onSaved={() => void refresh()} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Call history */}
        <GlassCard className="p-0 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
            <p className="text-sm font-semibold text-white">Recent calls</p>
            <span className="text-xs text-slate-500">{data!.calls.length} shown</span>
          </div>
          {data!.calls.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No calls yet. Place a call to get started.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {data!.calls.map((call) => (
                <li key={call.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(call.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-white/[0.03]"
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-xl border",
                        call.direction === "INBOUND"
                          ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                          : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                      )}
                    >
                      {call.direction === "INBOUND" ? (
                        <PhoneIncoming className="h-4 w-4" />
                      ) : (
                        <PhoneOutgoing className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">
                        {call.contactName ?? (call.direction === "INBOUND" ? call.fromNumber : call.toNumber)}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{formatWhen(call.createdAt)}</span>
                    </span>
                    <span className="hidden items-center gap-1 text-xs text-slate-400 sm:flex">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatDuration(call.durationSec)}
                    </span>
                    {call.needsSupport ? <SupportBadge /> : null}
                    <StatusBadge value={call.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Knowledge base */}
        <KnowledgeBaseCard
          documents={data!.knowledgeDocuments}
          useKnowledgeBase={agent.useKnowledgeBase}
          onChanged={() => void refresh()}
        />
      </div>

      {selectedId ? <CallDetailDrawer key={selectedId} callId={selectedId} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}

const FIELD_CLASS =
  "mt-1 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/40 focus:outline-none";

function AgentSettingsCard({ agent, onSaved }: { agent: DashboardData["agent"]; onSaved: () => void }) {
  const [companyName, setCompanyName] = useState(agent.companyName ?? "");
  const [outboundGreeting, setOutboundGreeting] = useState(agent.outboundGreeting);
  const [inboundGreeting, setInboundGreeting] = useState(agent.inboundGreeting);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [maxCallSeconds, setMaxCallSeconds] = useState(String(agent.maxCallSeconds || 300));
  const [useKb, setUseKb] = useState(agent.useKnowledgeBase);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setSaving(true);
    setNote(null);
    setError(null);
    try {
      const response = await fetch("/api/app/voice-agents/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          companyName,
          outboundGreeting,
          inboundGreeting,
          systemPrompt,
          maxCallSeconds: Number(maxCallSeconds) || 300,
          useKnowledgeBase: useKb
        })
      });
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "Could not save settings.");
      setNote("Saved.");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }, [companyName, inboundGreeting, maxCallSeconds, onSaved, outboundGreeting, systemPrompt, useKb]);

  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-cyan-100" />
        <p className="text-sm font-semibold text-white">Agent settings</p>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Edit how your agent introduces itself and behaves. Use <code className="text-cyan-100">{"{{company}}"}</code> in the
        greetings for your company name.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block text-xs text-slate-400">
          Company name
          <input className={FIELD_CLASS} value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
        </label>
        <label className="block text-xs text-slate-400">
          Max call length (seconds)
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={maxCallSeconds}
            onChange={(event) => setMaxCallSeconds(event.target.value.replace(/[^\d]/g, ""))}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Outbound greeting
          <textarea
            className={cn(FIELD_CLASS, "min-h-16 resize-y")}
            value={outboundGreeting}
            onChange={(event) => setOutboundGreeting(event.target.value)}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Inbound greeting
          <textarea
            className={cn(FIELD_CLASS, "min-h-16 resize-y")}
            value={inboundGreeting}
            onChange={(event) => setInboundGreeting(event.target.value)}
          />
        </label>
      </div>

      <label className="mt-4 block text-xs text-slate-400">
        Agent instructions
        <textarea
          className={cn(FIELD_CLASS, "min-h-20 resize-y")}
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          placeholder="You are a friendly inquiry agent. Answer using the knowledge base. Keep replies short and conversational."
        />
      </label>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={useKb} onChange={(event) => setUseKb(event.target.checked)} className="h-4 w-4 accent-cyan-300" />
        Use the knowledge base to answer questions
      </label>

      <div className="mt-4 flex items-center gap-3">
        <NeonButton onClick={() => void save()} loading={saving}>
          <Save className="h-4 w-4" />
          Save settings
        </NeonButton>
        {note ? <span className="text-xs text-emerald-200">{note}</span> : null}
        {error ? <span className="text-xs text-rose-200">{error}</span> : null}
      </div>
    </GlassCard>
  );
}

function KnowledgeBaseCard({
  documents,
  useKnowledgeBase,
  onChanged
}: {
  documents: KnowledgeDoc[];
  useKnowledgeBase: boolean;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"url" | "pdf" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(
    async (form: FormData, kind: "url" | "pdf", successMsg: string) => {
      setBusy(kind);
      setNote(null);
      setError(null);
      try {
        const response = await fetch("/api/app/voice-agents/knowledge", { method: "POST", credentials: "include", body: form });
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!response.ok) throw new Error(payload?.error?.message ?? "Could not attach.");
        setNote(successMsg);
        onChanged();
      } catch (attachError) {
        setError(attachError instanceof Error ? attachError.message : "Could not attach.");
      } finally {
        setBusy(null);
      }
    },
    [onChanged]
  );

  const addUrl = useCallback(() => {
    if (!url.trim()) return;
    const form = new FormData();
    form.append("url", url.trim());
    void post(form, "url", "Website added.").then(() => setUrl(""));
  }, [post, url]);

  const uploadPdf = useCallback(
    (file: File) => {
      const form = new FormData();
      form.append("file", file);
      void post(form, "pdf", "PDF added.");
    },
    [post]
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/app/voice-agents/knowledge/${id}`, { method: "DELETE", credentials: "include" });
        if (response.ok) onChanged();
      } catch {
        // ignore — the list will refresh on next poll
      }
    },
    [onChanged]
  );

  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-cyan-100" />
        <p className="text-sm font-semibold text-white">Knowledge base</p>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {useKnowledgeBase
          ? "Attach a website or PDF — the agent answers questions from these."
          : "Knowledge base is turned off in Agent settings."}
      </p>

      {/* Website */}
      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://company.com"
            className="min-h-10 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/40 focus:outline-none"
          />
        </div>
        <NeonButton onClick={addUrl} loading={busy === "url"} disabled={!url.trim()}>
          <Plus className="h-4 w-4" />
          Add
        </NeonButton>
      </div>

      {/* PDF */}
      <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-300/40 hover:text-white">
        {busy === "pdf" ? <Upload className="h-4 w-4 animate-pulse" /> : <FileText className="h-4 w-4" />}
        {busy === "pdf" ? "Reading PDF…" : "Upload a PDF"}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          disabled={busy !== null}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) uploadPdf(file);
            event.target.value = "";
          }}
        />
      </label>

      {note ? <p className="mt-2 text-xs text-emerald-200">{note}</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-200">{error}</p> : null}

      <ul className="mt-3 space-y-2">
        {documents.length === 0 ? (
          <li className="text-xs text-slate-500">No documents attached yet.</li>
        ) : (
          documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                {doc.type === "URL" ? (
                  <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
                <span className="min-w-0 truncate text-xs text-slate-200">{doc.title}</span>
              </span>
              <button
                type="button"
                onClick={() => void remove(doc.id)}
                className="shrink-0 text-slate-500 transition hover:text-rose-300"
                aria-label="Remove document"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))
        )}
      </ul>
    </GlassCard>
  );
}

function SupportBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
      <LifeBuoy className="h-3 w-3" />
      Support
    </span>
  );
}

function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </span>
      <span className="mt-1 block truncate text-xs font-medium text-white">{value}</span>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <GlassCard className="p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </GlassCard>
  );
}

function CallDetailDrawer({ callId, onClose }: { callId: string; onClose: () => void }) {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/app/voice-agents/calls/${callId}`, { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { call?: CallDetail; error?: { message?: string } }
          | null;
        if (!response.ok) throw new Error(payload?.error?.message ?? "Could not load the call.");
        if (active) setCall(payload?.call ?? null);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load the call.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [callId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-slate-950/95 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">Call details</p>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="mt-6">
            <LoadingSkeleton rows={6} />
          </div>
        ) : error ? (
          <p className="mt-6 text-sm text-rose-200">{error}</p>
        ) : call ? (
          <div className="mt-5 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={call.status} />
              <StatusBadge value={call.direction} />
              {call.language ? <StatusBadge value={call.language} /> : null}
              {call.needsSupport ? <SupportBadge /> : null}
              <span className="text-xs text-slate-400">{formatDuration(call.durationSec)}</span>
            </div>

            {call.needsSupport ? (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] p-3">
                <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                <p className="text-xs text-amber-100">
                  The caller asked something outside the knowledge base. The agent offered to connect them with a customer
                  executive — follow up with this caller.
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <InfoTile icon={<PhoneOutgoing className="h-3.5 w-3.5" />} label="From" value={call.fromNumber} />
              <InfoTile icon={<PhoneIncoming className="h-3.5 w-3.5" />} label="To" value={call.toNumber} />
            </div>

            {call.recordingUrl ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recording</p>
                <audio controls src={call.recordingUrl} className="w-full" />
              </div>
            ) : null}

            {call.summary ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</p>
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200">{call.summary}</p>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Transcript</p>
              {call.transcript && call.transcript.length > 0 ? (
                <ul className="space-y-2">
                  {call.transcript.map((turn, index) => (
                    <li
                      key={index}
                      className={cn(
                        "rounded-2xl border px-3 py-2 text-sm",
                        turn.role === "agent"
                          ? "border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-50"
                          : "border-white/10 bg-white/[0.03] text-slate-200"
                      )}
                    >
                      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-500">
                        {turn.role === "agent" ? "Agent" : "Customer"}
                      </span>
                      {turn.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  {call.status === "COMPLETED" ? "No transcript was captured." : "Transcript appears after the call ends."}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
