"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { FeatureKey } from "@/lib/constants";
import { DASHBOARD_NAVIGATION, getEnabledNavigation } from "@/lib/constants";
import { AppSidebar } from "@/components/app/AppSidebar";
import { AppTopbar } from "@/components/app/AppTopbar";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";

type AppFeature = {
  id: string;
  featureKey: FeatureKey;
  name: string;
  description: string;
  navLabel: string;
  route: string;
  enabled: boolean;
};

type AppUser = {
  id: string;
  name: string;
  email: string;
  username?: string;
  role: string;
  tenantId?: string | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
  } | null;
  whatsapp: {
    status: string;
    phoneNumber: string | null;
    lastSyncAt: string | null;
  };
};

type WorkspaceMeResponse = {
  ok?: boolean;
  message?: string;
  warning?: string;
  user?: Partial<AppUser> & { id?: string; role?: string; tenant?: AppUser["tenant"] };
  tenant?: AppUser["tenant"];
  features?: AppFeature[];
};

type AppNavigationItem = {
  featureKey: FeatureKey | null;
  label: string;
  href: string;
};

type AppShellContextValue = {
  user: AppUser | null;
  features: AppFeature[];
  navigation: AppNavigationItem[];
  enabledFeatureSet: Set<FeatureKey>;
  loading: boolean;
  refreshShell: () => Promise<void>;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

function workspaceUserFromResponse(data: WorkspaceMeResponse): AppUser {
  if (!data.user?.id || !data.user.role) {
    throw new Error("Workspace user missing");
  }

  const tenant = data.tenant ?? data.user.tenant ?? null;
  return {
    id: data.user.id,
    name: data.user.name ?? data.user.username ?? "Workspace user",
    email: data.user.email ?? "",
    username: data.user.username,
    role: data.user.role,
    tenantId: data.user.tenantId ?? tenant?.id ?? null,
    tenant,
    whatsapp: data.user.whatsapp ?? {
      status: "NOT_CONNECTED",
      phoneNumber: null,
      lastSyncAt: null
    }
  };
}

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error("useAppShell must be used inside AppLayout");
  }
  return context;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [features, setFeatures] = useState<AppFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceWarning, setWorkspaceWarning] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const loadShellData = useCallback(async () => {
    const response = await fetch("/api/app/me", {
      credentials: "include",
      cache: "no-store"
    });
    const data = (await response.json().catch(() => null)) as WorkspaceMeResponse | null;

    if (response.status === 401) {
      window.location.href = "/login";
      return null;
    }
    if (!response.ok) {
      throw new Error(data?.message ?? "Workspace access is blocked. Contact platform admin.");
    }
    if (!data) {
      throw new Error("Could not verify session. Please refresh.");
    }

    return {
      user: workspaceUserFromResponse(data),
      features: data.features ?? [],
      warning: data.warning ?? null
    };
  }, []);

  const refreshShell = useCallback(async () => {
    setError(null);
    setWorkspaceWarning(null);
    const shell = await loadShellData();
    if (!shell) return;
    setUser(shell.user);
    setFeatures(shell.features);
    setWorkspaceWarning(shell.warning);
  }, [loadShellData]);

  useEffect(() => {
    let active = true;
    async function loadShell() {
      setError(null);
      setWorkspaceWarning(null);
      const shell = await loadShellData();
      if (!active) return;
      if (!shell) return;
      setUser(shell.user);
      setFeatures(shell.features);
      setWorkspaceWarning(shell.warning);
    }

    loadShell()
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not verify session. Please refresh.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadShellData]);

  const enabledFeatureSet = useMemo(
    () => new Set(features.filter((feature) => feature.enabled).map((feature) => feature.featureKey)),
    [features]
  );

  const navigation = useMemo(() => {
    const enabledNavigation = getEnabledNavigation(features).map((item) => ({
      ...item,
      featureKey: item.featureKey as FeatureKey
    }));
    const ordered: readonly FeatureKey[] = [
      "INBOX",
      "BULK_MESSAGING",
      "CAMPAIGNS",
      "ADS",
      "AI_WORKFLOW_BUILDER",
      "LEAD_MANAGEMENT"
    ];
    enabledNavigation.sort((a, b) => ordered.indexOf(a.featureKey) - ordered.indexOf(b.featureKey));
    return [DASHBOARD_NAVIGATION, ...enabledNavigation] satisfies AppNavigationItem[];
  }, [features]);

  const value = useMemo(
    () => ({
      user,
      features,
      navigation,
      enabledFeatureSet,
      loading,
      refreshShell
    }),
    [enabledFeatureSet, features, loading, navigation, refreshShell, user]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-[#030712] p-6 text-white">
        <LoadingSkeleton rows={10} />
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[#030712] p-6 text-white">
        <div className="mx-auto mt-24 max-w-xl rounded-2xl border border-rose-300/20 bg-rose-300/10 p-5 text-rose-100">
          <p className="text-sm font-semibold">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <AppShellContext.Provider value={value}>
      <div className="min-h-screen bg-[#030712] text-white">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(34,211,238,0.14),transparent_28rem),radial-gradient(circle_at_86%_16%,rgba(37,99,235,0.12),transparent_30rem),radial-gradient(circle_at_70%_86%,rgba(14,165,233,0.08),transparent_26rem)]" />
        <div className="grid-mask pointer-events-none fixed inset-0 opacity-50" />
        <div className="relative z-10 flex min-h-screen">
          <AppSidebar
            collapsed={collapsed}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
            onToggleCollapsed={() => setCollapsed((current) => !current)}
          />
          <div className="min-w-0 flex-1">
            <AppTopbar onOpenMobileSidebar={() => setMobileOpen(true)} />
            {workspaceWarning ? (
              <div className="border-b border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm text-amber-100 sm:px-6">
                {workspaceWarning}
              </div>
            ) : null}
            <motion.main
              key="app-main"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="px-4 py-5 sm:px-6 lg:px-8"
            >
              {children}
            </motion.main>
          </div>
        </div>
      </div>
    </AppShellContext.Provider>
  );
}
