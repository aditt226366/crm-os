"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { WaMark } from "@/components/site/WaMark";
import { ThemeProvider, ThemeToggle } from "@/components/site/theme";

type Fields = {
  name: string;
  companyName: string;
  email: string;
  contact: string;
  country: string;
  gstNumber: string;
};

const empty: Fields = {
  name: "",
  companyName: "",
  email: "",
  contact: "",
  country: "",
  gstNumber: ""
};

const fieldMeta: Array<{
  key: keyof Fields;
  label: string;
  type?: string;
  placeholder: string;
  required: boolean;
  autoComplete?: string;
}> = [
  { key: "name", label: "Full name", placeholder: "Jane Doe", required: true, autoComplete: "name" },
  { key: "companyName", label: "Company name", placeholder: "Acme Pvt Ltd", required: true, autoComplete: "organization" },
  { key: "email", label: "Work email", type: "email", placeholder: "jane@acme.com", required: true, autoComplete: "email" },
  { key: "contact", label: "Contact number", placeholder: "+91 98765 43210", required: true, autoComplete: "tel" },
  { key: "country", label: "Country", placeholder: "India", required: true, autoComplete: "country-name" },
  { key: "gstNumber", label: "GST number", placeholder: "22AAAAA0000A1Z5 (optional)", required: false }
];

const inputClass =
  "h-11 w-full rounded-lg border border-neutral-300 bg-white px-3.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20";

export function RequestDemoForm() {
  const [fields, setFields] = useState<Fields>(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function update(key: keyof Fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: { message?: string } }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "We couldn't submit your request. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ThemeProvider>
    <main className="theme-light relative min-h-screen w-full overflow-hidden bg-white text-neutral-900">
      <div className="wa-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      <ThemeToggle />
      <header className="relative">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <WaMark className="h-8 w-8" />
            <span className="text-[15px] font-semibold tracking-tight text-neutral-900">WhatsApp-OS</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </header>

      <section className="relative mx-auto w-full max-w-3xl px-6 py-16">
        {done ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-wa-green/15 text-wa-accent">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <h1 className="mt-6 text-2xl font-medium tracking-tight text-neutral-900">Thanks — request received</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-600">
              Our team will reach out to {fields.email || "you"} shortly to schedule your WhatsApp-OS demo.
            </p>
            <Link
              href="/"
              className="mt-8 inline-flex rounded-full bg-wa-green px-6 py-3 text-sm font-semibold text-[#04140b] transition hover:bg-wa-greenDark"
            >
              Back to home
            </Link>
          </div>
        ) : (
          <>
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-wa-accent">Request a demo</p>
              <h1 className="mt-3 text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
                See WhatsApp-OS for your business
              </h1>
              <p className="mt-4 text-base leading-7 text-neutral-600">
                Share a few details and our team will set up a personalised walkthrough.
              </p>
            </div>

            <form onSubmit={onSubmit} className="mt-10 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="grid gap-5 sm:grid-cols-2">
                {fieldMeta.map((field) => (
                  <div key={field.key}>
                    <label htmlFor={field.key} className="mb-1.5 block text-sm font-medium text-neutral-700">
                      {field.label}
                      {field.required ? <span className="ml-0.5 text-wa-accent">*</span> : null}
                    </label>
                    <input
                      id={field.key}
                      name={field.key}
                      type={field.type ?? "text"}
                      required={field.required}
                      autoComplete={field.autoComplete}
                      value={fields[field.key]}
                      onChange={(event) => update(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>

              {error ? (
                <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-wa-green text-sm font-semibold text-[#04140b] transition hover:bg-wa-greenDark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? "Submitting…" : "Submit request"}
              </button>
              <p className="mt-3 text-center text-xs text-neutral-500">
                We only use these details to contact you about your demo.
              </p>
            </form>
          </>
        )}
      </section>
    </main>
    </ThemeProvider>
  );
}
