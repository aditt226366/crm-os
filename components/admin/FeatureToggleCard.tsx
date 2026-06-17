"use client";

import { motion } from "framer-motion";
import { StatusBadge } from "@/components/shared/StatusBadge";

export type FeatureRecord = {
  id: string;
  featureKey: string;
  name: string;
  description: string;
  route: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: { name: string; email: string } | null;
};

export function FeatureToggleCard({
  feature,
  onToggle
}: {
  feature: FeatureRecord;
  onToggle: (feature: FeatureRecord) => void;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-white">{feature.name}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{feature.description}</p>
        </div>
        <button
          onClick={() => onToggle(feature)}
          className="relative h-7 w-12 rounded-full border border-white/10 bg-slate-800 p-1 transition"
          aria-label={`Toggle ${feature.name}`}
        >
          <motion.span
            className="block h-5 w-5 rounded-full bg-cyan-200 shadow-glow"
            animate={{ x: feature.enabled ? 20 : 0, opacity: feature.enabled ? 1 : 0.55 }}
          />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge value={feature.enabled ? "ENABLED" : "DISABLED"} />
        <span className="text-xs text-slate-500">Updated {new Date(feature.updatedAt).toLocaleString()}</span>
        <span className="text-xs text-slate-500">By {feature.updatedBy?.name ?? "System"}</span>
      </div>
    </div>
  );
}
