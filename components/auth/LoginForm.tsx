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
    setLoading(true);
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const payload = (await response.json()) as {
      redirectTo?: string;
      error?: { message?: string };
    };
    setLoading(false);
    if (!response.ok) {
      setError(payload.error?.message ?? "Login failed");
      return;
    }
    onSuccess(payload.redirectTo ?? "/app/dashboard");
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
