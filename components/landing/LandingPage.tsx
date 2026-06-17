"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  ChevronRight,
  Clock3,
  DatabaseZap,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  Inbox,
  KeyRound,
  Layers3,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  Radio,
  Route,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  UserCheck,
  Users,
  Workflow,
  Zap
} from "lucide-react";
import { motion } from "framer-motion";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ScrollOrbScene = dynamic(
  () => import("@/components/visuals/ScrollOrbScene"),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="orb-canvas bg-[radial-gradient(circle_at_50%_22%,rgba(34,211,238,0.16),transparent_30rem),#030712]"
      />
    )
  }
);

const features = [
  { title: "WhatsApp Inbox", text: "Live tenant rooms, agent assignment, notes, labels, and AI suggestions.", icon: Inbox },
  { title: "Bulk Campaigns", text: "Template selection, CSV import, scheduling, retries, and rate aware sending.", icon: Megaphone },
  { title: "Click-to-WhatsApp Ads", text: "UTM attribution from ad click to conversation, lead score, and ROI.", icon: MousePointerClick },
  { title: "AI Workflow Builder", text: "Trigger, branch, score, reply, tag, handoff, delay, and webhook actions.", icon: Workflow },
  { title: "Lead Segmentation", text: "Build hot, warm, dormant, source, intent, and campaign audiences.", icon: Users },
  { title: "Human Takeover", text: "Pause automation instantly and route complex conversations to agents.", icon: UserCheck },
  { title: "Delivery Tracking", text: "Sent, delivered, read, replied, and failed state updates in real time.", icon: Send },
  { title: "Analytics", text: "Campaign, inbox, ads, revenue, and automation performance in one board.", icon: BarChart3 }
];

const security = [
  { title: "Multi-tenant isolation", icon: DatabaseZap },
  { title: "Encrypted Meta tokens", icon: KeyRound },
  { title: "Webhook signature verification", icon: ShieldCheck },
  { title: "RBAC roles", icon: LockKeyhole },
  { title: "Audit logs", icon: FileText },
  { title: "Rate limiting", icon: Gauge },
  { title: "Queue-based sending", icon: Route },
  { title: "Secure env handling", icon: Layers3 }
];

const navLinks = ["Inbox", "Campaigns", "Automation"];

const metrics = [
  ["Total conversations", "28,492", "+18.4%"],
  ["Active campaigns", "42", "12 live"],
  ["Messages sent", "1.8M", "+31%"],
  ["Delivery rate", "98.2%", "healthy"],
  ["Hot leads", "846", "+96 today"],
  ["Human takeover", "37", "8 urgent"],
  ["Revenue tracked", "$128k", "placeholder"]
];

const campaigns = [
  ["Festive winback", "running", "12,840", "97%", "31%", "Warm audience", "coupon_reminder_v2"],
  ["Lead magnet follow-up", "scheduled", "6,210", "99%", "18%", "New ad leads", "guide_delivery"],
  ["Dormant buyers", "paused", "18,402", "94%", "12%", "90-day inactive", "reorder_prompt"],
  ["VIP drop", "completed", "3,760", "98%", "44%", "High LTV", "early_access"]
];

function FadeIn({
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
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.75, ease: [0.21, 1, 0.21, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

function SectionHeader({
  kicker,
  title,
  text,
  align = "center"
}: {
  kicker: string;
  title: string;
  text: string;
  align?: "center" | "left";
}) {
  return (
    <FadeIn
      className={cn(
        "mx-auto max-w-3xl",
        align === "center" ? "text-center" : "mx-0 text-left"
      )}
    >
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/80">
        {kicker}
      </p>
      <h2 className="text-balance text-3xl font-semibold leading-tight text-white sm:text-5xl">
        {title}
      </h2>
      <p className="mt-5 text-pretty text-base leading-8 text-slate-300 sm:text-lg">
        {text}
      </p>
    </FadeIn>
  );
}

function Navbar() {
  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[#030712]/70 backdrop-blur-2xl">
      <nav className="section-shell flex h-16 items-center justify-between">
        <a href="#hero" className="flex items-center gap-3" aria-label="WhatsApp AI CRM OS home">
          <span className="grid h-9 w-9 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 shadow-glow">
            <MessageCircle className="h-4 w-4 text-cyan-200" />
          </span>
          <span className="text-sm font-semibold text-white sm:text-base">CRM OS</span>
        </a>
        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase()}`}
              className="rounded-full px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
            >
              {link}
            </a>
          ))}
        </div>
        <Link href="/login" className={buttonVariants({ size: "sm" })}>
          Start Free
        </Link>
      </nav>
    </header>
  );
}

function DashboardPreview() {
  return (
    <div className="glass-panel animated-border rounded-[28px] p-3 sm:p-4">
      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-slate-950/72">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
          </div>
          <div className="flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
            <Radio className="h-3.5 w-3.5" />
            Live operations
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-12 sm:p-5">
          <div className="sm:col-span-8">
            <div className="grid gap-3 sm:grid-cols-3">
              {metrics.slice(0, 6).map(([label, value, change]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                >
                  <p className="text-xs text-slate-400">{label}</p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <span className="text-xl font-semibold text-white">{value}</span>
                    <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] font-medium text-cyan-100">
                      {change}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Campaign performance</p>
                  <p className="text-xs text-slate-400">Delivered, read, replied, ordered</p>
                </div>
                <Sparkles className="h-4 w-4 text-cyan-200" />
              </div>
              <div className="flex h-36 items-end gap-2">
                {Array.from({ length: 28 }).map((_, index) => (
                  <span
                    key={index}
                    className="w-full rounded-t-full bg-gradient-to-t from-blue-600/30 via-cyan-300/70 to-white shadow-[0_0_18px_rgba(34,211,238,0.22)]"
                    style={{
                      height: `${26 + Math.sin(index * 0.75) * 18 + (index % 7) * 7}%`,
                      opacity: 0.48 + (index % 5) * 0.08
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 sm:col-span-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">AI inbox pulse</p>
                <p className="text-xs text-slate-400">Suggested replies and routing</p>
              </div>
              <Bot className="h-5 w-5 text-cyan-200" />
            </div>
            <div className="mt-5 space-y-3">
              {["New ad lead asking price", "Template delivered to VIP list", "Agent takeover requested", "Payment intent detected"].map(
                (item, index) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/58 p-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-cyan-300/10 text-xs font-semibold text-cyan-100">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{item}</p>
                      <p className="text-xs text-slate-400">{index + 3} min ago</p>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowPreview() {
  const nodes = [
    ["Incoming Message Trigger", MessageCircle, "Any WhatsApp message"],
    ["Keyword Condition", GitBranch, "Price, catalog, support"],
    ["AI Intent Detection", BrainCircuit, "Buying intent high"],
    ["Send WhatsApp Template", Send, "Approved offer template"],
    ["Assign Label", Tag, "hot lead"],
    ["Human Handoff", UserCheck, "Route to sales"],
    ["Webhook", Globe2, "Sync CRM event"]
  ];

  return (
    <div className="glass-panel rounded-[28px] p-5 sm:p-6">
      <div className="grid gap-4 md:grid-cols-7">
        {nodes.map(([label, Icon, detail], index) => {
          const NodeIcon = Icon as typeof MessageCircle;
          return (
            <div key={label as string} className="relative">
              {index < nodes.length - 1 && (
                <span className="absolute left-[calc(100%-4px)] top-10 hidden h-px w-8 origin-left animate-pulseLine bg-gradient-to-r from-cyan-300 to-blue-500 md:block" />
              )}
              <div className="min-h-40 rounded-2xl border border-white/10 bg-slate-950/62 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="mb-5 grid h-10 w-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                  <NodeIcon className="h-5 w-5 text-cyan-100" />
                </div>
                <p className="text-sm font-semibold leading-5 text-white">{label as string}</p>
                <p className="mt-2 text-xs leading-5 text-slate-400">{detail as string}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InboxPreview() {
  const conversations = [
    ["Aarav Mehta", "Can you send the bulk pricing?", "hot", "3"],
    ["Mira Patel", "Need delivery before Friday", "warm", "1"],
    ["Nora Ali", "Is this still available?", "hot", "2"],
    ["Rohan Shah", "Please remove me", "scrap", ""]
  ];

  return (
    <div className="grid overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70 shadow-glow md:grid-cols-[0.9fr_1.35fr_0.82fr]">
      <div className="border-b border-white/10 p-4 md:border-b-0 md:border-r">
        <div className="mb-4 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-400">Search contacts</span>
        </div>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {["all", "unread", "assigned", "hot", "human"].map((filter) => (
            <span key={filter} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300">
              {filter}
            </span>
          ))}
        </div>
        <div className="space-y-2">
          {conversations.map(([name, message, label, unread], index) => (
            <div
              key={name}
              className={cn(
                "rounded-2xl border p-3",
                index === 0 ? "border-cyan-300/30 bg-cyan-300/10" : "border-white/10 bg-white/[0.035]"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-white">{name}</p>
                {unread && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-cyan-300 px-1 text-xs font-bold text-slate-950">
                    {unread}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-sm text-slate-400">{message}</p>
              <span className={cn("mt-3 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold", label === "hot" ? "bg-cyan-300/15 text-cyan-100" : label === "warm" ? "bg-amber-300/15 text-amber-100" : "bg-slate-500/20 text-slate-300")}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-h-[520px] flex-col border-b border-white/10 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div>
            <p className="font-semibold text-white">Aarav Mehta</p>
            <p className="text-xs text-cyan-100">Live message indicator active</p>
          </div>
          <Button size="sm" variant="secondary">
            Assign agent
          </Button>
        </div>
        <div className="flex-1 space-y-4 p-5">
          <div className="max-w-[78%] rounded-3xl rounded-bl-md bg-white/[0.07] p-4 text-sm leading-6 text-slate-100">
            Hi, I clicked your WhatsApp ad. Can you send the bulk pricing?
            <p className="mt-2 text-[10px] text-slate-400">read</p>
          </div>
          <div className="ml-auto max-w-[78%] rounded-3xl rounded-br-md bg-cyan-300 p-4 text-sm leading-6 text-slate-950">
            Absolutely. Which quantity range should I quote for you?
            <p className="mt-2 text-right text-[10px] text-slate-700">delivered</p>
          </div>
          <div className="max-w-[78%] rounded-3xl rounded-bl-md bg-white/[0.07] p-4 text-sm leading-6 text-slate-100">
            Around 500 units for next month.
            <p className="mt-2 text-[10px] text-slate-400">typing now</p>
          </div>
        </div>
        <div className="border-t border-white/10 p-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 sm:flex-row sm:items-center">
            <span className="flex-1 text-sm text-slate-400">Type a manual reply...</span>
            <Button size="sm" variant="secondary">
              AI suggested reply
            </Button>
            <Button size="sm">
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
        </div>
      </div>
      <div className="p-4">
        <p className="mb-4 text-sm font-semibold text-white">Contact details</p>
        <div className="space-y-3 text-sm">
          {[
            ["Lead score", "91"],
            ["Source", "Meta ad / summer_offer"],
            ["Owner", "Priya"],
            ["Status", "Human takeover on"]
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="mt-1 text-white">{value}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <p className="text-xs text-slate-400">Internal notes</p>
            <p className="mt-2 text-sm leading-6 text-slate-200">Ask for delivery city before quoting freight.</p>
          </div>
          <Button variant="secondary" className="w-full">
            Mark resolved
          </Button>
        </div>
      </div>
    </div>
  );
}

function CampaignsPreview() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {campaigns.map(([name, status, sent, delivered, replied, segment, template]) => (
        <div key={name} className="glass-panel rounded-[24px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-white">{name}</p>
              <p className="mt-1 text-sm text-slate-400">{segment} · {template}</p>
            </div>
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
              {status}
            </span>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-3 text-sm">
            {[
              ["sent", sent],
              ["delivered", delivered],
              ["replied", replied],
              ["failed", "0.8%"]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-1 font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Next slot 09:30
            </span>
            <Button size="sm" variant="secondary">
              Launch campaign
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdsPreview() {
  return (
    <div className="grid gap-5 lg:grid-cols-[0.88fr_1.12fr]">
      <div className="glass-panel rounded-[28px] p-6">
        <SectionHeader
          kicker="Ad attribution"
          title="Know which ad became a conversation"
          text="Tie click-to-WhatsApp campaigns to source, UTM, cost per lead, revenue intent, and agent outcomes."
          align="left"
        />
        <div className="mt-8 space-y-3">
          {["Meta lead ad", "Instagram story", "Catalog retargeting", "Influencer UTM"].map((source, index) => (
            <div key={source} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <span className="flex items-center gap-3 text-sm text-white">
                <span className="grid h-9 w-9 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-100">
                  <MousePointerClick className="h-4 w-4" />
                </span>
                {source}
              </span>
              <span className="text-sm text-cyan-100">{index === 0 ? "$4.20 CPL" : `${(index + 1) * 14}% ROI`}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="glass-panel rounded-[28px] p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xl font-semibold text-white">Ad to conversation tracking</p>
            <p className="mt-2 text-sm text-slate-400">UTM, source, lead score, reply time, and won revenue.</p>
          </div>
          <SlidersHorizontal className="h-5 w-5 text-cyan-200" />
        </div>
        <div className="mt-8 h-72 rounded-3xl border border-white/10 bg-slate-950/58 p-5">
          <div className="grid h-full grid-cols-5 items-end gap-3">
            {[56, 82, 48, 91, 68, 74, 42, 88, 62, 96].map((height, index) => (
              <span
                key={index}
                className="rounded-t-full bg-gradient-to-t from-blue-700/35 via-cyan-300/80 to-white"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <main id="hero" className="relative min-h-screen overflow-hidden bg-[#030712] text-white">
      <ScrollOrbScene />
      <div className="grid-mask pointer-events-none fixed inset-0 z-[1] opacity-50" />
      <Navbar />

      <section className="section-shell relative z-10 flex min-h-screen flex-col justify-center pb-16 pt-28">
        <div className="mx-auto max-w-5xl text-center">
          <FadeIn>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100 shadow-glow">
              <Sparkles className="h-4 w-4" />
              Multi-tenant WhatsApp AI CRM for serious operators
            </div>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h1 className="text-balance text-5xl font-semibold leading-[0.98] text-white sm:text-7xl lg:text-8xl">
              Turn WhatsApp Conversations Into Customers
            </h1>
          </FadeIn>
          <FadeIn delay={0.16}>
            <p className="mx-auto mt-7 max-w-3xl text-pretty text-lg leading-8 text-slate-300 sm:text-xl">
              Run ads, automate campaigns, manage inboxes, and build AI workflows from one powerful WhatsApp CRM.
            </p>
          </FadeIn>
          <FadeIn delay={0.24} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className={buttonVariants({ size: "lg" })}>
              Start Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Button size="lg" variant="secondary">
              View Demo
            </Button>
          </FadeIn>
        </div>
        <FadeIn delay={0.28} className="mt-14">
          <DashboardPreview />
        </FadeIn>
      </section>

      <section id="dashboard" className="section-shell relative z-10 py-24 sm:py-32">
        <SectionHeader
          kicker="Command center"
          title="Everything your growth, inbox, and automation teams need on one glass board"
          text="Track conversations, campaign velocity, hot leads, human takeover, delivery health, and placeholder revenue in a dashboard built for repeated daily use."
        />
        <FadeIn className="mt-12">
          <div className="grid gap-4 md:grid-cols-3">
            {metrics.map(([label, value, change]) => (
              <div key={label} className="glass-panel rounded-[24px] p-6">
                <p className="text-sm text-slate-400">{label}</p>
                <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
                <p className="mt-3 text-sm text-cyan-100">{change}</p>
              </div>
            ))}
          </div>
        </FadeIn>
      </section>

      <section id="features" className="section-shell relative z-10 py-24 sm:py-32">
        <SectionHeader
          kicker="Product modules"
          title="One system for inbox, campaigns, ads, AI flows, and reporting"
          text="Every module is designed for tenant-aware teams that need speed, visibility, and secure control over WhatsApp operations."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ title, text, icon: Icon }, index) => (
            <FadeIn key={title} delay={index * 0.035}>
              <div className="glass-panel group min-h-60 rounded-[24px] p-5 transition duration-300 hover:-translate-y-1 hover:border-cyan-300/30">
                <div className="mb-8 grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 shadow-glow transition group-hover:scale-105">
                  <Icon className="h-5 w-5 text-cyan-100" />
                </div>
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{text}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      <section id="automation" className="section-shell relative z-10 py-24 sm:py-32">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <SectionHeader
            kicker="AI workflow builder"
            title="Connect triggers, AI decisions, WhatsApp actions, and handoffs"
            text="Build the logic that runs after every incoming message, from keyword routing to AI intent detection and safe human takeover."
            align="left"
          />
          <FadeIn>
            <WorkflowPreview />
          </FadeIn>
        </div>
      </section>

      <section id="security" className="section-shell relative z-10 py-24 sm:py-32">
        <SectionHeader
          kicker="Security foundation"
          title="Built for multi-tenant WhatsApp operations"
          text="The platform model keeps tenant data isolated, sensitive tokens encrypted, webhooks verified, and high-volume sends controlled by queues and limits."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {security.map(({ title, icon: Icon }, index) => (
            <FadeIn key={title} delay={index * 0.035}>
              <div className="glass-panel flex min-h-36 flex-col justify-between rounded-[24px] p-5">
                <Icon className="h-6 w-6 text-cyan-100" />
                <p className="mt-8 text-base font-semibold text-white">{title}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      <section id="inbox" className="section-shell relative z-10 py-24 sm:py-32">
        <SectionHeader
          kicker="AiSensy-like inbox"
          title="Live WhatsApp conversations without polling or page resets"
          text="Search, filter, assign, note, reply manually, accept AI suggestions, switch on human takeover, and watch message statuses update in place."
        />
        <FadeIn className="mt-12">
          <InboxPreview />
        </FadeIn>
      </section>

      <section id="campaigns" className="section-shell relative z-10 py-24 sm:py-32">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeader
            kicker="Campaigns"
            title="Bulk WhatsApp campaigns with delivery intelligence"
            text="Import audiences, pick approved templates, schedule sends, retry failed jobs, and watch campaign analytics as delivery events arrive."
            align="left"
          />
          <Button className="w-full md:w-auto">
            Launch campaign
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <CampaignsPreview />
      </section>

      <section id="ads" className="section-shell relative z-10 py-24 sm:py-32">
        <AdsPreview />
      </section>

      <section className="section-shell relative z-10 py-24 sm:py-32">
        <div className="glass-panel animated-border overflow-hidden rounded-[32px] p-8 sm:p-12 lg:p-16">
          <div className="relative z-10 max-w-2xl">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/80">
              Final CTA
            </p>
            <h2 className="text-balance text-4xl font-semibold leading-tight text-white sm:text-6xl">
              Launch your WhatsApp AI CRM
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Build the operating system for ads, inbox, broadcasts, campaigns, templates, workflows, and analytics.
            </p>
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "mt-9")}>
              Start Free
              <Zap className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
