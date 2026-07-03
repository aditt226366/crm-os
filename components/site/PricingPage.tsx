"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SitePage } from "@/components/site/SitePage";
import { Container, Section, SectionHeading, ghostBtn, primaryBtn } from "@/components/site/ui";

const pricing = [
  {
    name: "Starter",
    range: "₹2,999 – ₹4,999",
    cadence: "per month",
    text: "For small teams getting started with one WhatsApp number.",
    points: ["Shared team inbox", "Up to 3 agents", "AI replies & lead scoring", "Google Sheets sync"],
    highlighted: false
  },
  {
    name: "Pro",
    range: "₹7,999 – ₹12,999",
    cadence: "per month",
    text: "For growing businesses running ads, campaigns, and automation.",
    points: ["Everything in Starter", "Broadcasts & campaigns", "Click-to-WhatsApp ads", "Workflow automation", "Priority support"],
    highlighted: true
  },
  {
    name: "Enterprise",
    range: "Custom",
    cadence: "let's talk",
    text: "For multi-brand operations that need scale, control, and SLAs.",
    points: ["Unlimited agents & numbers", "Advanced roles & audit logs", "Dedicated onboarding", "Custom integrations"],
    highlighted: false
  }
];

export function PricingPage() {
  return (
    <SitePage>
      <section className="relative -mt-14 w-full overflow-hidden pt-14">
        <div className="wa-glow pointer-events-none absolute inset-0" aria-hidden="true" />
        <Container className="relative py-24 sm:py-32">
          <SectionHeading
            as="h1"
            eyebrow="Pricing"
            title="Simple pricing, priced for the market"
            text="Plans are in line with what comparable WhatsApp CRMs charge for the same value. Pick a tier and scale as you grow."
          />
        </Container>
      </section>

      <Section>
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
          {pricing.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "flex h-full flex-col rounded-2xl border p-8",
                plan.highlighted
                  ? "border-wa-green/50 bg-wa-green/[0.06] shadow-[0_10px_40px_rgba(37,211,102,0.12)]"
                  : "border-neutral-200 bg-white"
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-neutral-900">{plan.name}</h2>
                {plan.highlighted ? (
                  <span className="rounded-full bg-wa-green px-2.5 py-0.5 text-[11px] font-semibold text-[#04140b]">Popular</span>
                ) : null}
              </div>
              <p className="mt-4 text-2xl font-semibold tracking-tight text-neutral-900">{plan.range}</p>
              <p className="text-xs text-neutral-500">{plan.cadence}</p>
              <p className="mt-4 text-sm leading-6 text-neutral-600">{plan.text}</p>
              <ul className="mt-6 space-y-3">
                {plan.points.map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm text-neutral-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-wa-accent" />
                    {point}
                  </li>
                ))}
              </ul>
              <Link href="/request-demo" className={cn(plan.highlighted ? primaryBtn : ghostBtn, "mt-8 w-full")}>
                Request a demo
              </Link>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-neutral-500">
          All plans include multi-tenant isolation, encrypted credentials, and real-time delivery tracking. Final
          pricing depends on message volume and number of WhatsApp numbers.
        </p>
      </Section>
    </SitePage>
  );
}
