"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { NeonButton } from "@/components/shared/NeonButton";

export function AdminTopbar() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/72 backdrop-blur-xl">
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold tracking-tight text-white">Admin Console</p>
        </div>
        <div className="flex items-center gap-2.5">
          <NeonButton variant="secondary" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Logout
          </NeonButton>
        </div>
      </div>
    </header>
  );
}
