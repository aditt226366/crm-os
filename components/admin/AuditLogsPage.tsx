"use client";

import { useEffect, useState } from "react";
import { AuditLogTable } from "@/components/admin/AuditLogTable";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";

type AuditLogRow = Parameters<typeof AuditLogTable>[0]["rows"][number];

export function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/audit-logs")
      .then((response) => response.json())
      .then((data: { logs: AuditLogRow[] }) => setLogs(data.logs ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Audit Logs</p>
        <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Admin action trail</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Sensitive actions are recorded with actor, tenant, IP address, user agent, entity, and timestamp.
        </p>
      </section>
      <GlassCard className="p-4">{loading ? <LoadingSkeleton rows={6} /> : <AuditLogTable rows={logs} />}</GlassCard>
    </div>
  );
}
