"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { locationOf } from "./nav-items";

/** Section context only; document identity and job state stay in their server-backed screens. */
export function AppLocation() {
  const location = locationOf(usePathname());
  return <nav aria-label="Ubicación" className="min-w-0 text-sm">
    <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <li><Link href={location.href} aria-current={location.detail ? undefined : "page"} className="inline-flex min-h-11 items-center font-medium hover:underline">{location.label}</Link></li>
      {location.detail ? <li className="flex min-w-0 items-center gap-2 text-muted-foreground"><ChevronRight aria-hidden className="size-3 shrink-0" /><span aria-current="page">{location.detail}</span></li> : null}
    </ol>
  </nav>;
}
