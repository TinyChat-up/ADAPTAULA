import Link from "next/link";
import { Logo } from "@/components/ui/logo";

const COLUMNS = [
  {
    title: "Producto",
    links: [
      { href: "/como-funciona", label: "Cómo funciona" },
      { href: "/precios", label: "Precios" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacidad", label: "Privacidad" },
      { href: "/terminos", label: "Términos" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
  {
    title: "Cuenta",
    links: [
      { href: "/login", label: "Entrar" },
      { href: "/registro", label: "Crear cuenta" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Adapta materiales educativos a las necesidades de aprendizaje de tu alumnado.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-sm font-semibold">{col.title}</h2>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted-foreground hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">
          © {new Date().getFullYear()} Adaptaula. Adaptaula genera propuestas editables: no diagnostica ni sustituye al orientador o al profesional.
        </p>
      </div>
    </footer>
  );
}
