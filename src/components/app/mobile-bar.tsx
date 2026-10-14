"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, FilePlus2, FolderOpen, House, LogOut, Users, X, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { PRIMARY_NAV, SECONDARY_NAV, isActive, isItemActive } from "./nav-items";

const TABS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/app", label: "Inicio", icon: House },
  { href: "/app/materiales", label: "Materiales", icon: FolderOpen },
  { href: "/app/alumnos", label: "Perfiles", icon: Users },
];
const TAB_HREFS = ["/app", "/app/adaptar", "/app/materiales", "/app/alumnos"];
const MORE = [...PRIMARY_NAV.filter((i) => !TAB_HREFS.includes(i.href)), ...SECONDARY_NAV];

function Tab({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors", active ? "text-primary" : "text-muted-foreground")}
    >
      <span className={cn("flex h-7 w-full max-w-12 items-center justify-center rounded-sm transition-colors duration-200", active && "bg-primary-soft")}>
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="max-w-full break-words">{label}</span>
    </Link>
  );
}

export function MobileBar({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const moreActive = MORE.some((item) => isItemActive(pathname, item));

  return (
    <>
      <nav aria-label="Navegación móvil" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="mx-auto flex max-w-lg items-stretch">
          <li className="flex min-w-0 flex-1">
            <Tab {...TABS[0]!} active={isActive(pathname, "/app")} />
          </li>
          <li className="flex min-w-0 flex-1">
            <Tab {...TABS[1]!} active={isActive(pathname, TABS[1]!.href)} />
          </li>
          <li className="flex min-w-0 flex-1 items-center justify-center">
            <Link
              href="/app/adaptar"
              aria-current={isActive(pathname, "/app/adaptar") ? "page" : undefined}
              className="flex h-full min-h-14 min-w-0 w-full flex-col items-center justify-center gap-0.5 bg-foreground text-xs font-medium text-primary-foreground"
            >
              <FilePlus2 aria-hidden className="size-5" />
              <span className="max-w-full break-words">Adaptar<span className="sr-only"> material</span></span>
            </Link>
          </li>
          <li className="flex min-w-0 flex-1">
            <Tab {...TABS[2]!} active={isActive(pathname, TABS[2]!.href)} />
          </li>
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => dialog.current?.showModal()}
              className={cn("flex min-h-14 w-full flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium", moreActive ? "text-primary" : "text-muted-foreground")}
            >
              <span className={cn("flex h-7 w-full max-w-12 items-center justify-center rounded-sm transition-colors duration-200", moreActive && "bg-primary-soft")}>
                <Ellipsis aria-hidden className="size-5" />
              </span>
              Más
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={dialog}
        aria-label="Más opciones"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
        className="sheet m-0 mt-auto w-full max-w-none rounded-t-lg bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl backdrop:bg-foreground/40 md:hidden"
      >
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
        <div className="mb-2 flex items-center justify-between">
          <p className="font-semibold">Más</p>
          <button type="button" onClick={() => dialog.current?.close()} className="inline-flex size-11 items-center justify-center rounded-control hover:bg-foreground/5">
            <X aria-hidden className="size-5" />
            <span className="sr-only">Cerrar</span>
          </button>
        </div>
        <ul className="space-y-1">
          {MORE.map((item) => {
            const { href, label, icon: Icon } = item;
            const active = isItemActive(pathname, item);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => dialog.current?.close()}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-12 items-center gap-3 rounded-control px-3 font-medium hover:bg-foreground/5", active && "bg-primary-soft text-primary")}
                >
                  <Icon aria-hidden className="size-5" />
                  <span className="max-w-full break-words">{label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <form action={signOutAction}>
              <button type="submit" className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 font-medium hover:bg-foreground/5">
                <LogOut aria-hidden className="size-5" />
                Cerrar sesión
              </button>
            </form>
          </li>
        </ul>
      </dialog>
    </>
  );
}
