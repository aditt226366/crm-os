"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { CompanyFeatureDrawer } from "@/components/admin/CompanyFeatureDrawer";
import { CompanySummary } from "@/components/admin/CompanyCard";
import { CompanyTable } from "@/components/admin/CompanyTable";
import { CreateCompanyModal } from "@/components/admin/CreateCompanyModal";
import { ResetPasswordModal } from "@/components/admin/ResetPasswordModal";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";

export function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetCompany, setResetCompany] = useState<CompanySummary | null>(null);
  const [drawerCompany, setDrawerCompany] = useState<CompanySummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadCompanies() {
    const response = await fetch("/api/admin/companies");
    const data = (await response.json()) as { companies: CompanySummary[] };
    setCompanies(data.companies ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetch("/api/admin/companies")
      .then((response) => response.json())
      .then((data: { companies: CompanySummary[] }) => setCompanies(data.companies ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function toggleStatus(company: CompanySummary) {
    const action = company.status === "ACTIVE" ? "deactivate" : "reactivate";
    const response = await fetch(`/api/admin/companies/${company.id}/${action}`, { method: "POST" });
    if (response.ok) {
      setNotice(`${company.name} ${action === "deactivate" ? "deactivated" : "reactivated"}.`);
      await loadCompanies();
    } else {
      setNotice(`Could not ${action} ${company.name}.`);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Companies</p>
          <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Tenant access foundation</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            Create companies, issue temporary passwords once, reset access, and deactivate tenants across every protected route.
          </p>
        </div>
        <NeonButton onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create Company
        </NeonButton>
      </section>

      {notice ? (
        <GlassCard className="border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">{notice}</GlassCard>
      ) : null}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <CompanyTable
          companies={companies}
          onOpen={setDrawerCompany}
          onResetPassword={setResetCompany}
          onToggleStatus={toggleStatus}
        />
      )}

      <CreateCompanyModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={loadCompanies} />
      <ResetPasswordModal company={resetCompany} onClose={() => setResetCompany(null)} />
      <CompanyFeatureDrawer company={drawerCompany} onClose={() => setDrawerCompany(null)} />
    </div>
  );
}
