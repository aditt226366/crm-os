"use client";

import { useRouter } from "next/navigation";
import { Bell, Building2, LogOut, Menu, Plus, Search, Sparkles } from "lucide-react";
import { useAppShell } from "@/components/app/AppLayout";

export function AppTopbar({ onOpenMobileSidebar }: { onOpenMobileSidebar: () => void }) {
  const router = useRouter();
  const { user, enabledFeatureSet } = useAppShell();
  const whatsappConnected = user?.whatsapp.status === "CONNECTED";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#030712]/82 backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-300/0 via-cyan-200/70 to-emerald-300/0" />
      <div className="flex min-h-[78px] items-center gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.07] text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.12)] transition hover:border-cyan-200/35 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>

          <div className="flex min-w-0 items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.055] px-3 py-2 shadow-[0_18px_45px_rgba(2,8,23,0.28)]">
            <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.12] text-cyan-100">
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border border-slate-950 bg-emerald-300" />
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-semibold text-white">{user?.tenant?.name ?? "Company"}</p>
                <span className="hidden rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-100 sm:inline-flex">
                  {user?.tenant?.plan ?? "Plan"}
                </span>
              </div>
              <p className="truncate text-xs text-slate-400">{user?.name ?? "Workspace user"} / {user?.role?.replaceAll("_", " ")}</p>
            </div>
          </div>
        </div>

        <div className="hidden min-w-[18rem] max-w-lg flex-[1.2] items-center gap-3 rounded-[24px] border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-400 shadow-inner shadow-black/20 xl:flex">
          <Search className="h-4 w-4 shrink-0 text-cyan-100/80" />
          <span className="truncate">Search leads, chats, campaigns...</span>
          <span className="ml-auto rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Ctrl K
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className={`hidden items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold sm:flex ${
              whatsappConnected
                ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                : "border-amber-300/20 bg-amber-300/10 text-amber-100"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${whatsappConnected ? "bg-emerald-300" : "bg-amber-300"}`} />
            <span>{whatsappConnected ? "WhatsApp live" : "Connect WhatsApp"}</span>
          </div>
          {enabledFeatureSet.has("BULK_MESSAGING") ? (
            <button
              type="button"
              onClick={() => router.push("/app/broadcasts")}
              className="hidden h-11 items-center gap-2 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.13] px-4 text-sm font-semibold text-cyan-50 shadow-[0_0_28px_rgba(34,211,238,0.13)] transition hover:border-cyan-100/50 hover:bg-cyan-200/[0.18] md:inline-flex"
            >
              <Plus className="h-4 w-4" />
              Broadcast
            </button>
          ) : null}
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.055] text-slate-300 transition hover:border-cyan-200/35 hover:text-white"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="hidden h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.055] px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-200/35 hover:text-white lg:inline-flex"
            title="Workspace intelligence"
          >
            <Sparkles className="h-4 w-4 text-cyan-100" />
            Active
          </button>
          <button
            type="button"
            onClick={logout}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.055] text-slate-300 transition hover:border-rose-200/30 hover:text-rose-100"
            aria-label="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
