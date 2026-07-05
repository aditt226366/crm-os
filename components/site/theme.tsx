"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {}
});

const STORAGE_KEY = "wa-theme";

/**
 * Provides light/dark theme state for the public site only. The choice is
 * persisted to localStorage and reflected as `data-wa-theme` on <html>, which
 * globals.css uses to re-map the light palette to dark. Admin/app panels have
 * no `.theme-light` wrapper, so they are never affected.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [hydrated, setHydrated] = useState(false);

  // Read the saved choice once. This runs on every mount (the provider is
  // remounted on client navigation between pages), so it restores the theme
  // when you move between pages.
  useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "dark") setTheme(stored);
      setHydrated(true);
    });
  }, []);

  // Persist + reflect on <html>, but never before we've read the stored value
  // — otherwise the initial "light" default would overwrite a saved "dark".
  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.waTheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, hydrated]);

  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** Small floating pill in the bottom-right corner to switch light/dark. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="fixed bottom-5 right-5 z-[60] grid h-11 w-11 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-md transition hover:bg-neutral-50 hover:text-neutral-900"
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
