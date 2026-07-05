"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CompanyCard, CompanySummary } from "@/components/admin/CompanyCard";
import { CreateCompanyModal } from "@/components/admin/CreateCompanyModal";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";

export function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/companies");
      const data = (await response.json().catch(() => ({}))) as {
        companies?: CompanySummary[];
        error?: { message?: string };
        message?: string;
      };

      if (!response.ok) {
        setCompanies([]);
        setNotice(data.error?.message ?? data.message ?? "Could not load companies.");
        return;
      }

      setCompanies(data.companies ?? []);
      setNotice(null);
    } catch {
      setCompanies([]);
      setNotice("Could not reach the company API. Check the server and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadCompanies());
  }, [loadCompanies]);

  function openCompany(company: CompanySummary) {
    router.push(`/admin/companies/${company.id}`);
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Companies</p>
          <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Every company on the platform</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            One card per tenant. Open a company to manage its overview, features, integrations, and billing in a single
            workspace.
          </p>
        </div>
        <NeonButton onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create Company
        </NeonButton>
      </section>

      {notice ? <GlassCard className="border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">{notice}</GlassCard> : null}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : companies.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => (
            <CompanyCard key={company.id} company={company} onManage={openCompany} />
          ))}
        </section>
      ) : (
        <GlassCard className="p-10 text-center">
          <p className="text-white">No companies yet.</p>
          <p className="mt-2 text-sm text-slate-400">Create your first company to get started.</p>
        </GlassCard>
      )}

      <CreateCompanyModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={loadCompanies} />
    </div>
  );
}
