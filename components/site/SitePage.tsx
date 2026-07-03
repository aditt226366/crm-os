import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ThemeProvider, ThemeToggle } from "@/components/site/theme";

/**
 * Shared shell for public pages. Uses a flex column so the footer is always
 * pinned to the bottom of the viewport, even when the page is short.
 */
export function SitePage({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <main className="theme-light flex min-h-screen w-full flex-col bg-white text-neutral-900">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <ThemeToggle />
      </main>
    </ThemeProvider>
  );
}
