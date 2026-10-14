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
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Logo />
        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-control px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <LinkButton href="/login" variant="ghost" size="sm">
            Entrar
          </LinkButton>
          <LinkButton href="/registro" variant="secondary" size="sm">
            Empezar gratis
          </LinkButton>
        </div>
        <MobileNav items={NAV} />
      </div>
    </header>
  );
}
