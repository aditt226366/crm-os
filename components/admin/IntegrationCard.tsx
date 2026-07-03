"use client";

import { PlugZap } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NeonButton } from "@/components/shared/NeonButton";

export type IntegrationRecord = {
  id: string;
  type: string;
  name: string;
  provider: string;
  description: string;
  status: string;
  maskedDisplay: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  lastVerifiedAt: string | null;
  lastVerificationError: string | null;
  createdBy: { name: string; email: string } | null;
  updatedBy?: { name: string; email: string } | null;
  company?: { id: string; name: string; slug: string; plan: string };
};

export function IntegrationCard({
  integration,
  onTest,
  onDisconnect
}: {
  integration: IntegrationRecord;
  onTest?: (integration: IntegrationRecord) => void;
  onDisconnect?: (integration: IntegrationRecord) => void;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
          <PlugZap className="h-5 w-5" />
        </span>
        <StatusBadge value={integration.status} />
      </div>
      <p className="mt-5 text-lg font-semibold text-white">{integration.name}</p>
      {integration.company ? <p className="mt-1 text-sm text-cyan-100">{integration.company.name}</p> : null}
      <p className="mt-2 text-sm leading-6 text-slate-400">{integration.description}</p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-xs text-slate-300">
        {Object.entries(integration.maskedDisplay ?? { token: "not connected" }).map(([key, value]) => (
          <p key={key} className="flex justify-between gap-3">
            <span className="text-slate-500">{key}</span>
            <span className="font-mono text-cyan-100">{String(value)}</span>
          </p>
        ))}
      </div>
      <div className="mt-4 space-y-1 text-xs text-slate-500">
        <p>Last verified: {integration.lastVerifiedAt ? new Date(integration.lastVerifiedAt).toLocaleString() : "Never"}</p>
        <p>Last error: {integration.lastVerificationError ?? "None"}</p>
        <p>Updated by: {integration.updatedBy?.name ?? integration.createdBy?.name ?? "System"}</p>
      </div>
      <div className="mt-5 flex gap-2">
        <NeonButton size="sm" variant="secondary">View Details</NeonButton>
        {onDisconnect ? <NeonButton size="sm" variant="secondary" onClick={() => onDisconnect(integration)}>Disconnect</NeonButton> : null}
        {onTest ? <NeonButton size="sm" onClick={() => onTest(integration)}>Test Connection</NeonButton> : null}
      </div>
    </GlassCard>
  );
}
