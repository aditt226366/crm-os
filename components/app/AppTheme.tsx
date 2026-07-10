"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const AppThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {}
});

const STORAGE_KEY = "wa-app-theme";

/**
 * Light/dark theme for the company workspace (/app) only. Persisted to
 * localStorage. Light = the WhatsApp-green landing look; dark = the original
 * console look. Mirrors components/admin/AdminTheme.tsx.
 */
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "dark") setTheme(stored);
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, hydrated]);

  const toggle = useCallback(() => setTheme((current) => (current === "light" ? "dark" : "light")), []);

  return <AppThemeContext.Provider value={{ theme, toggle }}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(AppThemeContext);
}

export function AppThemeToggle() {
  const { theme, toggle } = useAppTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.055] text-slate-300 transition hover:border-cyan-200/35 hover:text-white"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

/** Floating bottom-right light/dark switch for the workspace. */
export function AppThemeFloatingToggle() {
  const { theme, toggle } = useAppTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="fixed bottom-5 right-5 z-[60] grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.055] text-slate-300 shadow-lg backdrop-blur transition hover:border-cyan-300/40 hover:text-white"
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
