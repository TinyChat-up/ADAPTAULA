import { CircleUserRound, FileCheck2, FilePlus2, FolderOpen, House, Users, type LucideIcon } from "lucide-react";

export interface AppNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other sections that belong to this entry (an adaptation's own pages belong to «Adaptaciones»). */
  also?: string[];
}

/**
 * Only what exists (docs/UX.md § Navegación de la app). Sections that are not built yet (classes, templates, a help centre) are not
 * announced in the navigation: their old addresses redirect (next.config.ts) so no link breaks.
 */
export const PRIMARY_NAV: AppNavItem[] = [
  { href: "/app", label: "Inicio", icon: House },
  { href: "/app/adaptar", label: "Adaptar material", icon: FilePlus2 },
  { href: "/app/materiales", label: "Materiales", icon: FolderOpen },
  { href: "/app/alumnos", label: "Perfiles", icon: Users },
  { href: "/app/historial", label: "Adaptaciones", icon: FileCheck2, also: ["/app/adaptaciones"] },
];

export const SECONDARY_NAV: AppNavItem[] = [{ href: "/app/uso", label: "Plan y cuenta", icon: CircleUserRound }];

export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

export const isItemActive = (pathname: string, item: AppNavItem) => [item.href, ...(item.also ?? [])].some((href) => isActive(pathname, href));
