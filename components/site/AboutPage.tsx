"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  Gauge,
  Layers,
  Lock,
  MessageSquare,
  ShieldCheck,
  Store,
  Target,
  Workflow,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SitePage } from "@/components/site/SitePage";
import { Container, FadeIn, Section, SectionHeading, cardClass, primaryBtn } from "@/components/site/ui";

const principles = [
  {
    title: "Isolation is not a setting",
    text: "Multi-tenancy is baked into the data model, not a filter we remember to apply. One company can never see another's chats, leads, or keys — there is no code path where that's even possible.",
    icon: Building2
  },
  {
    title: "The AI stays on a leash",
    text: "The agent answers from your knowledge base and nothing else. No hallucinated prices, no invented policies — and the second it's unsure, a human takes the wheel with full context.",
    icon: Bot
  },
  {
    title: "Real-time or it doesn't count",
    text: "A CRM that makes you refresh is a spreadsheet with extra steps. Messages, statuses, and lead scores update the instant they change — no polling, no stale screens.",
    icon: Gauge
  },
  {
    title: "Secrets are treated like secrets",
    text: "Meta, Google, and AI credentials are encrypted at rest and never returned to the browser. The people using WhatsApp-OS never handle the keys that make it run.",
    icon: Lock
  },
  {
    title: "Automation you can actually trust",
    text: "Every automated action is scoped, logged, and reversible. Follow-ups, handoffs, and order capture run quietly — but you can always see exactly what fired and why.",
    icon: Workflow
  },
  {
    title: "One surface, not ten tabs",
    text: "Ads, inbox, AI, broadcasts, and analytics live in a single workspace. Context follows the customer everywhere, so nobody re-explains the same conversation twice.",
    icon: Layers
  }
];

const solutions = [
  {
    problem: "Leads leak out of a personal phone passed around the team.",
    answer: "A shared team inbox keeps every chat in one place — assigned, labelled, and picked up by whoever's free.",
    feature: "Team Inbox"
  },
  {
    problem: "Customers wait hours for a reply, then buy elsewhere.",
    answer: "The AI agent answers in seconds from your own documents, day or night, and escalates to a human when it matters.",
    feature: "AI Sales Agent"
  },
  {
    problem: "You can't tell which ad actually drives sales.",
    answer: "Click-to-WhatsApp tracking ties every chat to its campaign, with cost-per-lead and revenue intent attached.",
    feature: "Ad Attribution"
  },
  {
    problem: "A lead spreadsheet nobody trusts or updates.",
    answer: "Two-way Google Sheets sync pulls leads in, messages them automatically, and writes outreach status back.",
    feature: "Lead Automation"
  },
  {
    problem: "Cold leads are simply forgotten.",
    answer: "Timed 24h and 48h nudges quietly win back a share of them — no one has to remember to follow up.",
    feature: "Follow-up Automation"
  },
  {
    problem: "No idea which leads are worth an agent's time.",
    answer: "Automatic Hot / Warm / Scrap scoring ranks every contact by how they actually reply.",
    feature: "Lead Scoring"
  }
];

const audiences = [
  {
    title: "D2C & retail brands",
    text: "Running click-to-WhatsApp ads and drowning in DMs. WhatsApp-OS turns that flood into a sorted queue where the ready-to-buy leads rise to the top.",
    icon: Store
  },
  {
    title: "Sales-led teams",
    text: "Agents who close over chat. They get a shared inbox, AI drafts, lead scores, and clean handoffs — so nothing slips between shifts or teammates.",
    icon: Target
  },
  {
    title: "Support-heavy operations",
    text: "High message volume with repetitive questions. The AI handles the first mile from your docs, and escalates only the conversations that genuinely need a person.",
    icon: MessageSquare
  }
];

export function AboutPage() {
  return (
    <SitePage>
      <section className="relative -mt-14 w-full overflow-hidden pt-14">
        <div className="wa-glow pointer-events-none absolute inset-0" aria-hidden="true" />
        <Container className="relative py-24 sm:py-32">
          <SectionHeading
            as="h1"
            align="left"
            eyebrow="About"
            title="The operating system for doing business on WhatsApp"
            text="Two billion people open WhatsApp every day. For a growing number of businesses, it's already the front door — for ads, questions, negotiation, and orders. WhatsApp-OS is the layer that makes that front door actually run like a business."
          />
        </Container>
      </section>

      {/* Narrative */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
          <SectionHeading align="left" eyebrow="Why we built it" title="WhatsApp became the storefront. The tooling never caught up." />
          <div className="space-y-6 text-lg leading-8 text-neutral-600">
            <p>
              Businesses were already selling on WhatsApp — but doing it with a personal phone passed around the team,
              a Google Sheet of leads that nobody trusted, and an ad budget pouring clicks into a black hole. Every
              conversation was a sale; most of them quietly leaked away.
            </p>
            <p>
              WhatsApp-OS started from a simple frustration: the channel where customers actually wanted to talk had
              the worst tooling of any in the stack. There was no shared inbox, no lead scoring, no way to know which
              ad drove which chat, and no AI that could answer a question at 2am without inventing an answer.
            </p>
            <p>
              So we built the whole motion into one platform — multi-tenant, real-time, and AI-native from the first
              commit. Ads flow in, the AI qualifies and answers from your own documents, leads sort themselves by how
              they reply, agents step in to close, and orders land back in your systems. Nothing gets forwarded as a
              screenshot. Nothing gets lost between shifts.
            </p>
            <p>
              We're a small team that cares more about the boring parts — isolation, encryption, audit trails, and
              latency — than the buzzwords. Because the businesses that run on WhatsApp-OS are trusting it with the
              conversations that pay their bills.
            </p>
          </div>
        </div>
      </Section>

      {/* Problem → solution, mapped to features */}
      <Section className="bg-neutral-50">
        <SectionHeading
          align="left"
          eyebrow="The problem we solve"
          title="Six ways WhatsApp quietly costs you money — and how we fix each one"
          text="Every business already selling on WhatsApp loses revenue in the same predictable places. WhatsApp-OS closes each gap with a specific feature, not a vague promise."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {solutions.map(({ problem, answer, feature }, i) => (
            <FadeIn key={feature} delay={i * 0.04}>
              <div className={cn(cardClass, "h-full p-6")}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-500/10 text-rose-500">
                    <X className="h-3.5 w-3.5" />
                  </span>
                  <p className="text-[15px] font-medium text-neutral-900">{problem}</p>
                </div>
                <div className="mt-4 flex items-start gap-3 border-t border-neutral-200 pt-4">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-wa-green/12 text-wa-accent">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-sm leading-6 text-neutral-600">{answer}</p>
                    <span className="mt-3 inline-flex rounded-full border border-wa-green/25 bg-wa-green/10 px-2.5 py-1 text-[11px] font-medium text-wa-accent">
                      {feature}
                    </span>
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </Section>

      {/* Principles */}
      <Section>
        <SectionHeading
          align="left"
          eyebrow="How we build"
          title="The principles the product is held to"
          text="Six commitments that decide what ships and what doesn't."
        />
        <div className="mt-14 grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {principles.map(({ title, text, icon: Icon }, i) => (
            <FadeIn key={title} delay={i * 0.04}>
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-wa-green/20 bg-wa-green/10 text-wa-accent">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-base font-medium text-neutral-900">{title}</h3>
              <p className="mt-2 text-sm leading-7 text-neutral-600">{text}</p>
            </FadeIn>
          ))}
        </div>
      </Section>

      {/* Under the hood */}
      <Section className="bg-neutral-50">
        <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
          <SectionHeading align="left" eyebrow="Under the hood" title="What actually happens between a click and an order" />
          <div className="space-y-6 text-lg leading-8 text-neutral-600">
            <p>
              A customer taps your Meta ad and opens a chat. WhatsApp-OS catches it the moment it arrives, tags it with
              the campaign that drove it, and drops it into your shared inbox — de-duplicated against every lead you
              already have by phone number.
            </p>
            <p>
              The AI agent replies in seconds, grounded strictly in your website and uploaded documents. It answers the
              real question, quotes from your real catalogue, and quietly scores the lead as the conversation moves.
              The instant it reaches the edge of what it knows, it hands off to a human — who sees the entire history,
              not a cold start.
            </p>
            <p>
              Meanwhile, statuses stream back from Meta in real time, follow-ups fire on schedule for the leads that go
              quiet, confirmed orders are captured out of the chat, and everything sensitive is written to an audit
              trail. That's the loop — and it runs whether or not anyone is watching the queue.
            </p>
          </div>
        </div>
      </Section>

      {/* Who it's for */}
      <Section>
        <SectionHeading
          align="left"
          eyebrow="Who it's for"
          title="Built for teams that live in the chat"
        />
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {audiences.map(({ title, text, icon: Icon }, i) => (
            <FadeIn key={title} delay={i * 0.05}>
              <div className={cn(cardClass, "h-full p-7")}>
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-wa-green/20 bg-wa-green/10 text-wa-accent">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-medium text-neutral-900">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-neutral-600">{text}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </Section>

      {/* Belief strip */}
      <Section className="bg-neutral-50">
        <div className="mx-auto max-w-3xl border-l-2 border-wa-green pl-6 sm:pl-8">
          <p className="text-2xl font-medium leading-relaxed tracking-tight text-neutral-900 sm:text-3xl sm:leading-relaxed">
            Every unanswered WhatsApp message is a customer who was ready to talk.
            <span className="text-wa-accent"> Our whole job is to make sure none of them wait.</span>
          </p>
          <div className="mt-6 flex items-center gap-2 text-sm text-neutral-500">
            <ShieldCheck className="h-4 w-4 text-wa-accent" />
            Multi-tenant · encrypted · audited — for every company on the platform.
          </div>
        </div>
      </Section>

      {/* CTA */}
      <Section>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
            Want to see it for your team?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-neutral-600">
            Book a walkthrough and we'll tailor it to exactly how your business uses WhatsApp today.
          </p>
          <Link href="/request-demo" className={cn(primaryBtn, "mt-8")}>
            Request a demo
          </Link>
        </div>
      </Section>
    </SitePage>
  );
}
