"use client";

import { useRouter } from "next/navigation";
import { LogOut, PanelLeft } from "lucide-react";
import { NeonButton } from "@/components/shared/NeonButton";
import { AdminThemeToggle } from "@/components/admin/AdminTheme";

export function AdminTopbar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/72 backdrop-blur-xl">
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Show or hide the sidebar"
            className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:text-white"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold tracking-tight text-white">Admin Console</p>
        </div>
        <div className="flex items-center gap-2.5">
          <AdminThemeToggle />
          <NeonButton variant="secondary" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Logout
          </NeonButton>
        </div>
      </div>
    </header>
  );
}
