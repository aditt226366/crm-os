"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  CheckCheck,
  Clock,
  FileText,
  MessageSquarePlus,
  Paperclip,
  Search,
  Send,
  Smile,
  UserRoundCheck,
  Users
} from "lucide-react";
import { FeatureGuard } from "@/components/app/FeatureGuard";
import { GlassCard } from "@/components/shared/GlassCard";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { NeonButton } from "@/components/shared/NeonButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { isMetaDeliveryLimitError } from "@/lib/meta-delivery-limit";
import { cn } from "@/lib/utils";

type Conversation = {
  id: string;
  contactId: string;
  assignedUserId: string | null;
  source: string;
  sourceId: string | null;
  status: string;
  unreadCount: number;
  humanTakeover: boolean;
  customerReplyCount: number;
  totalMessageCount: number;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  customerServiceWindowExpiresAt: string | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    optIn: boolean;
    optOut: boolean;
    tags: string[];
    leadTemperature: string;
    leadTemperatureOverride: string | null;
    leadTemperatureOverrideReason: string | null;
    customerReplyCount: number;
    totalMessageCount: number;
    lastMessageAt: string | null;
    lastContactedAt: string | null;
  };
  humanQueue: { id: string; status: string; priority: number; reason: string } | null;
  order: { id: string; status: string; orderNumber: string } | null;
};

type Message = {
  id: string;
  conversationId: string;
  contactId: string;
  direction: string;
  type: string;
  body: string;
  templateId: string | null;
  whatsappMessageId: string | null;
  status: string;
  failureReason: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

type Template = {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  body: string;
};

const filters = [
  ["all", "All"],
  ["unread", "Unread"],
  ["assigned", "Assigned to me"],
  ["hot", "Hot"],
  ["warm", "Warm"],
  ["scrap", "Scrap"],
  ["human-queue", "Human Queue"],
  ["orders", "Orders"],
  ["broadcast", "Broadcast"],
  ["campaign", "Campaign"],
  ["ads", "Ads"]
] as const;

type InboxFilter = (typeof filters)[number][0];

const confirmedOrderStatuses = new Set(["CONFIRMED", "DISPATCHED", "COMPLETED"]);

function relativeTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return date.toLocaleDateString();
}

function sortConversations(rows: Conversation[]) {
  return [...rows].sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });
}

function upsertConversation(rows: Conversation[], incoming: Conversation) {
  return sortConversations([incoming, ...rows.filter((row) => row.id !== incoming.id)]);
}

function upsertMessage(rows: Message[], incoming: Message) {
  if (rows.some((row) => row.id === incoming.id)) {
    return rows.map((row) => (row.id === incoming.id ? incoming : row));
  }
  return [...rows, incoming].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function conversationMessageCount(conversation: Conversation) {
  return conversation.totalMessageCount || conversation.contact.totalMessageCount || 0;
}

function matchesActiveFilter(conversation: Conversation, filter: string) {
  const messageCount = conversationMessageCount(conversation);
  if (filter === "all") return true;
  if (filter === "unread") return conversation.unreadCount > 0;
  if (filter === "hot") return messageCount >= 6;
  if (filter === "warm") return messageCount >= 2 && messageCount <= 5;
  if (filter === "scrap") return messageCount <= 2;
  if (filter === "human-queue") return conversation.humanTakeover || Boolean(conversation.humanQueue);
  if (filter === "orders") return Boolean(conversation.order && confirmedOrderStatuses.has(conversation.order.status));
  if (filter === "broadcast") return conversation.source === "BROADCAST";
  if (filter === "campaign") return conversation.source === "CAMPAIGN";
  if (filter === "ads") return conversation.source === "AD";
  return true;
}

function messageDisplayStatus(message: Message) {
  const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
    ? (message.metadata as Record<string, unknown>)
    : {};
  const deliveryLimit = metadata.metaDeliveryLimit && typeof metadata.metaDeliveryLimit === "object"
    ? (metadata.metaDeliveryLimit as Record<string, unknown>)
    : null;
  return deliveryLimit?.status === "META_DELIVERY_LIMITED" || isMetaDeliveryLimitError(message.failureReason)
    ? "META_DELIVERY_LIMITED"
    : message.status;
}

function messageStatusIcon(message: Message) {
  const status = messageDisplayStatus(message);
  if (status === "READ") return <CheckCheck className="h-3.5 w-3.5 text-cyan-100" />;
  if (status === "DELIVERED") return <CheckCheck className="h-3.5 w-3.5 text-slate-400" />;
  if (status === "SENT") return <Check className="h-3.5 w-3.5 text-slate-400" />;
  if (status === "META_DELIVERY_LIMITED") return <span className="text-[10px] font-semibold text-amber-100">Meta delivery-limited</span>;
  if (status === "FAILED") return <span className="text-[10px] font-semibold text-rose-200">failed</span>;
  return <Clock className="h-3.5 w-3.5 text-slate-500" />;
}

function ConversationRow({
  conversation,
  active,
  onSelect
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-2xl border p-3 text-left transition",
        active
          ? "border-cyan-300/35 bg-cyan-300/[0.10] shadow-glow"
          : "border-white/10 bg-white/[0.035] hover:border-cyan-300/25 hover:bg-white/[0.055]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{conversation.contact.name}</p>
          <p className="truncate text-xs text-slate-500">{conversation.contact.phone}</p>
        </div>
        <span className="shrink-0 text-xs text-slate-500">{relativeTime(conversation.lastMessageAt)}</span>
      </div>
      <p className="mt-2 line-clamp-1 text-sm text-slate-400">{conversation.lastMessageText ?? "No messages yet"}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge value={conversation.contact.leadTemperature} />
        <StatusBadge value={conversation.source} />
        <StatusBadge value={conversation.status} />
        {conversation.unreadCount ? (
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-cyan-300 px-2 text-xs font-bold text-slate-950">
            {conversation.unreadCount}
          </span>
        ) : null}
        {conversation.humanTakeover ? <StatusBadge value="HUMAN" /> : null}
      </div>
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.type === "NOTE") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-center text-xs text-amber-100">
        Internal note: {message.body}
      </div>
    );
  }

  const outgoing = message.direction === "OUTBOUND";
  return (
    <div className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-xl",
          outgoing
            ? "rounded-br-md border border-cyan-300/20 bg-cyan-300/15 text-cyan-50"
            : "rounded-bl-md border border-white/10 bg-white/[0.065] text-slate-100",
          message.type === "TEMPLATE" ? "border-blue-300/30 bg-blue-300/10" : ""
        )}
      >
        {message.type === "TEMPLATE" ? (
          <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-100">
            <FileText className="h-3 w-3" />
            Template
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <div className={cn("mt-2 flex items-center gap-2 text-[11px]", outgoing ? "justify-end text-cyan-100/70" : "text-slate-500")}>
          <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {outgoing ? messageStatusIcon(message) : null}
        </div>
      </div>
    </div>
  );
}

function Composer({
  selected,
  templates,
  disabled,
  onSend,
  onTemplate,
  onResolve,
  onHumanTakeover
}: {
  selected: Conversation | null;
  templates: Template[];
  disabled: boolean;
  onSend: (body: string) => Promise<void>;
  onTemplate: (template: Template) => Promise<void>;
  onResolve: () => Promise<void>;
  onHumanTakeover: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    if (!body.trim() || disabled) return;
    setSending(true);
    try {
      await onSend(body.trim());
      setBody("");
    } finally {
      setSending(false);
    }
  }

  const firstTemplate = templates.find((template) => template.status === "APPROVED");

  return (
    <div className="border-t border-white/10 bg-slate-950/72 p-3">
      {disabled ? (
        <div className="mb-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          24-hour window closed. Use an approved template to message this contact.
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
          <Bot className="mr-1 inline h-3.5 w-3.5" />
          AI suggested reply
        </button>
        <button
          type="button"
          onClick={() => firstTemplate && onTemplate(firstTemplate)}
          disabled={!firstTemplate}
          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300 disabled:opacity-40"
        >
          <FileText className="mr-1 inline h-3.5 w-3.5" />
          Use approved template
        </button>
        <button type="button" onClick={onResolve} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
          Mark resolved
        </button>
        <button type="button" onClick={onHumanTakeover} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
          Assign to human
        </button>
      </div>
      <div className="flex items-end gap-2 rounded-[24px] border border-white/10 bg-white/[0.04] p-2">
        <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-400">
          <Smile className="h-4 w-4" />
        </button>
        <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-400">
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={!selected || disabled || sending}
          placeholder={selected ? "Type a manual reply..." : "Select a conversation"}
          className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-slate-600 disabled:cursor-not-allowed"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <NeonButton size="sm" loading={sending} disabled={!body.trim() || disabled} onClick={submit}>
          <Send className="h-4 w-4" />
        </NeonButton>
      </div>
    </div>
  );
}

function ContactPanel({
  selected,
  onAddNote
}: {
  selected: Conversation | null;
  onAddNote: (body: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");

  if (!selected) {
    return (
      <GlassCard className="hidden h-full p-5 xl:block">
        <p className="text-sm text-slate-500">Select a conversation to inspect contact details.</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="hidden h-full min-h-0 flex-col overflow-hidden xl:flex">
      <div className="shrink-0 border-b border-white/10 p-5">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-lg font-semibold text-cyan-100">
          {selected.contact.name.slice(0, 2).toUpperCase()}
        </div>
        <h2 className="mt-4 text-xl font-semibold text-white">{selected.contact.name}</h2>
        <p className="mt-1 text-sm text-slate-500">{selected.contact.phone}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge value={selected.contact.leadTemperature} />
          <StatusBadge value={selected.source} />
          {selected.contact.leadTemperatureOverride ? <StatusBadge value="MANUAL OVERRIDE" /> : null}
        </div>
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Engagement</p>
          <p className="mt-3 text-sm text-slate-300">Inbound replies: {selected.customerReplyCount}</p>
          <p className="mt-1 text-sm text-slate-300">Total messages: {selected.totalMessageCount}</p>
          <p className="mt-1 text-sm text-slate-300">Status: {selected.status}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Compliance</p>
          <p className="mt-3 text-sm text-slate-300">Opt in: {selected.contact.optIn ? "Yes" : "No"}</p>
          <p className="mt-1 text-sm text-slate-300">Opt out: {selected.contact.optOut ? "Yes" : "No"}</p>
          <p className="mt-1 text-sm text-slate-300">
            Window: {selected.customerServiceWindowExpiresAt ? new Date(selected.customerServiceWindowExpiresAt).toLocaleString() : "Closed"}
          </p>
        </div>
        {selected.order ? (
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">Linked order</p>
            <p className="mt-2 font-semibold text-white">{selected.order.orderNumber}</p>
            <StatusBadge value={selected.order.status} className="mt-3" />
          </div>
        ) : null}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <p className="text-sm font-semibold text-white">Internal note</p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a private note..."
            className="mt-3 min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-white outline-none placeholder:text-slate-600"
          />
          <NeonButton
            size="sm"
            className="mt-3"
            disabled={!note.trim()}
            onClick={async () => {
              await onAddNote(note.trim());
              setNote("");
            }}
          >
            <MessageSquarePlus className="h-4 w-4" />
            Add note
          </NeonButton>
        </div>
      </div>
    </GlassCard>
  );
}

export function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [query, setQuery] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId]
  );
  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => matchesActiveFilter(conversation, filter)),
    [conversations, filter]
  );

  const serviceWindowClosed = useMemo(() => {
    if (!selected?.customerServiceWindowExpiresAt) return true;
    return new Date(selected.customerServiceWindowExpiresAt) < new Date();
  }, [selected]);

  const loadConversations = useCallback(async (nextSelectedId?: string | null) => {
    setLoadingList(true);
    try {
      const response = await fetch(`/api/app/inbox/conversations?filter=${filter}&q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Unable to load conversations");
      const data = (await response.json()) as { conversations: Conversation[] };
      setConversations(data.conversations);
      setSelectedId((current) => {
        const preferred = nextSelectedId ?? current;
        if (preferred && data.conversations.some((conversation) => conversation.id === preferred)) {
          return preferred;
        }
        return data.conversations[0]?.id ?? null;
      });
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Unable to load conversations");
    } finally {
      setLoadingList(false);
    }
  }, [filter, query]);

  const loadConversation = useCallback(async (conversationId: string) => {
    setLoadingThread(true);
    try {
      const response = await fetch(`/api/app/inbox/conversations/${conversationId}`);
      if (!response.ok) throw new Error("Unable to load conversation");
      const data = (await response.json()) as { conversation: Conversation; messages: Message[] };
      setConversations((current) => upsertConversation(current, data.conversation));
      setMessages(data.messages);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 0);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Unable to load conversation");
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => loadConversations(), 180);
    return () => clearTimeout(timeout);
  }, [loadConversations]);

  useEffect(() => {
    fetch("/api/app/templates")
      .then((response) => (response.ok ? response.json() : { templates: [] }))
      .then((data: { templates: Template[] }) => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    const selectedConversationId = selectedId;
    if (selectedConversationId) {
      const timeout = setTimeout(() => loadConversation(selectedConversationId), 0);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => setMessages([]), 0);
      return () => clearTimeout(timeout);
    }
  }, [loadConversation, selectedId]);

  useEffect(() => {
    const events = new EventSource("/api/app/inbox/events");
    events.addEventListener("message.created", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { payload: { conversation: Conversation; message: Message } };
      setConversations((current) => upsertConversation(current, data.payload.conversation));
      setMessages((current) =>
        data.payload.message.conversationId === selectedId ? upsertMessage(current, data.payload.message) : current
      );
      if (data.payload.message.conversationId === selectedId && data.payload.message.direction === "INBOUND") {
        void loadConversation(selectedId);
      }
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 0);
    });
    events.addEventListener("conversation.updated", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { payload: Conversation };
      setConversations((current) => upsertConversation(current, data.payload));
    });
    events.addEventListener("message.status.updated", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { payload: Message };
      setMessages((current) => current.map((message) => (message.id === data.payload.id ? data.payload : message)));
    });
    return () => events.close();
  }, [loadConversation, selectedId]);

  async function postAction(path: string, payload?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message ?? "Action failed");
    }
    return data as { conversation?: Conversation; message?: Message };
  }

  async function sendReply(body: string) {
    if (!selected) return;
    try {
      const data = await postAction(`/api/app/inbox/conversations/${selected.id}/reply`, { body });
      if (data.conversation) setConversations((current) => upsertConversation(current, data.conversation!));
      if (data.message) setMessages((current) => upsertMessage(current, data.message!));
      setNotice("Reply queued for WhatsApp delivery.");
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : "Reply failed");
    }
  }

  async function sendTemplate(template: Template) {
    if (!selected) return;
    try {
      const data = await postAction(`/api/app/inbox/conversations/${selected.id}/template-reply`, {
        templateId: template.id,
        body: template.body
      });
      if (data.conversation) setConversations((current) => upsertConversation(current, data.conversation!));
      if (data.message) setMessages((current) => upsertMessage(current, data.message!));
      setNotice(`Template ${template.name} queued.`);
    } catch (templateError) {
      setError(templateError instanceof Error ? templateError.message : "Template send failed");
    }
  }

  async function resolveConversation() {
    if (!selected) return;
    const data = await postAction(`/api/app/inbox/conversations/${selected.id}/resolve`);
    if (data.conversation) setConversations((current) => upsertConversation(current, data.conversation!));
    setNotice("Conversation marked resolved.");
  }

  async function humanTakeover() {
    if (!selected) return;
    const data = await postAction(`/api/app/inbox/conversations/${selected.id}/human-takeover`, {
      enabled: true,
      reason: "Agent requested takeover from inbox"
    });
    if (data.conversation) setConversations((current) => upsertConversation(current, data.conversation!));
    setNotice("Conversation added to Human Queue.");
  }

  async function addNote(body: string) {
    if (!selected) return;
    const data = await postAction(`/api/app/inbox/conversations/${selected.id}/notes`, { body });
    if (data.message) setMessages((current) => upsertMessage(current, data.message!));
    if (data.conversation) setConversations((current) => upsertConversation(current, data.conversation!));
    setNotice("Internal note added.");
  }

  return (
    <FeatureGuard featureKey="INBOX">
      <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col gap-4 overflow-hidden">
        <div className="shrink-0 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">Inbox</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Realtime WhatsApp conversations</h1>
          </div>
          <div className="flex items-center gap-2">
            {notice ? <StatusBadge value={notice} /> : null}
            {error ? <StatusBadge value={error} /> : null}
          </div>
        </div>

        <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)_21rem]">
          <GlassCard className="flex min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-white/10 p-4">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search conversations"
                  className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-slate-600"
                />
              </div>
              <div className="custom-scrollbar mt-3 flex gap-2 overflow-x-auto whitespace-nowrap pb-2">
                {filters.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition",
                      filter === value
                        ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
                        : "border-white/10 bg-white/[0.04] text-slate-400 hover:text-white"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
              {loadingList ? (
                <LoadingSkeleton rows={8} />
              ) : visibleConversations.length ? (
                <div className="space-y-2">
                  {visibleConversations.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      active={conversation.id === selectedId}
                      onSelect={() => setSelectedId(conversation.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-slate-400">
                  No conversations match this filter yet.
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard className="flex min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-white/10 p-4">
              {selected ? (
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold text-white">{selected.contact.name}</h2>
                    <StatusBadge value={selected.contact.leadTemperature} />
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {selected.contact.phone} | {selected.source} | {selected.customerReplyCount} inbound replies
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Select a conversation</p>
              )}
              {selected?.humanTakeover ? <StatusBadge value="HUMAN TAKEOVER" /> : null}
            </div>

            <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-950/30 p-4">
              {loadingThread ? (
                <LoadingSkeleton rows={8} />
              ) : messages.length ? (
                messages.map((message) => <MessageBubble key={message.id} message={message} />)
              ) : (
                <div className="grid h-full place-items-center text-center text-sm text-slate-500">
                  <div>
                    <Users className="mx-auto mb-3 h-8 w-8 text-cyan-100/50" />
                    Select a conversation to see WhatsApp-style history.
                  </div>
                </div>
              )}
            </div>

            <Composer
              selected={selected}
              templates={templates}
              disabled={serviceWindowClosed}
              onSend={sendReply}
              onTemplate={sendTemplate}
              onResolve={resolveConversation}
              onHumanTakeover={humanTakeover}
            />
          </GlassCard>

          <ContactPanel selected={selected} onAddNote={addNote} />
        </section>
      </div>
    </FeatureGuard>
  );
}
