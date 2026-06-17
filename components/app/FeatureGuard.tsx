"use client";

import Link from "next/link";
import type { FeatureKey } from "@/lib/constants";
import { FEATURE_DEFINITIONS } from "@/lib/constants";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useAppShell } from "@/components/app/AppLayout";

export function FeatureGuard({
  featureKey,
  children
}: {
  featureKey: FeatureKey | null;
  children: React.ReactNode;
}) {
  const { enabledFeatureSet, loading } = useAppShell();

  if (!featureKey) {
    return children;
  }

  if (loading) {
    return <LoadingSkeleton rows={8} />;
  }

  if (!enabledFeatureSet.has(featureKey)) {
    const definition = FEATURE_DEFINITIONS[featureKey];
    return (
      <div className="grid min-h-[calc(100vh-7rem)] place-items-center">
        <GlassCard className="w-full max-w-xl p-6 text-center">
          <StatusBadge value="FEATURE_DISABLED" />
          <h1 className="mt-5 text-3xl font-semibold text-white">{definition.name} is not enabled</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-slate-400">
            This feature is not enabled for your company. Contact admin.
          </p>
          <Link href="/app/dashboard" className="mt-6 inline-flex">
            <NeonButton>Back to Dashboard</NeonButton>
          </Link>
        </GlassCard>
      </div>
    );
  }

  return children;
}
