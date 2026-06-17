"use client";

import { FormEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NeonButton } from "@/components/shared/NeonButton";

type SuccessPayload = {
  company: { id: string; name: string; slug: string };
  loginUsername: string;
  temporaryPassword: string;
  loginUrl: string;
  warning: string;
};

export function CreateCompanyModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<SuccessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = (await response.json()) as SuccessPayload & { error?: { message?: string } };
    setLoading(false);
    if (!response.ok) {
      setError(data.error?.message ?? "Could not create company");
      return;
    }
    setSuccess(data);
    onCreated();
  }

  function close() {
    setSuccess(null);
    setError(null);
    onClose();
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/72 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="mx-auto flex min-h-full max-w-2xl items-center">
            <motion.div className="glass-panel w-full rounded-[30px] p-6" initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 22, opacity: 0 }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Create Company</h2>
                  <p className="mt-2 text-sm text-slate-400">Create a tenant, owner user, default features, and integration shells.</p>
                </div>
                <button onClick={close} className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300">Close</button>
              </div>

              {success ? (
                <div className="mt-6 rounded-[24px] border border-cyan-300/30 bg-cyan-300/10 p-5">
                  <p className="text-lg font-semibold text-white">{success.company.name} is ready</p>
                  <div className="mt-4 space-y-2 text-sm text-slate-200">
                    <p>Login URL: <span className="text-cyan-100">{success.loginUrl}</span></p>
                    <p>Login Username: <span className="font-semibold text-white">{success.loginUsername}</span></p>
                    <p>Temporary password: <span className="font-semibold text-white">{success.temporaryPassword}</span></p>
                    <p className="text-amber-100">{success.warning}</p>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} className="mt-6 grid gap-3 sm:grid-cols-2">
                  {[
                    ["companyName", "Company Name"],
                    ["slug", "Company Slug"],
                    ["ownerName", "Owner Name"],
                    ["loginUsername", "Login Username"],
                    ["temporaryPassword", "Temporary Password"],
                    ["phoneNumber", "Phone Number optional"]
                  ].map(([name, label]) => (
                    <input
                      key={name}
                      name={name}
                      placeholder={label}
                      className="h-12 rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/50"
                    />
                  ))}
                  <select name="plan" defaultValue="STARTER" className="h-12 rounded-2xl border border-white/10 bg-slate-950 px-4 text-sm text-white outline-none">
                    <option value="STARTER">Starter</option>
                    <option value="PRO">Pro</option>
                    <option value="ENTERPRISE">Enterprise</option>
                  </select>
                  <select name="status" defaultValue="ACTIVE" className="h-12 rounded-2xl border border-white/10 bg-slate-950 px-4 text-sm text-white outline-none">
                    <option value="ACTIVE">Active</option>
                    <option value="DEACTIVATED">Deactivated</option>
                  </select>
                  {error ? <p className="sm:col-span-2 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
                  <NeonButton loading={loading} className="sm:col-span-2">Create Company</NeonButton>
                </form>
              )}
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
