"use client";

import { ChangeEvent, type CSSProperties, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  LayoutTemplate,
  Megaphone,
  MessageCircle,
  Save,
  Sheet,
  TestTube2,
  Unplug,
  Upload,
  X
} from "lucide-react";
import { INTEGRATION_TYPES, type IntegrationType } from "@/lib/constants";
import { INTEGRATION_CATALOG, IntegrationFieldDefinition, isSensitiveField } from "@/lib/integration-catalog";
import { IntegrationRecord } from "@/components/admin/IntegrationCard";
import { WhatsAppEmbeddedSignupButton } from "@/components/integrations/WhatsAppEmbeddedSignupButton";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";

type IntegrationCompanySummary = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  ownerEmail: string;
  ownerUsername: string;
  ownerName: string;
  lastLoginAt: string | null;
  totalIntegrationsCount: number;
  connectedIntegrationsCount: number;
  errorIntegrationsCount: number;
};

type FormValues = Partial<Record<IntegrationType, Record<string, string>>>;
type FieldErrors = Partial<Record<IntegrationType, Record<string, string>>>;
type IntegrationDebugDetails = {
  route: string;
  statusCode: number | null;
  lastRequestAt: string;
  message: string;
  code?: string;
  field?: string;
};

type IntegrationApiErrorPayload = {
  ok?: boolean;
  message?: string;
  error?: string | { message?: string; code?: string };
  details?: Array<{ message?: string }>;
  code?: string;
  field?: string;
};

class IntegrationApiRequestError extends Error {
  constructor(
    message: string,
    public statusCode: number | null,
    public payload: IntegrationApiErrorPayload | null,
    public route: string
  ) {
    super(message);
    this.name = "IntegrationApiRequestError";
  }
}

const iconMap = {
  sheets: Sheet,
  whatsapp: MessageCircle,
  template: LayoutTemplate,
  ads: Megaphone,
  knowledge: FileText,
  ai: Bot
} as const;

function fieldKey(type: IntegrationType, field: string) {
  return `${type}:${field}`;
}

function pendingKey(type: IntegrationType, action: string) {
  return `${type}:${action}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function integrationByType(integrations: IntegrationRecord[]) {
  return new Map(integrations.map((integration) => [integration.type as IntegrationType, integration]));
}

function messageFromPayload(data: IntegrationApiErrorPayload | null, fallback: string) {
  if (!data) return fallback;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  if (data.error && typeof data.error === "object" && data.error.message) return data.error.message;
  if (data.details?.[0]?.message) return data.details[0].message;
  return fallback;
}

async function apiRequest<T>(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "include",
      headers
    });
  } catch (error) {
    throw new IntegrationApiRequestError(
      error instanceof Error ? error.message : "Network request failed",
      null,
      null,
      url
    );
  }

  const data = (await response.json().catch(() => null)) as (T & IntegrationApiErrorPayload) | null;
  if (!response.ok) {
    throw new IntegrationApiRequestError(
      messageFromPayload(data, `Request failed with status ${response.status}`),
      response.status,
      data,
      url
    );
  }

  return { data: data as T, statusCode: response.status };
}

export function IntegrationsPage() {
  const [companies, setCompanies] = useState<IntegrationCompanySummary[]>([]);
  const [selected, setSelected] = useState<IntegrationCompanySummary | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadCompanies() {
    setLoading(true);
    const response = await fetch("/api/admin/integrations/companies");
    const data = (await response.json()) as { companies: IntegrationCompanySummary[] };
    setCompanies(data.companies ?? []);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/integrations/companies")
      .then((response) => response.json())
      .then((data: { companies: IntegrationCompanySummary[] }) => {
        if (active) setCompanies(data.companies ?? []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Integrations</p>
        <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Company integration vault</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Manage tenant-specific Google, WhatsApp, Meta Ads, knowledge base, and AI credentials from secure company cards.
        </p>
      </section>

      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : (
        <motion.section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" initial="hidden" animate="visible">
          {companies.map((company, index) => (
            <IntegrationCompanyCard key={company.id} company={company} index={index} onManage={setSelected} />
          ))}
        </motion.section>
      )}

      <CompanyIntegrationDrawer
        key={selected?.id ?? "closed"}
        company={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          loadCompanies();
        }}
      />
    </div>
  );
}

function IntegrationCompanyCard({
  company,
  index,
  onManage
}: {
  company: IntegrationCompanySummary;
  index: number;
  onManage: (company: IntegrationCompanySummary) => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.35 }}
    >
      <GlassCard className="h-full p-5 transition hover:-translate-y-1 hover:border-cyan-300/30 hover:shadow-glow">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
            <Building2 className="h-5 w-5" />
          </span>
          <StatusBadge value={company.status} />
        </div>
        <h3 className="mt-5 text-xl font-semibold text-white">{company.name}</h3>
        <p className="mt-1 text-sm text-slate-400">{company.slug}</p>

        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-500">Plan</p>
            <StatusBadge value={company.plan} className="mt-2" />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-500">Integrations</p>
            <p className="mt-2 font-semibold text-white">
              {company.connectedIntegrationsCount} / {company.totalIntegrationsCount}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-500">Errors</p>
            <p className="mt-2 font-semibold text-white">{company.errorIntegrationsCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs text-slate-500">Owner</p>
            <p className="mt-2 truncate font-semibold text-white">{company.ownerUsername || company.ownerEmail}</p>
          </div>
        </div>

        <p className="mt-4 truncate text-sm text-slate-300">{company.ownerEmail}</p>
        <p className="mt-1 text-xs text-slate-500">Last login: {displayDate(company.lastLoginAt)}</p>
        <NeonButton className="mt-5 w-full" variant="secondary" onClick={() => onManage(company)}>
          Manage Integrations
        </NeonButton>
      </GlassCard>
    </motion.article>
  );
}

function CompanyIntegrationDrawer({
  company,
  onClose,
  onChanged
}: {
  company: IntegrationCompanySummary | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"integrations" | "logs">("integrations");
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});
  const [debugDetails, setDebugDetails] = useState<Record<IntegrationType, IntegrationDebugDetails | null>>({} as Record<IntegrationType, IntegrationDebugDetails | null>);
  const companyId = company?.id;
  const integrationMap = useMemo(() => integrationByType(integrations), [integrations]);

  useEffect(() => {
    if (!companyId) return;
    let active = true;

    apiRequest<{ integrations: IntegrationRecord[] }>(`/api/admin/companies/${companyId}/integrations`)
      .then(({ data }) => {
        if (!active) return;
        setIntegrations(data.integrations ?? []);
        setFormValues(buildVisibleDefaults(data.integrations ?? []));
      })
      .catch((error: unknown) => {
        if (active) {
          setToast(error instanceof Error ? error.message : "Integration request failed.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [companyId]);

  function updateFormValue(type: IntegrationType, field: string, value: string) {
    setFormValues((current) => ({
      ...current,
      [type]: {
        ...(current[type] ?? {}),
        [field]: value
      }
    }));
    setFieldErrors((current) => {
      const next = { ...(current[type] ?? {}) };
      delete next[field];
      return { ...current, [type]: next };
    });
  }

  function applyIntegrationUpdate(integration: IntegrationRecord) {
    setIntegrations((current) => {
      const exists = current.some((item) => item.type === integration.type);
      if (!exists) return [...current, integration];
      return current.map((item) => (item.type === integration.type ? integration : item));
    });
    onChanged();
  }

  function clearProtectedFields(type: IntegrationType) {
    setFormValues((current) => {
      const next = { ...(current[type] ?? {}) };
      for (const field of INTEGRATION_CATALOG[type].fields) {
        if (isSensitiveField(type, field.name)) {
          delete next[field.name];
        }
      }
      return { ...current, [type]: next };
    });
  }

  async function runAction(type: IntegrationType, action: "save" | "verify" | "test" | "disconnect") {
    if (!company) return;
    const key = pendingKey(type, action);
    setPending((current) => ({ ...current, [key]: true }));
    setToast(null);
    setFieldErrors((current) => ({ ...current, [type]: {} }));
    try {
      const title = INTEGRATION_CATALOG[type].title;
      const config = formValues[type] ?? {};
      let route = `/api/admin/companies/${company.id}/integrations/${type}`;
      let requestOptions: RequestInit = {};

      if (action === "disconnect") {
        const confirmed = window.confirm(`Disconnect ${title} for ${company.name}?`);
        if (!confirmed) return;
        route = `${route}/disconnect`;
        requestOptions = { method: "POST" };
      } else if (action === "test") {
        route = `${route}/test`;
        requestOptions = { method: "POST" };
      } else {
        route = `${route}${action === "verify" ? "/verify" : ""}`;
        requestOptions = {
          method: action === "save" ? "PATCH" : "POST",
          body: JSON.stringify({ config })
        };
      }

      const { data, statusCode } = await apiRequest<{
        ok?: boolean;
        integration?: IntegrationRecord;
        status?: string;
        message?: string;
        code?: string;
        field?: string;
      }>(route, requestOptions);
      const message = data.message ?? `${title} update failed`;

      setDebugDetails((current) => ({
        ...current,
        [type]: {
          route,
          statusCode,
          lastRequestAt: new Date().toISOString(),
          message,
          code: data.code,
          field: data.field
        }
      }));

      if (data.integration) applyIntegrationUpdate(data.integration);
      clearProtectedFields(type);
      setToast(action === "disconnect" ? `${title} disconnected` : message);
      if (action === "disconnect") {
        setFormValues((current) => ({ ...current, [type]: {} }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Integration request failed.";
      const apiError = error instanceof IntegrationApiRequestError ? error : null;

      if (apiError?.payload?.field) {
        setFieldErrors((current) => ({
          ...current,
          [type]: {
            ...(current[type] ?? {}),
            [apiError.payload!.field!]: message
          }
        }));
      }

      setDebugDetails((current) => ({
        ...current,
        [type]: {
          route: apiError?.route ?? `/api/admin/companies/${company.id}/integrations/${type}`,
          statusCode: apiError?.statusCode ?? null,
          lastRequestAt: new Date().toISOString(),
          message,
          code: apiError?.payload?.code,
          field: apiError?.payload?.field
        }
      }));
      setToast(message);
    } finally {
      setPending((current) => ({ ...current, [key]: false }));
    }
  }

  return (
    <AnimatePresence>
      {company ? (
        <motion.div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.aside
            className="ml-auto h-full w-full max-w-6xl overflow-y-auto border-l border-white/10 bg-[#050b16]/95 p-5 shadow-glow"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 220 }}
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-cyan-200/80">{company.slug}</p>
                <h2 className="mt-2 text-3xl font-semibold text-white">{company.name}</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge value={company.plan} />
                  <StatusBadge value={company.status} />
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">
                    {company.connectedIntegrationsCount} / {company.totalIntegrationsCount} connected
                  </span>
                </div>
              </div>
              <button
                aria-label="Close integrations"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/40 hover:text-white"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
              {[
                ["integrations", "Integrations"],
                ["logs", "Verification Logs"]
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTab(value as "integrations" | "logs")}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    tab === value ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {toast ? <p className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">{toast}</p> : null}

            {loading ? (
              <div className="mt-6">
                <LoadingSkeleton rows={6} />
              </div>
            ) : tab === "integrations" ? (
              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                {INTEGRATION_TYPES.map((type) => (
                  <IntegrationFormCard
                    key={type}
                    type={type}
                    companyId={company.id}
                    companyName={company.name}
                    integration={integrationMap.get(type)}
                    values={formValues[type] ?? {}}
                    fieldErrors={fieldErrors[type] ?? {}}
                    pending={pending}
                    visibleFields={visibleFields}
                    debugDetails={debugDetails[type] ?? null}
                    onVisibleChange={(field, visible) => setVisibleFields((current) => ({ ...current, [fieldKey(type, field)]: visible }))}
                    onChange={(field, value) => updateFormValue(type, field, value)}
                    onSave={() => runAction(type, "save")}
                    onVerify={() => runAction(type, "verify")}
                    onTest={() => runAction(type, "test")}
                    onDisconnect={() => runAction(type, "disconnect")}
                    onEmbeddedSignupConnected={(integration, message) => {
                      applyIntegrationUpdate(integration);
                      clearProtectedFields("WHATSAPP_CLOUD");
                      setToast(message);
                    }}
                  />
                ))}
              </div>
            ) : (
              <VerificationLogCards integrations={integrations} />
            )}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function buildVisibleDefaults(integrations: IntegrationRecord[]) {
  const defaults: FormValues = {};
  for (const integration of integrations) {
    const type = integration.type as IntegrationType;
    const values: Record<string, string> = {};
    for (const field of INTEGRATION_CATALOG[type].fields) {
      if (isSensitiveField(type, field.name)) continue;
      const value = integration.maskedDisplay?.[field.name];
      if (typeof value === "string" && value !== "not connected") {
        values[field.name] = value;
      }
    }
    defaults[type] = values;
  }
  return defaults;
}

function IntegrationFormCard({
  type,
  companyId,
  companyName,
  integration,
  values,
  fieldErrors,
  pending,
  visibleFields,
  debugDetails,
  onVisibleChange,
  onChange,
  onSave,
  onVerify,
  onTest,
  onDisconnect,
  onEmbeddedSignupConnected
}: {
  type: IntegrationType;
  companyId: string;
  companyName: string;
  integration?: IntegrationRecord;
  values: Record<string, string>;
  fieldErrors: Record<string, string>;
  pending: Record<string, boolean>;
  visibleFields: Record<string, boolean>;
  debugDetails: IntegrationDebugDetails | null;
  onVisibleChange: (field: string, visible: boolean) => void;
  onChange: (field: string, value: string) => void;
  onSave: () => void;
  onVerify: () => void;
  onTest: () => void;
  onDisconnect: () => void;
  onEmbeddedSignupConnected: (integration: IntegrationRecord, message: string) => void;
}) {
  const catalog = INTEGRATION_CATALOG[type];
  const Icon = iconMap[catalog.icon];
  const isKnowledgeBase = type === "KNOWLEDGE_BASE";
  const isPending = (action: string) => Boolean(pending[pendingKey(type, action)]);

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
          <Icon className="h-5 w-5" />
        </span>
        <StatusBadge value={integration?.status ?? "NOT_CONNECTED"} />
      </div>

      <h3 className="mt-5 text-lg font-semibold text-white">{catalog.title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{catalog.description}</p>
      {catalog.helpText ? <p className="mt-3 text-xs leading-5 text-cyan-100/80">{catalog.helpText}</p> : null}
      {type === "WHATSAPP_CLOUD" ? (
        <div className="mt-5">
          <WhatsAppEmbeddedSignupButton
            companyId={companyId}
            companyName={companyName}
            onConnected={({ integration, message }) => onEmbeddedSignupConnected(integration, message)}
          />
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {catalog.fields.map((field) => (
          <IntegrationField
            key={field.name}
            type={type}
            field={field}
            values={values}
            error={fieldErrors[field.name]}
            integration={integration}
            visible={Boolean(visibleFields[fieldKey(type, field.name)])}
            onVisibleChange={(visible) => onVisibleChange(field.name, visible)}
            onChange={(value) => onChange(field.name, value)}
          />
        ))}
      </div>

      {integration?.maskedDisplay && Object.keys(integration.maskedDisplay).length ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-xs text-slate-300">
          {Object.entries(integration.maskedDisplay).map(([key, value]) => (
            <p key={key} className="flex justify-between gap-3 py-1">
              <span className="text-slate-500">{key}</span>
              <span className="max-w-[55%] truncate font-mono text-cyan-100">{String(value)}</span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-1 text-xs text-slate-500">
        <p>Last verified: {displayDate(integration?.lastVerifiedAt)}</p>
        <p>Last error: {integration?.lastVerificationError ?? "None"}</p>
      </div>

      <DebugDetails integration={integration} details={debugDetails} />

      <div className="mt-5 flex flex-wrap gap-2">
        {isKnowledgeBase ? (
          <>
            <NeonButton size="sm" variant="secondary" loading={isPending("save")} onClick={onSave}>
              <Upload className="h-3.5 w-3.5" />
              Upload
            </NeonButton>
            <NeonButton size="sm" loading={isPending("verify")} onClick={onVerify}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Index Knowledge Base
            </NeonButton>
            <NeonButton size="sm" variant="secondary" loading={isPending("test")} onClick={onTest}>
              <TestTube2 className="h-3.5 w-3.5" />
              Test AI Answer
            </NeonButton>
          </>
        ) : (
          <>
            <NeonButton size="sm" variant="secondary" loading={isPending("save")} onClick={onSave}>
              <Save className="h-3.5 w-3.5" />
              Save
            </NeonButton>
            <NeonButton size="sm" loading={isPending("verify")} onClick={onVerify}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Save & Verify
            </NeonButton>
            {catalog.testConnection ? (
              <NeonButton size="sm" variant="secondary" loading={isPending("test")} onClick={onTest}>
                <TestTube2 className="h-3.5 w-3.5" />
                Test Connection
              </NeonButton>
            ) : null}
          </>
        )}
        <NeonButton size="sm" variant="secondary" loading={isPending("disconnect")} onClick={onDisconnect}>
          <Unplug className="h-3.5 w-3.5" />
          Disconnect
        </NeonButton>
      </div>
    </GlassCard>
  );
}

function IntegrationField({
  type,
  field,
  values,
  error,
  integration,
  visible,
  onVisibleChange,
  onChange
}: {
  type: IntegrationType;
  field: IntegrationFieldDefinition;
  values: Record<string, string>;
  error?: string;
  integration?: IntegrationRecord;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  onChange: (value: string) => void;
}) {
  const currentValue = values[field.name] ?? "";
  const maskedValue = integration?.maskedDisplay?.[field.name];
  const protectedField = isSensitiveField(type, field.name);
  const shouldHide = protectedField && !visible;
  const isHiddenByDependency =
    field.visibleWhen && values[field.visibleWhen.field] !== field.visibleWhen.value;

  if (isHiddenByDependency) return null;

  const placeholder =
    protectedField && maskedValue
      ? "Saved securely. Enter new value to replace."
      : field.placeholder ?? (field.required ? "Required" : "Optional");

  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {field.label}
        {field.required ? <span className="text-cyan-200">Required</span> : null}
      </span>

      {field.input === "select" ? (
        <select
          value={currentValue}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
        >
          <option value="">Select</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.input === "file" ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/50 p-3">
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              onChange(file?.name ?? "");
            }}
            className="block w-full cursor-pointer text-xs text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-950"
          />
          {currentValue ? <p className="mt-2 truncate text-xs text-cyan-100">{currentValue}</p> : null}
        </div>
      ) : field.input === "password-textarea" ? (
        <div className="relative">
          <textarea
            value={currentValue}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            rows={4}
            style={shouldHide ? ({ WebkitTextSecurity: "disc" } as CSSProperties) : undefined}
            className="min-h-[112px] w-full resize-y rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-3 pr-11 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
          />
          <VisibilityButton visible={visible} onClick={() => onVisibleChange(!visible)} />
        </div>
      ) : (
        <div className="relative">
          <input
            type={shouldHide ? "password" : field.input === "url" ? "url" : "text"}
            value={currentValue}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 pr-11 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
          />
          {protectedField ? <VisibilityButton visible={visible} onClick={() => onVisibleChange(!visible)} /> : null}
        </div>
      )}

      {error ? <span className="mt-2 block text-xs font-semibold leading-5 text-rose-200">{error}</span> : null}
      {field.helpText ? <span className="mt-2 block text-xs leading-5 text-slate-500">{field.helpText}</span> : null}
    </label>
  );
}

function DebugDetails({
  integration,
  details
}: {
  integration?: IntegrationRecord;
  details: IntegrationDebugDetails | null;
}) {
  return (
    <details className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
      <summary className="cursor-pointer font-semibold text-slate-300">Debug details</summary>
      <div className="mt-3 space-y-1">
        <p>Last request: {details ? displayDate(details.lastRequestAt) : "Never"}</p>
        <p>Route: {details?.route ?? "No request yet"}</p>
        <p>Status code: {details?.statusCode ?? "None"}</p>
        <p>Code: {details?.code ?? "None"}</p>
        <p>Field: {details?.field ?? "None"}</p>
        <p>Message: {details?.message ?? integration?.lastVerificationError ?? "None"}</p>
        <p>Last verified: {displayDate(integration?.lastVerifiedAt)}</p>
      </div>
    </details>
  );
}

function VisibilityButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={visible ? "Hide typed value" : "Show typed value"}
      className="absolute right-3 top-3 grid h-5 w-5 place-items-center text-slate-500 transition hover:text-cyan-100"
      onClick={onClick}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

function VerificationLogCards({ integrations }: { integrations: IntegrationRecord[] }) {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {INTEGRATION_TYPES.map((type) => {
        const integration = integrations.find((item) => item.type === type);
        const catalog = INTEGRATION_CATALOG[type];
        const Icon = iconMap[catalog.icon];
        return (
          <GlassCard key={type} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <span className="grid h-10 w-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                <Icon className="h-4 w-4" />
              </span>
              <StatusBadge value={integration?.status ?? "NOT_CONNECTED"} />
            </div>
            <p className="mt-4 font-semibold text-white">{catalog.title}</p>
            <p className="mt-3 text-sm text-slate-400">Last verified: {displayDate(integration?.lastVerifiedAt)}</p>
            <p className="mt-2 text-sm text-slate-400">Last error: {integration?.lastVerificationError ?? "None"}</p>
          </GlassCard>
        );
      })}
    </div>
  );
}
