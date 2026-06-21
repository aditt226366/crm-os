import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  ACTIVE: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
  DEACTIVATED: "border-rose-300/20 bg-rose-300/10 text-rose-100",
  ENABLED: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
  DISABLED: "border-slate-300/10 bg-slate-500/10 text-slate-300",
  CONNECTED: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
  NOT_CONNECTED: "border-slate-300/10 bg-slate-500/10 text-slate-300",
  ERROR: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  PARTIALLY_CONNECTED: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  META_DELIVERY_LIMITED: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  STARTER: "border-slate-300/10 bg-white/[0.04] text-slate-200",
  PRO: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
  ENTERPRISE: "border-blue-300/20 bg-blue-300/10 text-blue-100"
};

const labels: Record<string, string> = {
  PARTIALLY_CONNECTED: "NEEDS ATTENTION",
  META_DELIVERY_LIMITED: "Meta delivery-limited"
};

export function StatusBadge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        styles[value] ?? styles.DISABLED,
        className
      )}
    >
      {labels[value] ?? value.replaceAll("_", " ")}
    </span>
  );
}
