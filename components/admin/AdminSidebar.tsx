"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  ChevronDown,
  FileText,
  ScrollText,
  Settings,
  ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WaMark } from "@/components/site/WaMark";

type NavLink = { label: string; href: string; icon: typeof Activity };

const PRIMARY_LINKS: NavLink[] = [
  { label: "Overview", href: "/admin", icon: Activity },
  { label: "Companies", href: "/admin/companies", icon: Building2 }
];

const LOG_LINKS: NavLink[] = [
  { label: "Audit Logs", href: "/admin/audit-logs", icon: FileText },
  { label: "Admin Logs", href: "/admin/admin-logs", icon: ShieldAlert }
];

const SETTINGS_LINK: NavLink = { label: "Settings", href: "/admin/settings", icon: Settings };

/** Flat list used by the mobile navigation. */
export const ADMIN_NAV_LINKS: NavLink[] = [...PRIMARY_LINKS, ...LOG_LINKS, SETTINGS_LINK];

function itemClass(active: boolean) {
  return cn(
    "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition",
    active ? "bg-cyan-300/10 text-white" : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
  );
}

export function AdminSidebar({ open = true }: { open?: boolean }) {
  const pathname = usePathname();
  const onLogsRoute = LOG_LINKS.some((link) => pathname === link.href);
  const [logsOpen, setLogsOpen] = useState(onLogsRoute);

  return (
    <aside
      className={cn(
        "hidden w-64 shrink-0 flex-col border-r border-white/10 bg-slate-950/72 p-4",
        open ? "lg:flex" : "lg:hidden"
      )}
    >
      <Link href="/admin" className="mb-6 flex items-center gap-2.5 px-1.5">
        <WaMark className="h-8 w-8" />
        <p className="text-sm font-semibold tracking-tight text-white">WhatsApp-OS</p>
      </Link>

      <nav className="space-y-1">
        {PRIMARY_LINKS.map(({ label, href, icon: Icon }) => (
          <Link key={href} href={href} className={itemClass(pathname === href)}>
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}

        {/* Logs group */}
        <div>
          <button
            type="button"
            onClick={() => setLogsOpen((value) => !value)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition",
              onLogsRoute ? "text-white" : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
            )}
            aria-expanded={logsOpen}
          >
            <ScrollText className="h-4 w-4" />
            Logs
            <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", logsOpen && "rotate-180")} />
          </button>
          {logsOpen ? (
            <div className="mt-1 space-y-1 pl-3.5">
              {LOG_LINKS.map(({ label, href, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border-l border-white/10 px-3.5 py-2 text-sm transition",
                      active ? "border-cyan-300/40 bg-cyan-300/10 text-white" : "text-slate-400 hover:text-white"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

        <Link href={SETTINGS_LINK.href} className={itemClass(pathname === SETTINGS_LINK.href)}>
          <Settings className="h-4 w-4" />
          {SETTINGS_LINK.label}
        </Link>
      </nav>
    </aside>
  );
}

export function AdminMobileNav() {
  const pathname = usePathname();
  return (
    <div className="border-b border-white/10 bg-slate-950/72 px-4 py-3 lg:hidden">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ADMIN_NAV_LINKS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition",
                active ? "border-cyan-300/30 bg-cyan-300/10 text-white" : "border-white/10 bg-white/[0.04] text-slate-300"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
