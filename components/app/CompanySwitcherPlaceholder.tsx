"use client";

import { Building2, ChevronDown } from "lucide-react";
import { useAppShell } from "@/components/app/AppLayout";

export function CompanySwitcherPlaceholder() {
  const { user } = useAppShell();

  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm text-slate-200"
      title="Company switcher placeholder"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-300/10 text-cyan-100">
        <Building2 className="h-3.5 w-3.5" />
      </span>
      <span className="hidden max-w-[9rem] truncate font-semibold sm:block">{user?.tenant?.name ?? "Company"}</span>
      <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
    </button>
  );
}
