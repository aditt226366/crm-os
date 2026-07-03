"use client";

import { useEffect, useState } from "react";
import { CompanyCard, CompanySummary } from "@/components/admin/CompanyCard";
import { CompanyFeatureDrawer } from "@/components/admin/CompanyFeatureDrawer";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";

export function FeaturesPage() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [selected, setSelected] = useState<CompanySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/companies")
      .then((response) => response.json())
      .then((data: { companies: CompanySummary[] }) => setCompanies(data.companies ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Features</p>
        <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Company feature controls</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Toggle tenant capabilities from one place. Disabled features disappear from workspace navigation and are blocked by backend guards.
        </p>
      </section>
      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => (
            <CompanyCard key={company.id} company={company} onManage={setSelected} />
          ))}
        </section>
      )}
      <CompanyFeatureDrawer company={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

