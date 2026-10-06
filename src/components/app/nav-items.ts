import {
  CalendarClock,
  CircleHelp,
  FilePlus2,
  FolderOpen,
  Gauge,
  House,
  LayoutTemplate,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface AppNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: AppNavItem[] = [
  { href: "/app", label: "Inicio", icon: House },
  { href: "/app/adaptar", label: "Adaptar material", icon: FilePlus2 },
  { href: "/app/materiales", label: "Materiales", icon: FolderOpen },
  { href: "/app/alumnos", label: "Perfiles", icon: Users },
  { href: "/app/clases", label: "Clases", icon: UsersRound },
  { href: "/app/plantillas", label: "Plantillas", icon: LayoutTemplate },
  { href: "/app/historial", label: "Historial", icon: CalendarClock },
  { href: "/app/uso", label: "Uso", icon: Gauge },
];

export const SECONDARY_NAV: AppNavItem[] = [
  { href: "/app/ayuda", label: "Ayuda", icon: CircleHelp },
  { href: "/app/configuracion", label: "Configuración", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
