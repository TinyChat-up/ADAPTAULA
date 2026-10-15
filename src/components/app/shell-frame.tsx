"use client";

import { useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";

export function ShellFrame({ children, navigation, footer, header, mobile, initialCompact = false }: {
  children: ReactNode; navigation: ReactNode; footer: ReactNode; header: ReactNode; mobile: ReactNode; initialCompact?: boolean;
}) {
  const [compact, setCompact] = useState(initialCompact);
  function toggle() {
    const next = !compact;
    setCompact(next);
    // Presentation only. SSR reads the same preference so a reload does not shift the document.
    document.cookie = `adaptaula_nav=${next ? "compact" : "expanded"}; Path=/app; Max-Age=31536000; SameSite=Lax`;
  }
  return <div data-app-grid data-compact={compact} className="app-shell">
    <aside data-app-chrome className="app-sidebar" aria-label="Espacio docente">
      <div className="sidebar-brand flex items-center px-3 py-2"><Logo href="/app" /></div>
      <div id="navegacion-escritorio" className="min-h-0 flex-1 overflow-y-auto p-1">{navigation}</div>
      <div className="space-y-3">
        {footer}
        <Button variant="ghost" className="sidebar-toggle w-full text-muted-foreground" aria-expanded={!compact} aria-controls="navegacion-escritorio" onClick={toggle}>
          {compact ? <PanelLeftOpen aria-hidden className="size-4 shrink-0" /> : <PanelLeftClose aria-hidden className="size-4 shrink-0" />}
          <span>{compact ? "Ampliar" : "Plegar barra"}</span>
          {compact ? <span className="sr-only"> barra lateral</span> : null}
        </Button>
      </div>
    </aside>
    <div className="min-w-0">
      <header data-app-chrome className="app-topbar surface-glass">{header}</header>
      <main id="contenido" tabIndex={-1} className="app-content">{children}</main>
    </div>
    <div data-app-chrome className="contents">{mobile}</div>
  </div>;
}
