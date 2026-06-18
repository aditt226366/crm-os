"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { FeatureKey } from "@/lib/constants";
import { DASHBOARD_NAVIGATION, FEATURE_DEFINITIONS, getEnabledNavigation } from "@/lib/constants";
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

type AuthMeUser = {
  id: string;
  name?: string;
  email?: string;
  username?: string;
  role: string;
  tenantId?: string | null;
  tenant?: AppUser["tenant"];
};

type WorkspaceMeResponse = {
  ok?: boolean;
  warning?: string;
  user?: Partial<AppUser> & { tenant?: AppUser["tenant"] };
  tenant?: AppUser["tenant"];
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

function fallbackTenant(authUser: AuthMeUser): NonNullable<AppUser["tenant"]> {
  return {
    id: authUser.tenant?.id ?? authUser.tenantId ?? "workspace",
    name: authUser.tenant?.name ?? "Printwear",
    slug: authUser.tenant?.slug ?? "workspace",
    plan: authUser.tenant?.plan ?? "STARTER",
    status: authUser.tenant?.status ?? "ACTIVE"
  };
}

function fallbackUser(authUser: AuthMeUser): AppUser {
  return {
    id: authUser.id,
    name: authUser.name ?? authUser.username ?? "Workspace user",
    email: authUser.email ?? "",
    username: authUser.username,
    role: authUser.role,
    tenantId: authUser.tenantId ?? authUser.tenant?.id ?? null,
    tenant: fallbackTenant(authUser),
    whatsapp: {
      status: "NOT_CONNECTED",
      phoneNumber: null,
      lastSyncAt: null
    }
  };
}

function workspaceUserFromResponse(data: WorkspaceMeResponse, authUser: AuthMeUser): AppUser {
  const base = fallbackUser(authUser);
  const tenant = data.tenant ?? data.user?.tenant ?? base.tenant;
  return {
    ...base,
    ...data.user,
    tenant,
    whatsapp: data.user?.whatsapp ?? base.whatsapp
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

  const refreshShell = useCallback(async () => {
    setError(null);
    setWorkspaceWarning(null);
    const authResponse = await fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store"
    });

    if (authResponse.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!authResponse.ok) {
      setError("Could not verify session. Please refresh.");
      return;
    }
    const authData = (await authResponse.json()) as { user?: AuthMeUser };
    if (!authData.user) {
      setError("Could not verify session. Please refresh.");
      return;
    }

    const [meResponse, featureResponse] = await Promise.all([
      fetch("/api/app/me", { credentials: "include", cache: "no-store" }),
      fetch("/api/app/features", { credentials: "include", cache: "no-store" })
    ]);

    if (meResponse.status === 401 || featureResponse.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (featureResponse.status === 403) {
      setError("Workspace access is blocked. Contact platform admin.");
      return;
    }

    let nextUser = fallbackUser(authData.user);
    if (meResponse.ok) {
      const meData = (await meResponse.json()) as WorkspaceMeResponse;
      nextUser = workspaceUserFromResponse(meData, authData.user);
      setWorkspaceWarning(meData.warning ?? null);
    } else {
      setWorkspaceWarning("Workspace details could not fully load.");
    }

    const featureData = featureResponse.ok
      ? ((await featureResponse.json()) as { features: AppFeature[] })
      : { features: [] };
    if (!featureResponse.ok) {
      setWorkspaceWarning("Workspace details could not fully load.");
    }
    setUser(nextUser);
    setFeatures(featureData.features ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadShell() {
      setError(null);
      setWorkspaceWarning(null);
      const authResponse = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store"
      });

      if (authResponse.status === 401) {
        if (active) {
          window.location.href = "/login";
        }
        return;
      }
      if (!authResponse.ok) {
        if (active) setError("Could not verify session. Please refresh.");
        return;
      }

      const authData = (await authResponse.json()) as { user?: AuthMeUser };
      if (authData.user?.role === "PLATFORM_ADMIN") {
        if (active) {
          window.location.href = "/admin";
        }
        return;
      }
      if (!authData.user) {
        if (active) setError("Could not verify session. Please refresh.");
        return;
      }

      const [meResponse, featureResponse] = await Promise.all([
        fetch("/api/app/me", { credentials: "include", cache: "no-store" }),
        fetch("/api/app/features", { credentials: "include", cache: "no-store" })
      ]);

      if (meResponse.status === 401 || featureResponse.status === 401) {
        if (active) window.location.href = "/login";
        return;
      }
      if (featureResponse.status === 403) {
        if (active) setError("Workspace access is blocked. Contact platform admin.");
        return;
      }

      let nextUser = fallbackUser(authData.user);
      if (meResponse.ok) {
        const meData = (await meResponse.json()) as WorkspaceMeResponse;
        nextUser = workspaceUserFromResponse(meData, authData.user);
        if (active) setWorkspaceWarning(meData.warning ?? null);
      } else if (active) {
        setWorkspaceWarning("Workspace details could not fully load.");
      }

      const featureData = featureResponse.ok
        ? ((await featureResponse.json()) as { features: AppFeature[] })
        : { features: [] };
      if (!featureResponse.ok && active) {
        setWorkspaceWarning("Workspace details could not fully load.");
      }

      if (!active) return;
      setUser(nextUser);
      setFeatures(featureData.features ?? []);
    }

    loadShell()
      .catch(() => {
        if (active) setError("Could not verify session. Please refresh.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const enabledFeatureSet = useMemo(
    () => new Set(features.filter((feature) => feature.enabled).map((feature) => feature.featureKey)),
    [features]
  );

  const navigation = useMemo(() => {
    const enabledNavigation = getEnabledNavigation(features).map((item) => ({
      ...item,
      featureKey: item.featureKey as FeatureKey
    }));
    const ordered = [
      "INBOX",
      "BULK_MESSAGING",
      "CAMPAIGNS",
      "ADS",
      "AI_WORKFLOW_BUILDER",
      "LEAD_MANAGEMENT",
      "ORDERS",
      "HUMAN_TAKEOVER",
      "CONTACTS",
      "TEMPLATES",
      "KNOWLEDGE_BASE",
      "SETTINGS"
    ] as FeatureKey[];
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

export { FEATURE_DEFINITIONS };
