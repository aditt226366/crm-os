import { Sparkles } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";

export function EmptyState({ title, text, description }: { title: string; text?: string; description?: string }) {
  return (
    <GlassCard className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <Sparkles className="mb-4 h-7 w-7 text-cyan-200" />
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">{description ?? text}</p>
    </GlassCard>
  );
}
