"use client";

import { Activity } from "lucide-react";
import { useAppShell } from "@/components/app/AppLayout";

export function UsageBadge() {
  const { user } = useAppShell();

  return (
    <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300 md:flex">
      <Activity className="h-3.5 w-3.5 text-cyan-100" />
      <span>{user?.tenant?.plan ?? "PLAN"}</span>
    </div>
  );
}
