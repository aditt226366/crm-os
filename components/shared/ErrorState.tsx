import { AlertTriangle } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";

export function ErrorState({ message }: { message: string }) {
  return (
    <GlassCard className="flex items-center gap-3 border-rose-300/20 bg-rose-300/5 p-5 text-rose-100">
      <AlertTriangle className="h-5 w-5" />
      <span className="text-sm">{message}</span>
    </GlassCard>
  );
}
