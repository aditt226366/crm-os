"use client";

import { ArrowRight, Loader2 } from "lucide-react";

export function AnimatedSubmitButton({
  loading,
  children
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-wa-green text-sm font-semibold text-[#04140b] transition hover:bg-wa-greenDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-green/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
      {!loading ? <ArrowRight className="h-4 w-4" /> : null}
    </button>
  );
}
