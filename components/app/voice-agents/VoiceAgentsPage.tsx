"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Clock3,
  Languages,
  Mic,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCw,
  Sparkles,
  User,
  X
} from "lucide-react";
import Link from "next/link";
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
                    <StatusBadge value={call.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Knowledge base */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-cyan-100" />
            <p className="text-sm font-semibold text-white">Knowledge base</p>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {agent.useKnowledgeBase
              ? "The agent answers questions using these documents."
              : "Knowledge base is turned off for the voice agent."}
          </p>
          <ul className="mt-3 space-y-2">
            {data!.knowledgeDocuments.length === 0 ? (
              <li className="text-xs text-slate-500">No documents attached yet.</li>
            ) : (
              data!.knowledgeDocuments.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                >
                  <span className="min-w-0 truncate text-xs text-slate-200">{doc.title}</span>
                  <StatusBadge value={doc.status} className="ml-2 shrink-0" />
                </li>
              ))
            )}
          </ul>
          <Link href="/app/knowledge-base" className="mt-4 inline-flex">
            <NeonButton variant="secondary">
              <Sparkles className="h-4 w-4" />
              Manage knowledge base
            </NeonButton>
          </Link>
        </GlassCard>
      </div>

      {selectedId ? <CallDetailDrawer key={selectedId} callId={selectedId} onClose={() => setSelectedId(null)} /> : null}
    </div>
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
              <span className="text-xs text-slate-400">{formatDuration(call.durationSec)}</span>
            </div>

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
