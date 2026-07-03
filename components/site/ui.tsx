"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Centered container: constrains content to a comfortable reading width. */
export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-5 sm:px-8", className)}>{children}</div>;
}

export function Section({
  id,
  className,
  children
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("w-full", className)}>
      <Container className="py-20 sm:py-28">{children}</Container>
    </section>
  );
}

export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-full bg-wa-green px-6 py-3 text-sm font-semibold text-[#04140b] transition hover:bg-wa-greenDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-green/50 focus-visible:ring-offset-2";

export const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-6 py-3 text-sm font-semibold text-neutral-800 transition hover:border-neutral-400 hover:bg-neutral-50";

export const cardClass = "rounded-2xl border border-neutral-200 bg-white shadow-sm";

export function FadeIn({
  children,
  className,
  delay = 0
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: 0.55, ease: [0.21, 1, 0.21, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-wa-accent">
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  text,
  align = "center",
  as = "h2"
}: {
  eyebrow?: string;
  title: string;
  text?: string;
  align?: "center" | "left";
  as?: "h1" | "h2";
}) {
  const Title = as;
  return (
    <div className={cn("max-w-2xl", align === "center" ? "mx-auto text-center" : "text-left")}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Title
        className={cn(
          "mt-4 font-medium tracking-tight text-neutral-900",
          as === "h1" ? "text-4xl sm:text-6xl" : "text-3xl sm:text-[2.5rem]"
        )}
      >
        {title}
      </Title>
      {text ? <p className="mt-4 text-base leading-8 text-neutral-600 sm:text-lg">{text}</p> : null}
    </div>
  );
}
