"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CompanySummary } from "@/components/admin/CompanyCard";
import { FeatureRecord, FeatureToggleCard } from "@/components/admin/FeatureToggleCard";
import { IntegrationCard, IntegrationRecord } from "@/components/admin/IntegrationCard";
import { NeonButton } from "@/components/shared/NeonButton";

type ApiErrorPayload = {
  message?: string;
  error?: string | { message?: string };
  details?: Array<{ message?: string }>;
};

function messageFromPayload(data: ApiErrorPayload | null, fallback: string) {
  if (!data) return fallback;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  if (data.error && typeof data.error === "object" && data.error.message) return data.error.message;
  if (data.details?.[0]?.message) return data.details[0].message;
  return fallback;
}

async function integrationRequest<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options);
  const data = (await response.json().catch(() => null)) as (T & ApiErrorPayload) | null;

  if (!response.ok) {
    throw new Error(messageFromPayload(data, `Request failed with status ${response.status}`));
  }

  return data as T;
}

export function CompanyFeatureDrawer({
  company,
  onClose
}: {
  company: CompanySummary | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"features" | "integrations">("features");
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const companyId = company?.id;

  async function loadCompanyData(companyId: string) {
    const [featureResponse, integrationResponse] = await Promise.all([
      fetch(`/api/admin/companies/${companyId}/features`),
      fetch(`/api/admin/companies/${companyId}/integrations`)
    ]);
    const featureData = (await featureResponse.json()) as { features: FeatureRecord[] };
    const integrationData = (await integrationResponse.json()) as { integrations: IntegrationRecord[] };
    setFeatures(featureData.features ?? []);
    setIntegrations(integrationData.integrations ?? []);
  }

  useEffect(() => {
    if (!companyId) return;
    let active = true;

    Promise.all([
      fetch(`/api/admin/companies/${companyId}/features`),
      fetch(`/api/admin/companies/${companyId}/integrations`)
    ]).then(async ([featureResponse, integrationResponse]) => {
      if (!active) return;
      const featureData = (await featureResponse.json()) as { features: FeatureRecord[] };
      const integrationData = (await integrationResponse.json()) as { integrations: IntegrationRecord[] };
      setFeatures(featureData.features ?? []);
      setIntegrations(integrationData.integrations ?? []);
    });

    return () => {
      active = false;
    };
  }, [companyId]);

  async function toggleFeature(feature: FeatureRecord) {
    const previous = features;
    const nextEnabled = !feature.enabled;
    setFeatures((current) =>
      current.map((item) => (item.featureKey === feature.featureKey ? { ...item, enabled: nextEnabled } : item))
    );
    const response = await fetch(`/api/admin/companies/${company!.id}/features/${feature.featureKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: nextEnabled })
    });
    if (!response.ok) {
      setFeatures(previous);
      setToast("Feature update failed. Rolled back.");
      return;
    }
    setToast(`${feature.name} ${nextEnabled ? "enabled" : "disabled"} for ${company!.name}`);
    await loadCompanyData(company!.id);
  }

  async function testIntegration(integration: IntegrationRecord) {
    try {
      const data = await integrationRequest<{ message?: string }>(
        `/api/admin/companies/${company!.id}/integrations/${integration.type}/test`,
        { method: "POST" }
      );
      setToast(data.message ?? `${integration.name} test completed.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : `${integration.name} test failed.`);
    }
  }

  async function disconnectIntegration(integration: IntegrationRecord) {
    try {
      const data = await integrationRequest<{ message?: string }>(
        `/api/admin/companies/${company!.id}/integrations/${integration.type}/disconnect`,
        { method: "POST" }
      );
      setToast(data.message ?? `${integration.name} disconnected for ${company!.name}`);
      await loadCompanyData(company!.id);
    } catch (error) {
      setToast(error instanceof Error ? error.message : `${integration.name} disconnect failed.`);
    }
  }

  return (
    <AnimatePresence>
      {company ? (
        <motion.div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.aside className="ml-auto h-full w-full max-w-5xl overflow-y-auto border-l border-white/10 bg-[#050b16]/95 p-5 shadow-glow" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 28, stiffness: 220 }}>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-cyan-200/80">{company.plan}</p>
                <h2 className="mt-2 text-3xl font-semibold text-white">{company.name}</h2>
                <p className="mt-2 text-sm text-slate-400">{company.ownerEmail}</p>
              </div>
              <NeonButton variant="secondary" onClick={onClose}>Close</NeonButton>
            </div>
            <div className="mt-6 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
              {(["features", "integrations"] as const).map((item) => (
                <button key={item} onClick={() => setTab(item)} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${tab === item ? "bg-cyan-300 text-slate-950" : "text-slate-300"}`}>
                  {item === "features" ? "Features" : "Integrations"}
                </button>
              ))}
            </div>
            {toast ? <p className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">{toast}</p> : null}
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {tab === "features"
                ? features.map((feature) => <FeatureToggleCard key={feature.featureKey} feature={feature} onToggle={toggleFeature} />)
                : integrations.map((integration) => (
                    <IntegrationCard key={integration.type} integration={integration} onTest={testIntegration} onDisconnect={disconnectIntegration} />
                  ))}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
