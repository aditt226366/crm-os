"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Building2, LogOut, Menu, Plus, Search, Sparkles } from "lucide-react";
import { useAppShell } from "@/components/app/AppLayout";

export function AppTopbar({ onOpenMobileSidebar }: { onOpenMobileSidebar: () => void }) {
  const router = useRouter();
  const { user, navigation, enabledFeatureSet } = useAppShell();
  const whatsappConnected = user?.whatsapp.status === "CONNECTED";
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);

  const searchActions = useMemo(() => {
    const query = searchQuery.trim();
    const encodedQuery = encodeURIComponent(query);
    const searchableRoutes = [
      enabledFeatureSet.has("LEAD_MANAGEMENT")
        ? {
            label: query ? `Search leads for "${query}"` : "Open Lead Management",
            href: query ? `/app/leads?search=${encodedQuery}` : "/app/leads",
            route: "/app/leads",
            keywords: "lead leads contact contacts phone"
          }
        : null,
      enabledFeatureSet.has("INBOX")
        ? {
            label: query ? `Search chats for "${query}"` : "Open Inbox",
            href: query ? `/app/inbox?search=${encodedQuery}` : "/app/inbox",
            route: "/app/inbox",
            keywords: "chat chats inbox conversation conversations whatsapp"
          }
        : null,
      enabledFeatureSet.has("CAMPAIGNS")
        ? {
            label: query ? `Search campaigns for "${query}"` : "Open Campaigns",
            href: query ? `/app/campaigns?search=${encodedQuery}` : "/app/campaigns",
            route: "/app/campaigns",
            keywords: "campaign campaigns broadcast broadcasts template"
          }
        : null
    ].filter((item): item is { label: string; href: string; route: string; keywords: string } => Boolean(item));
    const searchableRouteSet = new Set(searchableRoutes.map((item) => item.route));
    const moduleRoutes = navigation
      .filter((item) => item.href !== "/app/dashboard" && !searchableRouteSet.has(item.href))
      .map((item) => ({
        label: `Open ${item.label}`,
        href: item.href,
        keywords: `${item.label} ${item.featureKey ?? ""}`
      }));
    const allActions = [...searchableRoutes, ...moduleRoutes];

    if (!query) {
      return allActions.slice(0, 6);
    }

    const needle = query.toLowerCase();
    const exactSearchActions = searchableRoutes.filter((item) =>
      `${item.label} ${item.keywords}`.toLowerCase().includes(needle)
    );
    const matchingModuleActions = moduleRoutes.filter((item) =>
      `${item.label} ${item.keywords}`.toLowerCase().includes(needle)
    );
    const mergedActions = [...exactSearchActions, ...matchingModuleActions];
    return (mergedActions.length ? mergedActions : searchableRoutes).slice(0, 6);
  }, [enabledFeatureSet, navigation, searchQuery]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  function openSearchAction(href: string) {
    setSearchOpen(false);
    router.push(href);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstAction = searchActions[0];
    if (firstAction) {
      openSearchAction(firstAction.href);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        searchRef.current?.querySelector("input")?.focus();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (!searchRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

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

        <div ref={searchRef} className="relative hidden min-w-[18rem] max-w-lg flex-[1.2] xl:block">
          <form
            onSubmit={submitSearch}
            className="flex items-center gap-3 rounded-[24px] border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-400 shadow-inner shadow-black/20 transition focus-within:border-cyan-200/40 focus-within:bg-slate-950/78"
          >
            <Search className="h-4 w-4 shrink-0 text-cyan-100/80" />
            <input
              value={searchQuery}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              placeholder="Search leads, chats, campaigns..."
              className="min-w-0 flex-1 bg-transparent text-slate-100 outline-none placeholder:text-slate-500"
            />
            <span className="ml-auto rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Ctrl K
            </span>
          </form>
          {searchOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-[22px] border border-cyan-200/18 bg-slate-950/96 p-2 shadow-[0_24px_70px_rgba(2,8,23,0.58)] backdrop-blur-2xl">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Search workspace
              </div>
              <div className="space-y-1">
                {searchActions.map((action) => (
                  <button
                    key={`${action.label}-${action.href}`}
                    type="button"
                    onClick={() => openSearchAction(action.href)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-cyan-300/10 hover:text-white"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-cyan-200/15 bg-cyan-200/[0.08] text-cyan-100">
                      <Search className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-white/10 px-3 py-2 text-xs text-slate-500">
                Press Enter to open the first result.
              </div>
            </div>
          ) : null}
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
