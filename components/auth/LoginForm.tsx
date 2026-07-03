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
      <div>
        <label htmlFor="login-username" className="mb-1.5 block text-sm font-medium text-neutral-700">
          Email or username
        </label>
        <input
          id="login-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="you@company.com"
          autoComplete="username"
          className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20"
        />
      </div>
      <PasswordInput value={password} onChange={setPassword} />
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <AnimatedSubmitButton loading={loading}>Sign In</AnimatedSubmitButton>
    </form>
  );
}
