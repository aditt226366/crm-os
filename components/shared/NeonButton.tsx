"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function NeonButton({
  loading,
  children,
  className,
  disabled,
  ...props
}: ButtonProps & { loading?: boolean }) {
  return (
    <Button
      className={cn("relative overflow-hidden", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  );
}
