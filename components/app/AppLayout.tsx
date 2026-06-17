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
  role: string;
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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refreshShell = useCallback(async () => {
    const [meResponse, featureResponse] = await Promise.all([fetch("/api/app/me"), fetch("/api/app/features")]);
    if (!meResponse.ok || !featureResponse.ok) {
      window.location.href = "/login";
      return;
    }
    const meData = (await meResponse.json()) as { user: AppUser };
    const featureData = (await featureResponse.json()) as { features: AppFeature[] };
    setUser(meData.user);
    setFeatures(featureData.features ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/app/me"), fetch("/api/app/features")])
      .then(async ([meResponse, featureResponse]) => {
        if (!meResponse.ok || !featureResponse.ok) {
          window.location.href = "/login";
          return;
        }
        const meData = (await meResponse.json()) as { user: AppUser };
        const featureData = (await featureResponse.json()) as { features: AppFeature[] };
        if (!active) return;
        setUser(meData.user);
        setFeatures(featureData.features ?? []);
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
