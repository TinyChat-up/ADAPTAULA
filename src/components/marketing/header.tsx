import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { MobileNav, type NavItem } from "./mobile-nav";

const NAV: NavItem[] = [
  { href: "/como-funciona", label: "Cómo funciona" },
  { href: "/precios", label: "Precios" },
  { href: "/privacidad", label: "Privacidad" },
];

export function MarketingHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="surface-glass sticky top-0 z-40 border-x-0 border-t-0 shadow-none">
      <div className="mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-y-2 px-5 py-2 sm:px-8">
        <Logo />
        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="inline-flex min-h-11 items-center rounded-control px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <LinkButton href="/app" variant="secondary" size="sm">
              Ir a la app
            </LinkButton>
          ) : (
            <>
              <LinkButton href="/login" variant="ghost" size="sm">
                Entrar
              </LinkButton>
              <LinkButton href="/registro" variant="secondary" size="sm">
                Empezar gratis
              </LinkButton>
            </>
          )}
        </div>
        <MobileNav items={NAV} signedIn={signedIn} />
      </div>
    </header>
  );
}
