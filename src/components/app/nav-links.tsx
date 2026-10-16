"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { PRIMARY_NAV, SECONDARY_NAV, isItemActive, type AppNavItem } from "./nav-items";

function NavList({ items, label }: { items: AppNavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="space-y-1">
        {items.map((item) => {
          const { href, label: text, icon: Icon } = item;
          const active = isItemActive(pathname, item);
          const cta = href === "/app/adaptar";
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("nav-link", cta && "nav-link--create")}
              >
                <Icon aria-hidden className="size-[1.125rem] shrink-0" strokeWidth={1.7} />
                <span className="sr-only">{text}</span>
                <span aria-hidden className="nav-label-long">{text}</span>
                <span aria-hidden className="nav-label-short">{item.compactLabel ?? text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SidebarPrimaryNav() {
  return <NavList items={PRIMARY_NAV} label="Principal" />;
}

export function SidebarSecondaryNav() {
  return <NavList items={SECONDARY_NAV} label="Tu cuenta" />;
}
