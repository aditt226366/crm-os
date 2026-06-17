import { Lock, Server, ShieldCheck } from "lucide-react";
import { GlassCard } from "@/components/shared/GlassCard";

export function SettingsPage() {
  const items = [
    {
      icon: ShieldCheck,
      title: "Secure session policy",
      body: "Access tokens are short-lived, refresh tokens rotate, and auth cookies are httpOnly."
    },
    {
      icon: Lock,
      title: "Secret handling",
      body: "Integration tokens are encrypted at rest and never returned to the frontend."
    },
    {
      icon: Server,
      title: "Feature enforcement",
      body: "Workspace navigation and backend API routes share the same tenant feature gates."
    }
  ];

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm uppercase tracking-[0.26em] text-cyan-200/80">Settings</p>
        <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">Control plane settings</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Production settings will expand here as the platform grows into full WhatsApp CRM operations.
        </p>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {items.map(({ icon: Icon, title, body }) => (
          <GlassCard key={title} className="p-5">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
          </GlassCard>
        ))}
      </section>
    </div>
  );
}

