"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, FilePlus2, FolderOpen, House, LogOut, Users, X } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { PRIMARY_NAV, SECONDARY_NAV, isActive } from "./nav-items";

const TABS = [
  { href: "/app", label: "Inicio", icon: House },
  { href: "/app/materiales", label: "Materiales", icon: FolderOpen },
  { href: "/app/alumnos", label: "Perfiles", icon: Users },
];
const TAB_HREFS = ["/app", "/app/adaptar", "/app/materiales", "/app/alumnos"];
const MORE = [...PRIMARY_NAV.filter((i) => !TAB_HREFS.includes(i.href)), ...SECONDARY_NAV];

export function MobileBar({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
      active ? "text-primary" : "text-muted-foreground",
    );

  return (
    <>
      <nav aria-label="Navegación móvil" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface md:hidden">
        <ul className="mx-auto flex max-w-lg items-stretch">
          <li className="flex-1">
            <Link href={TABS[0]!.href} aria-current={isActive(pathname, "/app") ? "page" : undefined} className={tabClass(isActive(pathname, "/app"))}>
              <House aria-hidden className="size-5" />
              Inicio
            </Link>
          </li>
          <li className="flex-1">
            <Link href={TABS[1]!.href} aria-current={isActive(pathname, TABS[1]!.href) ? "page" : undefined} className={tabClass(isActive(pathname, TABS[1]!.href))}>
              <FolderOpen aria-hidden className="size-5" />
              Materiales
            </Link>
          </li>
          <li className="flex flex-1 items-center justify-center">
            <Link
              href="/app/adaptar"
              className="-mt-5 flex size-14 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground shadow-card"
            >
              <FilePlus2 aria-hidden className="size-6" />
              <span className="sr-only">Adaptar material</span>
            </Link>
          </li>
          <li className="flex-1">
            <Link href={TABS[2]!.href} aria-current={isActive(pathname, TABS[2]!.href) ? "page" : undefined} className={tabClass(isActive(pathname, TABS[2]!.href))}>
              <Users aria-hidden className="size-5" />
              Perfiles
            </Link>
          </li>
          <li className="flex-1">
            <button type="button" onClick={() => dialog.current?.showModal()} className={cn(tabClass(false), "w-full")}>
              <Ellipsis aria-hidden className="size-5" />
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
        className="m-0 mt-auto w-full max-w-none rounded-t-card bg-surface p-4 backdrop:bg-foreground/40 md:hidden"
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="font-semibold">Más</p>
          <button type="button" onClick={() => dialog.current?.close()} className="inline-flex size-11 items-center justify-center rounded-control hover:bg-foreground/5">
            <X aria-hidden className="size-5" />
            <span className="sr-only">Cerrar</span>
          </button>
        </div>
        <ul className="space-y-1">
          {MORE.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                onClick={() => dialog.current?.close()}
                aria-current={isActive(pathname, href) ? "page" : undefined}
                className="flex min-h-11 items-center gap-3 rounded-control px-3 font-medium hover:bg-foreground/5"
              >
                <Icon aria-hidden className="size-5" />
                {label}
              </Link>
            </li>
          ))}
          <li>
            <form action={signOutAction}>
              <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 font-medium hover:bg-foreground/5">
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
