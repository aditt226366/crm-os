"use client";

import Link from "next/link";
import { Check, CalendarClock, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { SitePage } from "@/components/site/SitePage";
import { Container, Section, SectionHeading, ghostBtn, primaryBtn } from "@/components/site/ui";

const plans = [
  {
    name: "Starter",
    text: "For small teams getting started with one WhatsApp number.",
    points: ["Shared team inbox", "Up to 3 agents", "AI replies & lead scoring", "Google Sheets sync"],
    highlighted: false
  },
  {
    name: "Pro",
    text: "For growing businesses running ads, campaigns, and automation.",
    points: ["Everything in Starter", "Broadcasts & campaigns", "Click-to-WhatsApp ads", "Workflow automation", "Priority support"],
    highlighted: true
  },
  {
    name: "Enterprise",
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
            title="Plans tailored to your business"
            text="Every workspace is set up to fit your team size, message volume, and the WhatsApp numbers you run. Book a demo or reach out to our admin and we'll put together a plan that fits."
          />
        </Container>
      </section>

      <Section>
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
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
              <p className="mt-4 text-sm font-medium text-wa-accent">Custom pricing</p>
              <p className="text-xs text-neutral-500">Shared with you after a quick chat</p>
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
                Book a demo
              </Link>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-12 max-w-3xl rounded-2xl border border-neutral-200 bg-white p-8 text-center">
          <h3 className="text-xl font-medium tracking-tight text-neutral-900">Want the details?</h3>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-neutral-600">
            Book a demo to see the platform in action, or contact our admin and we&apos;ll walk you through the plan,
            pricing, and setup for your business.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/request-demo" className={cn(primaryBtn, "w-full sm:w-auto")}>
              <CalendarClock className="h-4 w-4" />
              Book a demo
            </Link>
            <a href="mailto:hello@whatsapp-os.com" className={cn(ghostBtn, "w-full sm:w-auto")}>
              <Mail className="h-4 w-4" />
              Contact the admin
            </a>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-neutral-500">
          All plans include multi-tenant isolation, encrypted credentials, and real-time delivery tracking. Your final
          plan depends on message volume and the number of WhatsApp numbers you run.
        </p>
      </Section>
    </SitePage>
  );
}
