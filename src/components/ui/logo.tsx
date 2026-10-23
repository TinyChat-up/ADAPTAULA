import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/** The official pieces (public/brand, docs/BRAND.md): never redrawn, recoloured or stretched; only scaled with their own ratio. */
export const BRAND_SYMBOL_SRC = "/brand/adaptaula-simbolo.svg";
export const BRAND_WORDMARK_SRC = "/brand/adaptaula-logotipo.svg";

type Size = "sm" | "md" | "lg";

/**
 * The horizontal logo: the official symbol beside the official multicolour wordmark, in the proportions of
 * public/brand/adaptaula-logo-horizontal.svg (brand.css). The link carries the name; both images are decorative inside it.
 * Where space is short (the folded sidebar), CSS keeps the symbol alone.
 */
export function Logo({ href = "/", className, size = "md" }: { href?: string; className?: string; size?: Size }) {
  return (
    <Link href={href} className={cn("brand-lockup", `brand-lockup--${size}`, className)} aria-label="Adaptaula, inicio">
      {/* eslint-disable-next-line @next/next/no-img-element -- static vector brand mark: nothing to optimise, its own ratio */}
      <img src={BRAND_SYMBOL_SRC} alt="" width={830} height={713} className="brand-symbol" decoding="async" />
      {/* eslint-disable-next-line @next/next/no-img-element -- static vector brand mark: nothing to optimise, its own ratio */}
      <img src={BRAND_WORDMARK_SRC} alt="" width={1226} height={263} className="brand-wordmark" decoding="async" />
    </Link>
  );
}
