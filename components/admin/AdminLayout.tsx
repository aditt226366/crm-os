"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AdminMobileNav, AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopbar } from "@/components/admin/AdminTopbar";
import { AdminThemeProvider, useAdminTheme } from "@/components/admin/AdminTheme";

export function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminThemeProvider>
      <AdminShell>{children}</AdminShell>
    </AdminThemeProvider>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const { theme } = useAdminTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className={cn("admin-shell min-h-screen", theme === "light" ? "admin-light" : "admin-dark")}>
      <div className="admin-glow pointer-events-none fixed inset-0" />
      <div className="relative z-10 flex min-h-screen">
        <AdminSidebar open={sidebarOpen} />
        <div className="min-w-0 flex-1">
          <AdminTopbar onToggleSidebar={() => setSidebarOpen((value) => !value)} />
          <AdminMobileNav />
          <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
