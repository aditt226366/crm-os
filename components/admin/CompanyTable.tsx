"use client";

import { Eye, Power, RotateCcw } from "lucide-react";
import { CompanySummary } from "@/components/admin/CompanyCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NeonButton } from "@/components/shared/NeonButton";

export function CompanyTable({
  companies,
  onResetPassword,
  onToggleStatus,
  onOpen
}: {
  companies: CompanySummary[];
  onResetPassword: (company: CompanySummary) => void;
  onToggleStatus: (company: CompanySummary) => void;
  onOpen: (company: CompanySummary) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-[24px] border border-white/10 bg-white/[0.035]">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-4">Company</th>
            <th className="px-4 py-4">Owner</th>
            <th className="px-4 py-4">Plan</th>
            <th className="px-4 py-4">Status</th>
            <th className="px-4 py-4">Users</th>
            <th className="px-4 py-4">Features</th>
            <th className="px-4 py-4">Last Login</th>
            <th className="px-4 py-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {companies.map((company) => (
            <tr key={company.id} className="transition hover:bg-cyan-300/[0.04]">
              <td className="px-4 py-4">
                <p className="font-semibold text-white">{company.name}</p>
                <p className="text-xs text-slate-500">{company.slug}</p>
              </td>
              <td className="px-4 py-4 text-slate-300">{company.ownerUsername ?? company.ownerEmail}</td>
              <td className="px-4 py-4"><StatusBadge value={company.plan} /></td>
              <td className="px-4 py-4"><StatusBadge value={company.status} /></td>
              <td className="px-4 py-4 text-slate-300">{company.usersCount}</td>
              <td className="px-4 py-4 text-slate-300">{company.enabledFeaturesCount}</td>
              <td className="px-4 py-4 text-slate-400">{company.lastLoginAt ? new Date(company.lastLoginAt).toLocaleDateString() : "Never"}</td>
              <td className="px-4 py-4">
                <div className="flex justify-end gap-2">
                  <NeonButton size="sm" variant="secondary" onClick={() => onOpen(company)}><Eye className="h-4 w-4" />Open</NeonButton>
                  <NeonButton size="sm" variant="secondary" onClick={() => onResetPassword(company)}><RotateCcw className="h-4 w-4" />Reset</NeonButton>
                  <NeonButton size="sm" variant="secondary" onClick={() => onToggleStatus(company)}><Power className="h-4 w-4" />{company.status === "ACTIVE" ? "Deactivate" : "Reactivate"}</NeonButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
