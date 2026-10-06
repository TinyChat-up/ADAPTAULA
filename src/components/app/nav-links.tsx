"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { PRIMARY_NAV, SECONDARY_NAV, isActive, type AppNavItem } from "./nav-items";

function NavList({ items, label, lockedHrefs }: { items: AppNavItem[]; label: string; lockedHrefs: string[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="space-y-1">
        {items.map(({ href, label: text, icon: Icon }) => {
          const active = isActive(pathname, href);
          const locked = lockedHrefs.includes(href);
          const cta = href === "/app/adaptar";
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-3 rounded-control px-3 text-sm font-medium",
                  cta && !active && "text-primary",
                  active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span className="flex-1">{text}</span>
                {locked ? (
                  <>
                    <Lock aria-hidden className="size-3.5 text-muted-foreground" />
                    <span className="sr-only">No incluido en tu plan</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SidebarPrimaryNav({ lockedHrefs }: { lockedHrefs: string[] }) {
  return <NavList items={PRIMARY_NAV} label="Principal" lockedHrefs={lockedHrefs} />;
}

export function SidebarSecondaryNav() {
  return <NavList items={SECONDARY_NAV} label="Ayuda y ajustes" lockedHrefs={[]} />;
}
