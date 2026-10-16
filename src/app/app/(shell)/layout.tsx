import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getWorkspaceUsage } from "@/lib/plans/usage";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const ctx = await requireWorkspace();
  if (!ctx.profile.onboardingCompleted) redirect("/app/bienvenida");
  const usage = await getWorkspaceUsage(ctx.workspace.id);
  const initialCompact = (await cookies()).get("adaptaula_nav")?.value === "compact";
  return (
    <AppShell usage={usage} user={{ name: ctx.profile.fullName, email: ctx.user.email }} initialCompact={initialCompact}>
      {children}
    </AppShell>
  );
}
