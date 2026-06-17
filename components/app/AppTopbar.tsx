"use client";

import { useRouter } from "next/navigation";
import { Bell, LogOut, Menu, Plus, Search, ShieldCheck } from "lucide-react";
import { NeonButton } from "@/components/shared/NeonButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CompanySwitcherPlaceholder } from "@/components/app/CompanySwitcherPlaceholder";
import { UsageBadge } from "@/components/app/UsageBadge";
import { useAppShell } from "@/components/app/AppLayout";

export function AppTopbar({ onOpenMobileSidebar }: { onOpenMobileSidebar: () => void }) {
  const router = useRouter();
  const { user, enabledFeatureSet } = useAppShell();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#030712]/78 backdrop-blur-2xl">
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          <CompanySwitcherPlaceholder />
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm font-semibold text-white">{user?.tenant?.name ?? "Company"} CRM Command Center</p>
            <p className="truncate text-xs text-slate-500">{user?.name ?? "Workspace user"} | {user?.role?.replaceAll("_", " ")}</p>
          </div>
        </div>

        <div className="hidden min-w-[18rem] max-w-md flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-400 xl:flex">
          <Search className="h-4 w-4 text-cyan-100/70" />
          <span className="truncate">Search contacts, campaigns, orders, templates...</span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden sm:block">
            <StatusBadge value={user?.whatsapp.status === "CONNECTED" ? "WhatsApp connected" : "WhatsApp not connected"} />
          </div>
          <UsageBadge />
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/40 hover:text-white"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>
          {enabledFeatureSet.has("BULK_MESSAGING") ? (
            <NeonButton size="sm" onClick={() => router.push("/app/broadcasts")}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Broadcast</span>
            </NeonButton>
          ) : null}
          <button
            type="button"
            className="hidden h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-200 sm:inline-flex"
            title="Tenant-secured session"
          >
            <ShieldCheck className="h-4 w-4 text-cyan-100" />
            Secure
          </button>
          <NeonButton variant="secondary" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </NeonButton>
        </div>
      </div>
    </header>
  );
}
