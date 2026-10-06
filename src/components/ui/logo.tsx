import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)} aria-label="Adaptaula, inicio">
      <svg aria-hidden viewBox="0 0 24 24" className="size-6 text-primary" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
        <path d="M8 16l4-8 4 8M9.5 13.5h5" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-lg">Adaptaula</span>
    </Link>
  );
}
