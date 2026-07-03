import { LucideIcon } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";

export function OverviewMetricCard({
  label,
  value,
  detail,
  icon: Icon
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {detail ? <p className="mt-4 text-sm text-cyan-100">{detail}</p> : null}
    </GlassCard>
  );
}
