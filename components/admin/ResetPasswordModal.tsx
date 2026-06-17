"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CompanySummary } from "@/components/admin/CompanyCard";
import { NeonButton } from "@/components/shared/NeonButton";

export function ResetPasswordModal({
  company,
  onClose
}: {
  company: CompanySummary | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ loginUsername?: string; ownerEmail: string; temporaryPassword: string; warning: string } | null>(null);

  async function resetPassword() {
    if (!company) return;
    setLoading(true);
    const response = await fetch(`/api/admin/companies/${company.id}/reset-password`, { method: "POST" });
    setResult((await response.json()) as { loginUsername?: string; ownerEmail: string; temporaryPassword: string; warning: string });
    setLoading(false);
  }

  return (
    <AnimatePresence>
      {company ? (
        <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/72 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="glass-panel w-full max-w-md rounded-[30px] p-6" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 18, opacity: 0 }}>
            <h2 className="text-2xl font-semibold text-white">Reset Password</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">Generate a new temporary password for {company.name}. Active company sessions are revoked.</p>
            {result ? (
              <div className="mt-5 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 p-4 text-sm text-slate-100">
                <p>Login Username: {result.loginUsername ?? result.ownerEmail}</p>
                <p className="mt-2">Temporary password: <span className="font-semibold text-white">{result.temporaryPassword}</span></p>
                <p className="mt-2 text-amber-100">{result.warning}</p>
              </div>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <NeonButton variant="secondary" onClick={onClose}>Close</NeonButton>
              <NeonButton loading={loading} onClick={resetPassword}>Reset Password</NeonButton>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
