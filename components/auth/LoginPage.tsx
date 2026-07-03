"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth/LoginForm";
import { WaMark } from "@/components/site/WaMark";
import { ThemeProvider, ThemeToggle } from "@/components/site/theme";

export function LoginPage() {
  return (
    <ThemeProvider>
    <main className="theme-light relative min-h-screen w-full overflow-hidden bg-white text-neutral-900">
      <div className="wa-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      <ThemeToggle />
      <div className="relative z-10 flex min-h-screen w-full flex-col">
        <header className="flex h-16 items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <WaMark className="h-8 w-8" />
            <span className="text-[15px] font-semibold tracking-tight text-neutral-900">WhatsApp-OS</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </header>

        <section className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-wa-accent">Secure access</p>
              <h1 className="mt-3 text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">Sign in to WhatsApp-OS</h1>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-neutral-600">
                One secure login for platform admins, company owners, and company agents.
              </p>
            </div>

            <motion.div
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.21, 1, 0.21, 1] }}
            >
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-wa-green/20 bg-wa-green/10 text-wa-accent">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-medium text-neutral-900">Welcome back</h2>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">
                    Use your credentials to open the right workspace automatically.
                  </p>
                </div>
              </div>
              <LoginForm
                onSuccess={(redirectTo) => {
                  window.location.href = redirectTo;
                }}
              />
            </motion.div>

            <p className="mt-6 text-center text-sm text-neutral-500">
              Don&apos;t have an account?{" "}
              <Link href="/request-demo" className="font-medium text-wa-accent hover:underline">
                Request a demo
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
    </ThemeProvider>
  );
}
