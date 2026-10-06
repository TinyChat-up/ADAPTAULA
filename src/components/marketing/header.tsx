import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { MobileNav, type NavItem } from "./mobile-nav";

const NAV: NavItem[] = [
  { href: "/como-funciona", label: "Cómo funciona" },
  { href: "/precios", label: "Precios" },
  { href: "/privacidad", label: "Privacidad" },
];

export function MarketingHeader() {
  return (
    <header className="relative border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-control px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <LinkButton href="/login" variant="ghost" size="sm">
            Entrar
          </LinkButton>
          <LinkButton href="/registro" size="sm">
            Empezar gratis
          </LinkButton>
        </div>
        <MobileNav items={NAV} />
      </div>
    </header>
  );
}
