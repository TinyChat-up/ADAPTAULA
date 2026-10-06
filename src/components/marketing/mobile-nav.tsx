"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";

export interface NavItem {
  href: string;
  label: string;
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // Open state is tied to the path it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="menu-movil"
        onClick={() => setOpenOn(open ? null : pathname)}
        className="inline-flex size-11 items-center justify-center rounded-control hover:bg-foreground/5"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        <span className="sr-only">{open ? "Cerrar menú" : "Abrir menú"}</span>
      </button>
      {open ? (
        <nav
          id="menu-movil"
          aria-label="Principal"
          className="absolute inset-x-0 top-full border-b border-border bg-surface px-4 pb-4 pt-2 shadow-card"
        >
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="block rounded-control px-3 py-3 font-medium hover:bg-foreground/5">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/login" className="block rounded-control px-3 py-3 font-medium hover:bg-foreground/5">
                Entrar
              </Link>
            </li>
            <li className="pt-2">
              <Link
                href="/registro"
                className="flex min-h-11 items-center justify-center rounded-control bg-primary px-4 font-medium text-primary-foreground"
              >
                Empezar gratis
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
