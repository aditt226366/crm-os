"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  FileText,
  PlugZap,
  Settings,
  SlidersHorizontal
} from "lucide-react";
import { cn } from "@/lib/utils";

export const ADMIN_NAV_LINKS = [
  { label: "Overview", href: "/admin", icon: Activity },
  { label: "Companies", href: "/admin/companies", icon: Building2 },
  { label: "Features", href: "/admin/features", icon: SlidersHorizontal },
  { label: "Integrations", href: "/admin/integrations", icon: PlugZap },
  { label: "Audit Logs", href: "/admin/audit-logs", icon: FileText },
  { label: "Settings", href: "/admin/settings", icon: Settings }
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-slate-950/72 p-4 backdrop-blur-2xl lg:block">
      <div className="mb-8 rounded-[24px] border border-cyan-300/20 bg-cyan-300/10 p-4 shadow-glow">
        <p className="text-sm font-semibold text-white">Platform Administration</p>
        <p className="mt-1 text-xs leading-5 text-cyan-100/80">Companies, access, features, and integrations.</p>
      </div>
      <nav className="space-y-2">
        {ADMIN_NAV_LINKS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-slate-300 transition",
                active
                  ? "border border-cyan-300/30 bg-cyan-300/10 text-white shadow-glow"
                  : "hover:bg-white/[0.05] hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function AdminMobileNav() {
  const pathname = usePathname();
  return (
    <div className="border-b border-white/10 bg-slate-950/72 px-4 py-3 backdrop-blur-2xl lg:hidden">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ADMIN_NAV_LINKS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition",
                active
                  ? "border-cyan-300/30 bg-cyan-300/10 text-white shadow-glow"
                  : "border-white/10 bg-white/[0.04] text-slate-300"
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
