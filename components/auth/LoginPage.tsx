"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, MessageCircle, ShieldCheck } from "lucide-react";
import { AuthOrbBackground } from "@/components/visuals/AuthOrbBackground";
import { LoginForm } from "@/components/auth/LoginForm";

export function LoginPage() {
  const router = useRouter();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030712] px-4 py-6 text-white sm:px-6 lg:px-8">
      <AuthOrbBackground />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 shadow-glow">
              <MessageCircle className="h-4 w-4 text-cyan-100" />
            </span>
            <span className="font-semibold">CRM OS</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-300/40 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </header>

        <section className="flex flex-1 items-center justify-center py-16">
          <div className="w-full max-w-lg">
            <div className="mb-8 text-center">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/80">
              Secure access
            </p>
            <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl">
              Sign in to CRM OS
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-8 text-slate-300 sm:text-lg">
              One secure login for platform admins, company owners, and company agents.
            </p>
            </div>

            <motion.div
              className="glass-panel rounded-[30px] p-6 shadow-glow-strong"
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.21, 1, 0.21, 1] }}
            >
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100 shadow-glow">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-2xl font-semibold text-white">Sign in to CRM OS</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Use your username and password to open the right workspace automatically.
                  </p>
                </div>
              </div>
              <LoginForm onSuccess={(redirectTo) => router.push(redirectTo)} />
            </motion.div>
          </div>
        </section>
      </div>
    </main>
  );
}
