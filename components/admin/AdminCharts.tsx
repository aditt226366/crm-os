"use client";

import { LucideIcon } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";

/** Compact KPI tile with icon, big value and a supporting line. */
export function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  accent = "cyan"
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
  accent?: "cyan" | "emerald" | "rose" | "blue" | "amber";
}) {
  const accents: Record<string, string> = {
    cyan: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
    emerald: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
    rose: "border-rose-300/20 bg-rose-300/10 text-rose-100",
    blue: "border-blue-300/20 bg-blue-300/10 text-blue-100",
    amber: "border-amber-300/20 bg-amber-300/10 text-amber-100"
  };
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
        </div>
        <span className={`grid h-11 w-11 place-items-center rounded-2xl border ${accents[accent]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {detail ? <p className="mt-4 text-xs leading-5 text-slate-400">{detail}</p> : null}
    </GlassCard>
  );
}

export type DonutSegment = { label: string; value: number; color: string };

export function Donut({
  segments,
  size = 168,
  thickness = 20,
  centerLabel,
  centerSub
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string | number;
  centerSub?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={thickness} className="stroke-white/10" />
        {segments.map((seg, i) => {
          const length = (seg.value / total) * circumference;
          const node = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return node;
        })}
      </svg>
      {centerLabel != null ? (
        <div className="absolute text-center">
          <p className="text-3xl font-semibold text-white">{centerLabel}</p>
          {centerSub ? <p className="text-xs text-slate-400">{centerSub}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Legend({ segments }: { segments: DonutSegment[] }) {
  return (
    <div className="space-y-2">
      {segments.map((seg) => (
        <div key={seg.label} className="flex items-center justify-between gap-4 text-sm">
          <span className="flex items-center gap-2 text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: seg.color }} />
            {seg.label}
          </span>
          <span className="font-semibold text-white">{seg.value}</span>
        </div>
      ))}
    </div>
  );
}

export function BarRow({
  label,
  value,
  max,
  color = "#25D366",
  suffix = ""
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  suffix?: string;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-slate-300">{label}</span>
        <span className="shrink-0 font-semibold text-white">
          {value.toLocaleString()}
          {suffix}
        </span>
      </div>
      <span className="block h-2 rounded-full bg-white/10">
        <span className="block h-2 rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
    </div>
  );
}

export function EmptyChart({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{label}</p>;
}
