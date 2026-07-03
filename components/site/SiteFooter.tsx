import Link from "next/link";
import { Container } from "@/components/site/ui";
import { WaMark } from "@/components/site/WaMark";

export function SiteFooter() {
  return (
    <footer className="w-full border-t border-neutral-200 bg-white">
      <Container className="py-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <WaMark className="h-7 w-7" />
            <span className="text-[15px] font-semibold tracking-tight text-neutral-900">WhatsApp-OS</span>
          </div>

          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-600">
            <Link href="/products" className="transition hover:text-neutral-900">Products</Link>
            <Link href="/pricing" className="transition hover:text-neutral-900">Pricing</Link>
            <Link href="/about" className="transition hover:text-neutral-900">About</Link>
            <Link href="/request-demo" className="transition hover:text-neutral-900">Request a demo</Link>
            <Link href="/login" className="transition hover:text-neutral-900">Login</Link>
            <a href="mailto:hello@whatsapp-os.com" className="transition hover:text-neutral-900">Contact</a>
          </nav>
        </div>

        <div className="mt-6 flex flex-col items-center justify-between gap-2 border-t border-neutral-200 pt-4 text-xs text-neutral-500 sm:flex-row">
          <p>© {new Date().getFullYear()} WhatsApp-OS. All rights reserved.</p>
          <p>Not affiliated with WhatsApp or Meta.</p>
        </div>
      </Container>
    </footer>
  );
}
