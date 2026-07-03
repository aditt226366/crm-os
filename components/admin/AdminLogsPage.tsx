"use client";

import { ShieldAlert } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";

export function AdminLogsPage() {
  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Logs · Admin Logs</p>
        <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Platform admin activity</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          A dedicated trail for platform-admin actions — logins, company creation, password resets, and feature or
          integration changes — kept separate from tenant audit logs.
        </p>
      </section>

      <GlassCard className="p-10 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
          <ShieldAlert className="h-6 w-6" />
        </span>
        <h2 className="mt-6 text-xl font-semibold text-white">Reserved for future logging</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
          Admin-specific logging is wired into the navigation and ready to receive events. Once the admin log stream is
          switched on, every platform-level action will appear here with actor, target, and timestamp.
        </p>
      </GlassCard>
    </div>
  );
}
