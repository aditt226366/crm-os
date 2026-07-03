"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  ContactRound,
  FileText,
  Home,
  Inbox,
  Megaphone,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RadioTower,
  Settings,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppShell } from "@/components/app/AppLayout";

const iconMap: Record<string, LucideIcon> = {
  Dashboard: Home,
  Inbox,
  Broadcasts: RadioTower,
  Campaigns: Megaphone,
  Ads: Target,
  "AI Workflow Builder": BrainCircuit,
  "Lead Management": BarChart3,
  Orders: ShoppingBag,
  "Human Queue": Users,
  Contacts: ContactRound,
  Templates: FileText,
  "Knowledge Base": Bot,
  Settings
};

function NavLinks({
  collapsed,
  onNavigate
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { navigation } = useAppShell();

  return (
    <nav className="space-y-1.5">
      {navigation.map((item) => {
        const Icon = iconMap[item.label] ?? Sparkles;
        const active = pathname === item.href || (item.href !== "/app/dashboard" && pathname.startsWith(item.href));
        return (
          <Link
            key={`${item.featureKey ?? "dashboard"}-${item.href}`}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={cn(
              "group flex min-h-11 items-center gap-3 rounded-2xl border px-3 text-sm font-medium transition duration-300",
              collapsed ? "justify-center" : "justify-start",
              active
                ? "border-cyan-300/35 bg-cyan-300/[0.12] text-white shadow-glow"
                : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.055] hover:text-white"
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", active ? "text-cyan-100" : "text-slate-500 group-hover:text-cyan-100")} />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppSidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleCollapsed
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleCollapsed: () => void;
}) {
  const { user } = useAppShell();

  return (
    <>
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-white/10 bg-slate-950/72 p-4 backdrop-blur-2xl transition-all duration-300 lg:block",
          collapsed ? "w-[92px]" : "w-72"
        )}
      >
        <div className={cn("mb-5 flex items-center gap-3", collapsed ? "justify-center" : "justify-between")}>
          <Link href="/app/dashboard" className={cn("flex min-w-0 items-center gap-3", collapsed ? "justify-center" : "")}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 shadow-glow">
              <MessageCircle className="h-5 w-5 text-cyan-100" />
            </span>
            {!collapsed ? (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">CRM OS</span>
                <span className="block truncate text-xs text-cyan-100/70">{user?.tenant?.name ?? "Company"}</span>
              </span>
            ) : null}
          </Link>
          {!collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/40 hover:text-white"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="mb-4 grid h-9 w-full place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/40 hover:text-white"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        ) : (
          <div className="mb-5 rounded-[22px] border border-cyan-300/15 bg-cyan-300/[0.08] p-3">
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-100/70">Company Panel</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{user?.tenant?.name ?? "Company Workspace"}</p>
          </div>
        )}

        <NavLinks collapsed={collapsed} />
      </aside>

      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition lg:hidden",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onCloseMobile}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[min(22rem,calc(100vw-2rem))] border-r border-white/10 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-2xl transition-transform duration-300 lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 shadow-glow">
              <MessageCircle className="h-5 w-5 text-cyan-100" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">CRM OS</p>
              <p className="text-xs text-cyan-100/70">{user?.tenant?.name ?? "Company"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <NavLinks collapsed={false} onNavigate={onCloseMobile} />
        <div className="mt-5 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-400">
          <span>Swipe-ready navigation</span>
          <ChevronLeft className="h-4 w-4 text-cyan-100" />
          <ChevronRight className="h-4 w-4 text-cyan-100" />
        </div>
      </aside>
    </>
  );
}
