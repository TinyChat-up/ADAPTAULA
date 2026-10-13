import type { ReactNode } from "react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/ui/logo";
import type { WorkspaceUsage } from "@/lib/schemas/plan";
import { MobileBar } from "./mobile-bar";
import { SidebarPrimaryNav, SidebarSecondaryNav } from "./nav-links";
import { UserFooter } from "./user-footer";

export function AppShell({
  children,
  usage,
  user,
}: {
  children: ReactNode;
  usage: WorkspaceUsage;
  user: { name: string | null; email: string | undefined };
}) {
  return (
    <div data-app-grid className="min-h-screen md:grid md:grid-cols-[16rem_1fr]">
      <aside data-app-chrome className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-border bg-surface p-4 md:flex">
        <div className="px-3 pt-2">
          <Logo href="/app" />
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto">
          <SidebarPrimaryNav />
        </div>
        <SidebarSecondaryNav />
        <UserFooter name={user.name} email={user.email} usage={usage} />
      </aside>
      <div className="min-w-0">
        <header data-app-chrome className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface/85 px-4 backdrop-blur md:hidden">
          <Logo href="/app" />
          <Link href="/app/uso" className="inline-flex min-h-8 items-center rounded-full bg-primary-soft px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/10">
            Plan {usage.plan.name} · {usage.adaptations.used}/{usage.adaptations.limit}
            <span className="sr-only"> adaptaciones este mes</span>
          </Link>
        </header>
        <main id="contenido" className="mx-auto w-full max-w-5xl px-4 py-8 pb-28 sm:px-6 md:pb-12">
          {children}
        </main>
      </div>
      <div data-app-chrome className="contents">
        <MobileBar signOutAction={signOut} />
      </div>
    </div>
  );
}
