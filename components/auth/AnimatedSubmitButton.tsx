"use client";

import { ArrowRight } from "lucide-react";
import { NeonButton } from "@/components/shared/NeonButton";

export function AnimatedSubmitButton({
  loading,
  children
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <NeonButton loading={loading} className="mt-5 h-12 w-full">
      {children}
      {!loading ? <ArrowRight className="h-4 w-4" /> : null}
    </NeonButton>
  );
}
