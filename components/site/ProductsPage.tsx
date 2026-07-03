"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Check,
  FileSpreadsheet,
  Inbox,
  Megaphone,
  MousePointerClick,
  ShoppingBag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SitePage } from "@/components/site/SitePage";
import { Container, FadeIn, Section, SectionHeading, cardClass, primaryBtn } from "@/components/site/ui";

type Product = {
  name: string;
  tagline: string;
  text: string;
  capabilities: string[];
  icon: typeof Inbox;
};

const products: Product[] = [
  {
    name: "Team Inbox",
    tagline: "The shared workspace your team lives in",
    text: "A live, WhatsApp-style inbox where your whole team works from one queue instead of one phone passed around the office. Assign a chat, leave a private note, add a label, and hand off mid-conversation without a single detail falling through. Everything updates in real time — the person who opens a chat sees exactly what the last person saw.",
    capabilities: [
      "Real-time messaging with zero refresh",
      "Assignment, labels, and internal notes",
      "One-tap AI reply suggestions inline",
      "Full conversation history on every contact",
      "De-duplicated by phone number across sources"
    ],
    icon: Inbox
  },
  {
    name: "AI Sales Agent",
    tagline: "Answers instantly, from your knowledge — not the internet",
    text: "An assistant grounded in your own website and uploaded documents, so it quotes real prices and real policies rather than inventing them. It answers the customer's actual question, qualifies the lead as the conversation moves, and the moment it reaches the edge of what it knows, it hands the chat to a human with the entire history attached — no cold starts.",
    capabilities: [
      "Grounded in your website and PDFs",
      "Bring your own model — OpenAI, Anthropic, Gemini",
      "Qualifies and scores while it talks",
      "Automatic human handoff with full context",
      "Guardrails against off-topic or invented answers"
    ],
    icon: Bot
  },
  {
    name: "Broadcasts & Campaigns",
    tagline: "Reach thousands without losing the thread",
    text: "Send an approved template to a large audience, schedule the send window, and watch every state — sent, delivered, read, replied — update live as Meta reports it back. Replies land in the same shared inbox as everything else, so a broadcast turns into real conversations instead of a fire-and-forget blast.",
    capabilities: [
      "Approved-template sends at scale",
      "Scheduled send windows",
      "Live sent / delivered / read / replied tracking",
      "Replies flow straight into the team inbox",
      "Audience segments from lead scores"
    ],
    icon: Megaphone
  },
  {
    name: "Lead Automation",
    tagline: "Your Google Sheet, but it actually follows up",
    text: "Pull leads straight from a Google Sheet, message them automatically, and run timed follow-up sequences for the ones who go quiet — then write the outreach status back to the sheet so your source of truth stays current. It's two-way, de-duplicated, and hands off to a human the instant a lead replies with intent.",
    capabilities: [
      "Two-way Google Sheets sync",
      "Automated first-touch messaging",
      "Timed 24h / 48h follow-up sequences",
      "Status written back to the sheet",
      "De-duplication by phone number"
    ],
    icon: FileSpreadsheet
  },
  {
    name: "Click-to-WhatsApp Ads",
    tagline: "Know which ad drove which order",
    text: "Connect Meta Ads and every click becomes a tracked conversation, tied to the campaign that started it. Cost-per-lead, source, and revenue intent travel with the contact from the first message to the closed order — so you finally see which spend turns into chats, and which chats turn into money.",
    capabilities: [
      "Meta Ads connection out of the box",
      "Campaign and ad-set attribution per chat",
      "Cost-per-lead and source tracking",
      "Revenue intent attached to each contact",
      "Ad-driven leads scored automatically"
    ],
    icon: MousePointerClick
  },
  {
    name: "Orders & Handoff Desk",
    tagline: "Capture the sale, route the hard ones",
    text: "When a customer confirms in chat, the order is captured out of the conversation — no re-keying into another system. Complex or high-value conversations are routed to a prioritised human takeover queue, so your best agents spend their time exactly where it moves the number.",
    capabilities: [
      "Order capture straight from the chat",
      "Prioritised human takeover queue",
      "Hot-lead routing to your closers",
      "Handoff rules you control",
      "Every action written to the audit trail"
    ],
    icon: ShoppingBag
  }
];

const loop = [
  { step: "Capture", text: "Ads, Sheets, and organic chats all land in one de-duplicated inbox." },
  { step: "Answer", text: "The AI replies from your docs and qualifies the lead in seconds." },
  { step: "Score", text: "Contacts sort themselves Hot, Warm, or Scrap from how they reply." },
  { step: "Close", text: "Agents take the hot ones; orders are captured back to your systems." }
];

function ProductBlock({ product, index }: { product: Product; index: number }) {
  const { name, tagline, text, capabilities, icon: Icon } = product;
  return (
    <FadeIn>
      <div className="grid gap-8 md:grid-cols-[1fr_1fr] md:gap-14">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-wa-green/20 bg-wa-green/10 text-wa-accent">
              <Icon className="h-6 w-6" />
            </span>
            <span className="text-sm font-medium text-neutral-400">{String(index + 1).padStart(2, "0")}</span>
          </div>
          <h2 className="mt-5 text-2xl font-medium tracking-tight text-neutral-900 sm:text-[1.7rem]">{name}</h2>
          <p className="mt-2 text-sm font-medium text-wa-accent">{tagline}</p>
          <p className="mt-4 text-base leading-8 text-neutral-600">{text}</p>
        </div>
        <div className={cn(cardClass, "h-fit p-7")}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">What's inside</p>
          <ul className="mt-4 space-y-3">
            {capabilities.map((c) => (
              <li key={c} className="flex items-start gap-3 text-sm leading-6 text-neutral-700">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-wa-green/12 text-wa-accent">
                  <Check className="h-3 w-3" />
                </span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </FadeIn>
  );
}

export function ProductsPage() {
  return (
    <SitePage>
      <section className="relative -mt-14 w-full overflow-hidden pt-14">
        <div className="wa-glow pointer-events-none absolute inset-0" aria-hidden="true" />
        <Container className="relative py-24 sm:py-32">
          <SectionHeading
            as="h1"
            align="left"
            eyebrow="Products"
            title="Six products. One WhatsApp sales engine."
            text="Each one earns its place on its own — a shared inbox, an AI that closes, broadcasts, lead automation, ad tracking, and an order desk. Together they're the entire motion, from the first ad click to the confirmed order, running on one platform."
          />
        </Container>
      </section>

      {/* Product detail blocks */}
      <Section>
        <div className="space-y-16 md:space-y-24">
          {products.map((product, i) => (
            <ProductBlock key={product.name} product={product} index={i} />
          ))}
        </div>
      </Section>

      {/* How it fits together */}
      <Section className="bg-neutral-50">
        <SectionHeading
          align="left"
          eyebrow="How it fits together"
          title="Separate products, one continuous loop"
          text="You can start with just the inbox. But the real leverage shows up when every part feeds the next."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-4">
          {loop.map(({ step, text }, i) => (
            <FadeIn key={step} delay={i * 0.05}>
              <div className={cn(cardClass, "h-full p-6")}>
                <div className="flex items-center gap-2 text-wa-accent">
                  <span className="text-sm font-semibold">{String(i + 1).padStart(2, "0")}</span>
                  {i < loop.length - 1 ? <ArrowRight className="h-4 w-4 text-neutral-300" /> : null}
                </div>
                <h3 className="mt-3 text-lg font-medium text-neutral-900">{step}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">{text}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <Section>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
            Start with one. Grow into the whole suite.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-neutral-600">
            Book a demo and we'll show you the products that fit your business first — and where the rest plug in later.
          </p>
          <Link href="/request-demo" className={cn(primaryBtn, "mt-8")}>
            Request a demo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Section>
    </SitePage>
  );
}
