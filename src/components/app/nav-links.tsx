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
                className={cn(
                  "group relative flex min-h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors duration-150",
                  cta && !active && "text-primary",
                  active ? "bg-primary-soft text-primary" : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                {/* The active entry carries a bar as well as its colour and `aria-current` (never colour alone). */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-2 left-0 w-1 origin-center rounded-full bg-primary transition-transform duration-200 ease-out",
                    active ? "scale-y-100" : "scale-y-0",
                  )}
                />
                <Icon aria-hidden className={cn("size-5 shrink-0 transition-transform duration-200 ease-out", !active && "group-hover:scale-110")} />
                <span className="flex-1">{text}</span>
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
