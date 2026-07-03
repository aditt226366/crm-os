"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { primaryBtn } from "@/components/site/ui";
import { WaMark } from "@/components/site/WaMark";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Products", href: "/products" },
  { label: "Pricing", href: "/pricing" }
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full bg-transparent">
      <nav className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="WhatsApp-OS home">
          <WaMark className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight text-neutral-900">WhatsApp-OS</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                pathname === link.href ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-900"
              )}
            >
              {link.label}
            </Link>
          ))}
          <Link href="/login" className={cn(primaryBtn, "ml-2 px-4 py-1.5")}>
            Login
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 text-neutral-700 md:hidden"
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {open ? (
        <div className="border-t border-neutral-200 bg-white px-4 py-3 sm:px-6 md:hidden">
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-sm font-medium text-neutral-700"
              >
                {link.label}
              </Link>
            ))}
            <Link href="/login" className={cn(primaryBtn, "mt-2 w-full")}>
              Login
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
