"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function PasswordInput({
  value,
  onChange,
  placeholder = "Password",
  label = "Password"
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <div className="relative">
        <input
          id="login-password"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="current-password"
          className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3.5 pr-11 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
