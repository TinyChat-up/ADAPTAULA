import type { ReactNode } from "react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/ui/logo";
import type { WorkspaceUsage } from "@/lib/schemas/plan";
import { MobileBar } from "./mobile-bar";
import { SidebarPrimaryNav, SidebarSecondaryNav } from "./nav-links";
import { UserFooter } from "./user-footer";
import { ShellFrame } from "./shell-frame";
import { AppLocation } from "./location";

export function AppShell({
  children,
  usage,
  user,
  initialCompact = false,
}: {
  children: ReactNode;
  usage: WorkspaceUsage;
  user: { name: string | null; email: string | undefined };
  initialCompact?: boolean;
}) {
  return (
    <ShellFrame initialCompact={initialCompact}
      navigation={<SidebarPrimaryNav />}
      footer={<><SidebarSecondaryNav /><UserFooter name={user.name} email={user.email} usage={usage} /></>}
      header={<>
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-3 px-5 md:hidden">
          <Logo href="/app" />
          <Link href="/app/uso" className="inline-flex min-h-11 items-center rounded-control px-2 text-xs font-medium text-muted-foreground hover:bg-primary-soft">
            Plan {usage.plan.name} · {usage.adaptations.used}/{usage.adaptations.limit}<span className="sr-only"> adaptaciones este mes</span>
          </Link>
        </div>
        <div className="flex min-h-12 items-center justify-between gap-3 px-5 md:min-h-16 md:px-8">
          <AppLocation />
          <Link href="/como-funciona" className="hidden min-h-11 items-center rounded-control px-3 text-sm text-muted-foreground hover:bg-primary-soft md:inline-flex">Cómo funciona</Link>
        </div>
      </>}
      mobile={<MobileBar signOutAction={signOut} />}
    >{children}</ShellFrame>
  );
}
