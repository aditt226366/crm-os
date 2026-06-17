type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  company: string | null;
  actor: string;
  ipAddress: string | null;
  createdAt: string;
};

export function AuditLogTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[24px] border border-white/10 bg-white/[0.035]">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            {["Action", "Entity", "Company", "Actor", "IP", "Time"].map((head) => (
              <th key={head} className="px-4 py-4">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-4 text-white">{row.action}</td>
              <td className="px-4 py-4 text-slate-300">{row.entityType} {row.entityId ? row.entityId.slice(0, 8) : ""}</td>
              <td className="px-4 py-4 text-slate-300">{row.company ?? "Platform"}</td>
              <td className="px-4 py-4 text-cyan-100">{row.actor}</td>
              <td className="px-4 py-4 text-slate-400">{row.ipAddress ?? "unknown"}</td>
              <td className="px-4 py-4 text-slate-400">{new Date(row.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
