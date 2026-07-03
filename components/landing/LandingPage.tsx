"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Building2,
  Check,
  CheckCheck,
  Clock,
  Facebook,
  Flame,
  Inbox,
  KeyRound,
  Megaphone,
  MousePointerClick,
  ScrollText,
  Send,
  Sheet,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Thermometer,
  UserCheck,
  Users,
  Workflow,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SitePage } from "@/components/site/SitePage";
import {
  Container,
  Eyebrow,
  FadeIn,
  Section,
  SectionHeading,
  cardClass,
  ghostBtn,
  primaryBtn
} from "@/components/site/ui";

/* --------------------------------------------------------------- Data */

const whatIs = [
  { title: "A shared team inbox", text: "Every WhatsApp chat in one place your whole team can work from together.", icon: Inbox },
  { title: "An AI that replies for you", text: "Answers customers instantly from your own information — day or night.", icon: Bot },
  { title: "Ads & follow-ups that pay off", text: "See which ads bring real buyers, and never forget to follow up again.", icon: Megaphone }
];

const workflow = [
  { title: "Request a demo", text: "Tell us how you sell today. We map WhatsApp-OS to your motion and spin up your workspace." },
  { title: "We hand you the keys", text: "An admin provisions your company and your first login — you're live the same day, not next quarter." },
  { title: "Plug in your stack", text: "Connect WhatsApp Cloud API, Meta Ads, Google Sheets, and your AI model in a few clicks." },
  { title: "Sell on autopilot", text: "Leads pour in, AI replies in seconds, agents close the hot ones, and orders land in your sheet." }
];

type FeatureVisualKey = "inbox" | "ai" | "segmentation" | "broadcast" | "ads" | "automation";

type Feature = {
  title: string;
  tagline: string;
  text: string;
  points: string[];
  icon: typeof Inbox;
  visual: FeatureVisualKey;
};

const features: Feature[] = [
  {
    title: "One inbox for the whole team",
    tagline: "Shared team inbox",
    text: "Everyone works the same live queue. Assign a chat, drop an internal note, add a label, and pick up exactly where a teammate left off — no more forwarded screenshots or 'wait, who's replying to this?'",
    points: ["Real-time, no refresh", "Private team notes", "Labels & assignment"],
    icon: Inbox,
    visual: "inbox"
  },
  {
    title: "An AI that answers — and knows when to stop",
    tagline: "AI reply agent",
    text: "Trained on your website and your documents, it replies in seconds, qualifies the lead, and quotes from your real catalogue. The moment it hits its limit, it quietly hands the chat to a human — full context attached.",
    points: ["Grounded in your docs", "Qualifies as it talks", "Clean human handoff"],
    icon: Bot,
    visual: "ai"
  },
  {
    title: "Leads that sort themselves",
    tagline: "Lead segmentation",
    text: "Every contact is scored Hot, Warm, or Scrap from how they actually reply — not from a hunch. Your team stops scrolling a flat list and starts closing the people who are ready right now.",
    points: ["Scored on real replies", "Zero manual tagging", "Ranked by intent"],
    icon: Users,
    visual: "segmentation"
  },
  {
    title: "Broadcasts that report back",
    tagline: "Bulk campaigns",
    text: "Fire an approved template to thousands, schedule the send window, and watch sent → delivered → read → replied tick over live as Meta reports each state — so you always know what actually landed.",
    points: ["Scheduled windows", "Live delivery stats", "Template-safe"],
    icon: Megaphone,
    visual: "broadcast"
  },
  {
    title: "Every ad click becomes a conversation",
    tagline: "Click-to-WhatsApp ads",
    text: "Wire up Meta Ads and each click turns into a tracked chat, tied to the campaign that started it. Cost-per-lead, source, and revenue intent travel with the contact from the very first message.",
    points: ["Campaign attribution", "Cost-per-lead", "Revenue intent"],
    icon: MousePointerClick,
    visual: "ads"
  },
  {
    title: "Follow-ups that never clock off",
    tagline: "Workflow automation",
    text: "Timed nudges for cold leads, automatic order capture the moment a customer confirms, and human-handoff rules — all running quietly in the background while nobody has to babysit the queue.",
    points: ["Timed follow-ups", "Auto order capture", "Handoff rules"],
    icon: Workflow,
    visual: "automation"
  }
];

const leadTiers = [
  { label: "Hot", range: "6+ customer replies", text: "Actively negotiating. Pushed to the top of the queue for a human to step in and close.", icon: Flame, color: "#e11d48" },
  { label: "Warm", range: "2–5 customer replies", text: "Interested, not sold yet. The AI keeps asking the right questions until they're ready to buy.", icon: Thermometer, color: "#f59e0b" },
  { label: "Scrap", range: "under 2 replies", text: "Cold for now. Automatic 24h and 48h nudges quietly win back a slice of them without any effort.", icon: Snowflake, color: "#3b82f6" }
];

const integrations = [
  { name: "WhatsApp Cloud API", detail: "Official Meta messaging", icon: Send, color: "#25D366" },
  { name: "Meta Ads", detail: "Click-to-WhatsApp ads", icon: Facebook, color: "#0866FF" },
  { name: "Google Sheets", detail: "Two-way lead sync", icon: Sheet, color: "#0F9D58" },
  { name: "AI Models", detail: "OpenAI · Anthropic · Gemini", icon: Sparkles, color: "#8B5CF6" },
  { name: "Knowledge Base", detail: "Website & PDF grounding", icon: BookOpen, color: "#D97706" }
];

const security = [
  { title: "Multi-tenant isolation", text: "Every company only ever sees its own chats, leads, and settings. No exceptions, no leaks.", icon: Building2 },
  { title: "Encrypted credentials", text: "Meta, Google, and AI keys are encrypted at rest and never handed back to the browser.", icon: KeyRound },
  { title: "Role-based access", text: "Owners and agents get exactly the permissions they need — and nothing they don't.", icon: ShieldCheck },
  { title: "Full audit trail", text: "Every sensitive action is logged with who did it, what changed, and when it happened.", icon: ScrollText }
];

const faqs = [
  {
    q: "Do I need my own WhatsApp Business account?",
    a: "Yes. You connect your own WhatsApp Cloud API number, so every message goes out from your verified business — never a shared sender your customers won't recognise."
  },
  {
    q: "Which AI models can I use?",
    a: "OpenAI, Anthropic, and Gemini, or any OpenAI-compatible endpoint. You bring your own key, and the agent answers strictly from your knowledge base — not the open internet."
  },
  {
    q: "How do leads get into the inbox?",
    a: "Three ways: sync straight from a Google Sheet, capture them from Meta ads, or let them arrive organically. They all land in one place, de-duplicated by phone number."
  },
  {
    q: "Is my data separated from other companies?",
    a: "Completely. Every tenant runs in its own isolated workspace — no chats, leads, or credentials are ever shared across companies, at any layer."
  }
];

const demoHighlights = [
  { title: "AI answers first", text: "Instant replies, grounded in your own info.", icon: Bot },
  { title: "A human opts in", text: "An agent takes over the chat in one tap.", icon: UserCheck },
  { title: "Nothing dropped", text: "It all stays in one continuous thread.", icon: Zap }
];

/* ----------------------------------------------------------------- Hero */

function Hero() {
  return (
    <section className="relative -mt-14 w-full overflow-hidden pt-14">
      <div className="wa-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="wa-dots pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)]" aria-hidden="true" />
      <Container className="relative py-24 text-center sm:py-36">
        <FadeIn>
          <Eyebrow>
            <span className="h-1.5 w-1.5 rounded-full bg-wa-green" />
            Multi-tenant WhatsApp AI CRM
          </Eyebrow>
        </FadeIn>
        <FadeIn delay={0.08}>
          <h1 className="mx-auto mt-6 max-w-4xl text-balance text-5xl font-medium leading-[1.03] tracking-tight text-neutral-900 sm:text-7xl">
            Turn every WhatsApp chat into <span className="text-wa-accent">revenue</span>
          </h1>
        </FadeIn>
        <FadeIn delay={0.16}>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-8 text-neutral-600">
            WhatsApp-OS runs your entire WhatsApp sales motion from one screen — a shared inbox, an AI that
            answers and closes, ads you can actually track, and follow-ups that never sleep.
          </p>
        </FadeIn>
        <FadeIn delay={0.24}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/request-demo" className={primaryBtn}>
              Request a demo
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className={ghostBtn}>
              Login
            </Link>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}

/* -------------------------------------------------- What is WhatsApp-OS */

function WhatIs() {
  return (
    <Section>
      <SectionHeading
        eyebrow="What is WhatsApp-OS"
        title="Everything you do on WhatsApp, in one place"
        text="Businesses already sell on WhatsApp — with a phone passed around the team, a messy lead sheet, and ad money they can't trace. WhatsApp-OS replaces all of that with a single, calm workspace, so no customer waits and no sale slips away."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {whatIs.map(({ title, text, icon: Icon }, i) => (
          <FadeIn key={title} delay={i * 0.06}>
            <div className={cn(cardClass, "h-full p-7")}>
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-wa-green/20 bg-wa-green/10 text-wa-accent">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-medium text-neutral-900">{title}</h3>
              <p className="mt-2 text-sm leading-7 text-neutral-600">{text}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------- Workflow (timeline) */

type TimelineItem = { title: string; text: string };

function TimelineCard({ title, text, side }: { title: string; text: string; side: "left" | "right" }) {
  return (
    <div className={cn(cardClass, "max-w-sm p-6", side === "left" ? "text-right" : "text-left")}>
      <h3 className="text-lg font-medium text-neutral-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-neutral-600">{text}</p>
    </div>
  );
}

function AlternatingTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <>
      {/* Desktop */}
      <div className="relative mx-auto mt-16 hidden max-w-5xl md:block">
        <svg viewBox="0 0 1000 800" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id="wa-flow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#25D366" stopOpacity="0.15" />
              <stop offset="0.5" stopColor="#25D366" stopOpacity="0.9" />
              <stop offset="1" stopColor="#25D366" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          <path
            d="M500,0 L500,100 C500,170 360,230 500,300 C640,370 640,430 500,500 C360,570 360,630 500,700 L500,800"
            fill="none"
            stroke="url(#wa-flow)"
            strokeWidth="2"
          />
        </svg>

        <div className="relative">
          {items.map((item, i) => {
            const left = i % 2 === 0;
            return (
              <div key={item.title} className="grid grid-cols-[1fr_auto_1fr] items-center gap-10" style={{ minHeight: 176 }}>
                <div className="flex justify-end">{left ? <TimelineCard side="left" title={item.title} text={item.text} /> : null}</div>
                <FadeIn>
                  <span className="relative z-10 grid h-14 w-14 place-items-center rounded-full border border-wa-green/40 bg-white text-sm font-medium text-wa-accent shadow-[0_6px_20px_rgba(37,211,102,0.18)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </FadeIn>
                <div className="flex justify-start">{!left ? <TimelineCard side="right" title={item.title} text={item.text} /> : null}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile */}
      <ol className="relative mt-12 space-y-8 border-l border-neutral-200 pl-6 md:hidden">
        {items.map((item, i) => (
          <li key={item.title} className="relative">
            <span className="absolute -left-[33px] grid h-6 w-6 place-items-center rounded-full border border-wa-green/40 bg-white text-[10px] font-medium text-wa-accent">
              {i + 1}
            </span>
            <h3 className="text-base font-medium text-neutral-900">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-neutral-600">{item.text}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

function WorkflowSection() {
  return (
    <Section className="bg-neutral-50">
      <SectionHeading eyebrow="How it works" title="From first message to closed order" text="Four steps, one connected flow — and not a spreadsheet held together with hope in sight." />
      <AlternatingTimeline items={workflow} />
    </Section>
  );
}

/* --------------------------------------------- Product demo (auto-play) */

type ScriptItem =
  | { kind: "msg"; from: "them" | "ai" | "agent"; time: string; text: string }
  | { kind: "system"; text: string };

const chatScript: ScriptItem[] = [
  { kind: "msg", from: "them", time: "10:22", text: "Hi, I clicked your WhatsApp ad — can you send bulk pricing?" },
  { kind: "msg", from: "ai", time: "10:22", text: "Absolutely! Which quantity range should I quote for?" },
  { kind: "msg", from: "them", time: "10:23", text: "Around 500 units for next month." },
  { kind: "msg", from: "ai", time: "10:23", text: "For 500 it's ₹180 each, delivered in 7 days." },
  { kind: "msg", from: "them", time: "10:24", text: "Can you do ₹170 if we order 700?" },
  { kind: "system", text: "Priya from Sales opted in — AI paused" },
  { kind: "msg", from: "agent", time: "10:24", text: "Hi, Priya here 👋 Done — ₹170 each for 700 units." },
  { kind: "msg", from: "them", time: "10:25", text: "Perfect, let's go ahead 👍" },
  { kind: "msg", from: "agent", time: "10:25", text: "Order confirmed 🎉 Sending your invoice now." }
];

function ChatBubble({ from, time, text }: { from: "them" | "ai" | "agent"; time: string; text: string }) {
  const outgoing = from !== "them";
  const label = from === "ai" ? "AI Assistant" : from === "agent" ? "Priya · Sales" : null;
  return (
    <div
      className={cn(
        "max-w-[80%] rounded-lg px-3 py-1.5 text-sm text-neutral-800 shadow-sm",
        outgoing ? "ml-auto rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white"
      )}
    >
      {label ? (
        <p className={cn("mb-0.5 text-[10px] font-semibold", from === "ai" ? "text-wa-accent" : "text-[#0b6b5f]")}>
          {from === "ai" ? "🤖 " : "🧑 "}
          {label}
        </p>
      ) : null}
      <p>{text}</p>
      <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-neutral-500">
        {time}
        {outgoing ? <CheckCheck className="h-3 w-3 text-[#34b7f1]" /> : null}
      </span>
    </div>
  );
}

function SystemLine({ text }: { text: string }) {
  return (
    <div className="flex justify-center py-1.5">
      <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] font-medium text-neutral-500 shadow-sm">
        {text}
      </span>
    </div>
  );
}

function TypingBubble({ outgoing }: { outgoing: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
      <span className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-2.5 shadow-sm", outgoing ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white")}>
        {[0, 1, 2].map((d) => (
          <motion.span
            key={d}
            className="h-1.5 w-1.5 rounded-full bg-neutral-400"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1, repeat: Infinity, delay: d * 0.16 }}
          />
        ))}
      </span>
    </motion.div>
  );
}

/** Looping chat that reads like a short recording: AI answers, then a human opts in. */
function AnimatedChat({ onMode }: { onMode: (mode: "ai" | "human") => void }) {
  const [visible, setVisible] = useState(0);
  const [typing, setTyping] = useState<null | { outgoing: boolean }>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(setTimeout(resolve, ms));
      });

    async function run() {
      while (alive) {
        setVisible(0);
        setTyping(null);
        onMode("ai");
        await wait(700);
        for (let i = 0; i < chatScript.length && alive; i++) {
          const item = chatScript[i];
          if (item.kind === "system") {
            setTyping(null);
            await wait(520);
            if (!alive) break;
            onMode("human");
            setVisible(i + 1);
            await wait(720);
            continue;
          }
          const outgoing = item.from !== "them";
          setTyping({ outgoing });
          await wait(outgoing ? 820 : 620);
          if (!alive) break;
          setTyping(null);
          setVisible(i + 1);
          await wait(760);
        }
        await wait(2800);
      }
    }

    run();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [onMode]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [visible, typing]);

  return (
    <div ref={scrollRef} className="chat-wallpaper h-[460px] space-y-2 overflow-hidden px-4 py-5">
      {chatScript.slice(0, visible).map((item, i) =>
        item.kind === "system" ? (
          <SystemLine key={i} text={item.text} />
        ) : (
          <motion.div key={i} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28, ease: [0.21, 1, 0.21, 1] }}>
            <ChatBubble from={item.from} time={item.time} text={item.text} />
          </motion.div>
        )
      )}
      {typing ? <TypingBubble outgoing={typing.outgoing} /> : null}
    </div>
  );
}

function ChatDemo() {
  const [mode, setMode] = useState<"ai" | "human">("ai");
  return (
    <Section>
      <SectionHeading
        eyebrow="See it in action"
        title="AI answers. A human steps in. One thread."
        text="Watch a real ad-driven chat play out: the AI quotes pricing instantly, then an agent opts in to close the deal — all without the customer ever noticing a handoff."
      />

      <FadeIn className="mx-auto mt-12 max-w-5xl">
        <div className={cn(cardClass, "overflow-hidden")}>
          <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-200" />
            <span className="ml-3 text-xs text-neutral-400">app.whatsapp-os.com/inbox</span>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-wa-green/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-wa-accent">
              <motion.span className="h-1.5 w-1.5 rounded-full bg-wa-green" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
              Live demo
            </span>
          </div>

          <div className="grid md:grid-cols-[0.82fr_1.18fr]">
            <div className="hidden border-r border-neutral-200 p-3 md:block">
              {(
                [
                  ["Aarav Mehta", "Order confirmed 🎉", "now", 0, true],
                  ["Mira Patel", "Need delivery by Friday", "18m", 0, false],
                  ["Nora Ali", "Is this still available?", "1h", 1, false],
                  ["Rohan Das", "Thanks, order confirmed 🎉", "3h", 0, false],
                  ["Kabir Rao", "What sizes do you have?", "5h", 0, false]
                ] as const
              ).map(([name, msg, time, unread, active]) => (
                <div
                  key={name}
                  className={cn("mb-1 flex items-center gap-3 rounded-xl p-3 transition", active ? "bg-wa-green/10" : "hover:bg-neutral-50")}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-500">
                    {name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-neutral-900">{name}</p>
                      <span className="shrink-0 text-[10px] text-neutral-400">{time}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-neutral-500">{msg}</p>
                      {unread > 0 ? (
                        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-wa-green px-1 text-[10px] font-bold text-[#04140b]">
                          {unread}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-wa-green/15 text-sm font-semibold text-wa-accent">A</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900">Aarav Mehta</p>
                  <p className="text-[11px] text-wa-accent">online · Hot lead · from Meta ad</p>
                </div>
                <span
                  className={cn(
                    "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                    mode === "ai" ? "bg-wa-green/12 text-wa-accent" : "bg-[#0b6b5f]/10 text-[#0b6b5f]"
                  )}
                >
                  {mode === "ai" ? "🤖 AI replying" : "🧑 Priya replying"}
                </span>
              </div>

              <AnimatedChat onMode={setMode} />

              <div className="flex items-center gap-2 border-t border-neutral-200 bg-neutral-50 p-3">
                <span className="flex-1 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-400">Type a reply…</span>
                <span
                  className={cn(
                    "rounded-full px-3 py-2 text-xs font-medium transition-colors",
                    mode === "ai" ? "bg-wa-green/15 text-wa-accent" : "border border-neutral-200 bg-white text-neutral-600"
                  )}
                >
                  {mode === "ai" ? "AI is replying" : "You've taken over"}
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-wa-green text-[#04140b]">
                  <Send className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {demoHighlights.map(({ title, text, icon: Icon }) => (
            <div key={title} className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-wa-green/10 text-wa-accent">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-900">{title}</p>
                <p className="text-xs text-neutral-500">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </FadeIn>
    </Section>
  );
}

/* --------------------------------------------------- Feature visuals */

function Bar({ w, tone = "muted" }: { w: string; tone?: "muted" | "green" }) {
  return (
    <span className="block h-2 rounded-full bg-neutral-200">
      <span className={cn("block h-2 rounded-full", tone === "green" ? "bg-wa-green" : "bg-neutral-300")} style={{ width: w }} />
    </span>
  );
}

function FeatureVisual({ visual }: { visual: FeatureVisualKey }) {
  const inner = () => {
    switch (visual) {
      case "inbox":
        return (
          <div className="space-y-2">
            {[
              ["A", "Aarav Mehta", "Yes, go ahead 👍", true, 2],
              ["M", "Mira Patel", "Delivery by Friday?", false, 0],
              ["N", "Nora Ali", "Still available?", false, 1]
            ].map(([ini, name, msg, active, unread]) => (
              <div key={name as string} className={cn("flex items-center gap-3 rounded-xl border p-2.5", active ? "border-wa-green/30 bg-wa-green/10" : "border-neutral-200 bg-white")}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-500">{ini as string}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-900">{name as string}</p>
                  <p className="truncate text-[11px] text-neutral-500">{msg as string}</p>
                </div>
                {(unread as number) > 0 ? <span className="grid h-4 w-4 place-items-center rounded-full bg-wa-green text-[9px] font-bold text-[#04140b]">{unread as number}</span> : null}
              </div>
            ))}
          </div>
        );
      case "ai":
        return (
          <div className="space-y-2">
            <div className="max-w-[80%] rounded-lg rounded-tl-sm border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 shadow-sm">What&apos;s the price for 500 units?</div>
            <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-xs text-neutral-800 shadow-sm">
              <p className="mb-0.5 text-[10px] font-semibold text-wa-accent">🤖 AI Assistant</p>
              ₹180 each, delivered in 7 days.
            </div>
            <div className="flex items-center gap-1.5 pt-1 text-[11px] text-neutral-500">
              <UserCheck className="h-3.5 w-3.5 text-wa-accent" /> Handing to a human to close…
            </div>
          </div>
        );
      case "segmentation":
        return (
          <div className="space-y-3">
            {[
              ["Hot", "#e11d48", "82%", 5],
              ["Warm", "#f59e0b", "48%", 12],
              ["Scrap", "#3b82f6", "18%", 7]
            ].map(([label, color, w, n]) => (
              <div key={label as string} className="flex items-center gap-3">
                <span className="flex w-16 items-center gap-1.5 text-xs font-medium text-neutral-700">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color as string }} />
                  {label as string}
                </span>
                <span className="block h-2 flex-1 rounded-full bg-neutral-200">
                  <span className="block h-2 rounded-full" style={{ width: w as string, backgroundColor: color as string }} />
                </span>
                <span className="w-6 text-right text-[11px] text-neutral-400">{n as number}</span>
              </div>
            ))}
          </div>
        );
      case "broadcast":
        return (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-neutral-700">Summer template</span>
              <span className="text-neutral-400">2,000 sent</span>
            </div>
            {[
              ["Delivered", "94%"],
              ["Read", "71%"],
              ["Replied", "38%"]
            ].map(([label, w]) => (
              <div key={label as string}>
                <div className="mb-1 flex justify-between text-[11px] text-neutral-500">
                  <span>{label as string}</span>
                  <span>{w as string}</span>
                </div>
                <Bar w={w as string} tone="green" />
              </div>
            ))}
          </div>
        );
      case "ads":
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-700">
              <span className="rounded-md bg-[#0866FF]/12 px-2 py-1 text-[#0866FF]">Meta Ad</span>
              <ArrowRight className="h-3.5 w-3.5 text-neutral-300" />
              <span className="rounded-md bg-wa-green/12 px-2 py-1 text-wa-accent">WhatsApp chat</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["CPL", "₹42"],
                ["Source", "IG"],
                ["Intent", "High"]
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg border border-neutral-200 bg-white p-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400">{k as string}</p>
                  <p className="text-sm font-semibold text-neutral-900">{v as string}</p>
                </div>
              ))}
            </div>
          </div>
        );
      case "automation":
        return (
          <div className="space-y-2.5">
            {[
              ["Lead goes quiet", Clock, "text-neutral-400"],
              ["24h nudge sent", Check, "text-wa-accent"],
              ["48h nudge sent", Check, "text-wa-accent"],
              ["Handoff to agent", UserCheck, "text-wa-accent"]
            ].map(([label, Icon, color], i, arr) => {
              const Ico = Icon as typeof Clock;
              return (
                <div key={label as string} className="flex items-center gap-3">
                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border border-neutral-200 bg-white", color as string)}>
                    <Ico className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs text-neutral-700">{label as string}</span>
                  {i < arr.length - 1 ? null : null}
                </div>
              );
            })}
          </div>
        );
    }
  };

  return (
    <div className={cn(cardClass, "relative aspect-[4/3] overflow-hidden")}>
      <div className="wa-dots pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-wa-green/10 via-transparent to-transparent" aria-hidden="true" />
      <div className="relative flex h-full items-center p-6">
        <div className="w-full">{inner()}</div>
      </div>
    </div>
  );
}

function FeatureRow({ feature, index }: { feature: Feature; index: number }) {
  const flip = index % 2 === 1;
  const { title, tagline, text, points, visual } = feature;
  return (
    <FadeIn>
      <div className="grid items-center gap-8 md:grid-cols-2 md:gap-16">
        <div className={cn(flip && "md:order-2")}>
          <p className="text-sm font-medium tracking-wide text-wa-accent">
            {String(index + 1).padStart(2, "0")} · {tagline}
          </p>
          <h3 className="mt-3 text-2xl font-medium tracking-tight text-neutral-900 sm:text-[1.7rem]">{title}</h3>
          <p className="mt-4 text-base leading-8 text-neutral-600">{text}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {points.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600">
                <CheckCheck className="h-3 w-3 text-wa-accent" />
                {p}
              </span>
            ))}
          </div>
        </div>
        <div className={cn(flip && "md:order-1")}>
          <FeatureVisual visual={visual} />
        </div>
      </div>
    </FadeIn>
  );
}

function Features() {
  return (
    <Section>
      <SectionHeading
        eyebrow="What it can do"
        title="Everything a WhatsApp sale needs"
        text="The specific things that move a chat from 'just looking' to a confirmed order — and keep your team out of spreadsheets."
      />
      <div className="mt-16 space-y-16 md:space-y-24">
        {features.map((feature, i) => (
          <FeatureRow key={feature.title} feature={feature} index={i} />
        ))}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------- Lead scoring */

function LeadTemperature() {
  return (
    <Section className="bg-neutral-50">
      <SectionHeading
        align="left"
        eyebrow="Smart prioritisation"
        title="Every lead, ranked automatically"
        text="WhatsApp-OS reads how each contact actually replies and sorts them for you — so your team spends its hours where they pay off."
      />
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {leadTiers.map(({ label, range, text, icon: Icon, color }) => (
          <FadeIn key={label}>
            <div className={cn(cardClass, "h-full p-6")}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `${color}1f`, border: `1px solid ${color}45`, color }}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-base font-medium text-neutral-900">{label}</p>
                  <p className="text-xs text-neutral-500">{range}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-neutral-600">{text}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------ Value (graphs) */

function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-28 w-28 place-items-center">
      <svg viewBox="0 0 80 80" className="h-28 w-28 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-neutral-200" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="#25D366" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div className="absolute text-center">
        <p className="text-2xl font-semibold text-neutral-900">{pct}%</p>
      </div>
    </div>
  );
}

function ValueSection() {
  return (
    <Section>
      <SectionHeading
        align="left"
        eyebrow="What you get"
        title="The difference your customers actually feel"
        text="This is what changes the week you switch on WhatsApp-OS — measured where it matters."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {/* Speed */}
        <FadeIn>
          <div className={cn(cardClass, "flex h-full flex-col p-7")}>
            <h3 className="text-lg font-medium text-neutral-900">Replies in seconds, not hours</h3>
            <p className="mt-2 text-sm leading-6 text-neutral-600">The AI answers the instant a message lands, so no customer is ever left waiting.</p>
            <div className="mt-6 space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs text-neutral-500">
                  <span>Manual team</span>
                  <span>~2 hrs</span>
                </div>
                <Bar w="100%" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-neutral-500">WhatsApp-OS</span>
                  <span className="font-semibold text-wa-accent">~8 sec</span>
                </div>
                <Bar w="14%" tone="green" />
              </div>
            </div>
          </div>
        </FadeIn>

        {/* Close rate */}
        <FadeIn delay={0.06}>
          <div className={cn(cardClass, "flex h-full flex-col p-7")}>
            <h3 className="text-lg font-medium text-neutral-900">More chats become orders</h3>
            <p className="mt-2 text-sm leading-6 text-neutral-600">Leads are scored and prioritised, so agents work the ones that are ready to buy.</p>
            <div className="mt-auto flex items-end gap-3 pt-6" style={{ height: 112 }}>
              {[38, 54, 67, 83].map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex w-full items-end justify-center" style={{ height: 72 }}>
                    <div className={cn("w-full rounded-t-md", i === 3 ? "bg-wa-green" : "bg-wa-green/35")} style={{ height: `${h}%` }} />
                  </div>
                  <span className="text-[10px] text-neutral-400">W{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Nothing lost */}
        <FadeIn delay={0.12}>
          <div className={cn(cardClass, "flex h-full flex-col p-7")}>
            <h3 className="text-lg font-medium text-neutral-900">Zero leads slip away</h3>
            <p className="mt-2 text-sm leading-6 text-neutral-600">Every conversation is captured, assigned, and logged — nothing lost between shifts.</p>
            <div className="mt-4 flex items-center gap-4">
              <Ring pct={100} />
              <div>
                <p className="text-sm font-medium text-neutral-900">Chats captured</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">De-duplicated by phone number and tied to one contact forever.</p>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------- Integrations */

function Integrations() {
  return (
    <Section>
      <SectionHeading align="left" eyebrow="Fits your stack" title="Plugs into the tools you already run on" />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {integrations.map(({ name, detail, icon: Icon, color }, i) => (
          <FadeIn key={name} delay={i * 0.05}>
            <div className={cn(cardClass, "flex h-full items-center gap-3 p-4")}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${color}17`, border: `1px solid ${color}3a`, color }}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{name}</p>
                <p className="truncate text-xs text-neutral-500">{detail}</p>
              </div>
            </div>
          </FadeIn>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------- Security */

function SecuritySection() {
  return (
    <Section className="bg-neutral-50">
      <SectionHeading
        align="left"
        eyebrow="Trust & security"
        title="Enterprise-grade, by default"
        text="Multi-tenant from the first line of code, with the controls a serious operator expects — not bolted on later."
      />
      <div className="mt-14 grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
        {security.map(({ title, text, icon: Icon }, i) => (
          <FadeIn key={title} delay={i * 0.04}>
            <Icon className="h-6 w-6 text-wa-accent" />
            <h3 className="mt-4 text-base font-medium text-neutral-900">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-neutral-600">{text}</p>
          </FadeIn>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ FAQ */

function Faq() {
  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHeading align="left" eyebrow="FAQ" title="Questions, answered" />
        <div className="space-y-8">
          {faqs.map(({ q, a }) => (
            <FadeIn key={q}>
              <h3 className="text-base font-medium text-neutral-900">{q}</h3>
              <p className="mt-2 text-sm leading-7 text-neutral-600">{a}</p>
            </FadeIn>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- Final CTA */

function FinalCta() {
  return (
    <Section>
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-wa-green/30 bg-wa-green/[0.08] px-8 py-16 text-center sm:px-16">
        <div className="wa-glow pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-balance text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
            Ready to make WhatsApp your best-performing channel?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-neutral-600">
            See WhatsApp-OS mapped to your own sales motion — in under 30 minutes, no slideware.
          </p>
          <Link href="/request-demo" className={cn(primaryBtn, "mt-9")}>
            Request a demo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </Section>
  );
}

export function LandingPage() {
  return (
    <SitePage>
      <Hero />
      <WhatIs />
      <WorkflowSection />
      <ChatDemo />
      <Features />
      <LeadTemperature />
      <ValueSection />
      <Integrations />
      <SecuritySection />
      <Faq />
      <FinalCta />
    </SitePage>
  );
}
