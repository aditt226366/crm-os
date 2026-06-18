"use client";

import { FormEvent, useState } from "react";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { AnimatedSubmitButton } from "@/components/auth/AnimatedSubmitButton";

export function LoginForm({
  onSuccess
}: {
  onSuccess: (redirectTo: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);

    try {
      setLoading(true);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ username: username.trim(), password })
      });

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        redirectTo?: string;
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        setError(
          response.status === 401
            ? "Invalid username or password."
            : payload?.message ?? payload?.error?.message ?? "Login failed. Please try again."
        );
        return;
      }

      onSuccess(payload?.redirectTo ?? "/app/dashboard");
    } catch (error) {
      setError(
        error instanceof DOMException && error.name === "AbortError"
          ? "Login request timed out. Please try again."
          : "Login failed. Please try again."
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <input
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Username"
        className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50 focus:bg-cyan-300/[0.06]"
      />
      <PasswordInput value={password} onChange={setPassword} />
      {error ? (
        <p className="rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      ) : null}
      <AnimatedSubmitButton loading={loading}>Sign In</AnimatedSubmitButton>
    </form>
  );
}
