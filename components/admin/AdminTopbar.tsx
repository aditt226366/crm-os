"use client";

import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { NeonButton } from "@/components/shared/NeonButton";

export function AdminTopbar() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#030712]/76 backdrop-blur-2xl">
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">Admin Console</p>
          <p className="text-sm text-slate-400">Feature-gated SaaS control plane</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 sm:flex">
            <ShieldCheck className="h-4 w-4 text-cyan-200" />
            Platform Admin
          </div>
          <NeonButton variant="secondary" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Logout
          </NeonButton>
        </div>
      </div>
    </header>
  );
}
