import * as React from "react";
import { cn } from "@/lib/utils";

export function GlassCard({
  className,
  children
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("glass-panel rounded-[24px]", className)}>{children}</div>;
}
