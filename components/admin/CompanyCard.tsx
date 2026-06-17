"use client";

import { Building2 } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NeonButton } from "@/components/shared/NeonButton";

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  ownerEmail: string;
  ownerUsername?: string;
  ownerName?: string;
  lastLoginAt: string | null;
  usersCount: number;
  enabledFeaturesCount: number;
  createdAt: string;
};

export function CompanyCard({
  company,
  onManage
}: {
  company: CompanySummary;
  onManage: (company: CompanySummary) => void;
}) {
  return (
    <GlassCard className="p-5 transition hover:-translate-y-1 hover:border-cyan-300/30 hover:shadow-glow">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
          <Building2 className="h-5 w-5" />
        </span>
        <StatusBadge value={company.status} />
      </div>
      <h3 className="mt-5 text-xl font-semibold text-white">{company.name}</h3>
      <p className="mt-1 text-sm text-slate-400">{company.slug}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <p className="text-xs text-slate-500">Plan</p>
          <StatusBadge value={company.plan} className="mt-2" />
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <p className="text-xs text-slate-500">Features</p>
          <p className="mt-2 font-semibold text-white">{company.enabledFeaturesCount}</p>
        </div>
      </div>
      <p className="mt-4 truncate text-sm text-slate-300">{company.ownerUsername ?? company.ownerEmail}</p>
      <p className="mt-1 text-xs text-slate-500">Last login: {company.lastLoginAt ? new Date(company.lastLoginAt).toLocaleString() : "Never"}</p>
      <NeonButton className="mt-5 w-full" variant="secondary" onClick={() => onManage(company)}>
        Manage Features
      </NeonButton>
    </GlassCard>
  );
}
