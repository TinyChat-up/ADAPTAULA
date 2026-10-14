import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { UsageMeter } from "@/components/ui/feedback";
import type { WorkspaceUsage } from "@/lib/schemas/plan";

export function UserFooter({ name, email, usage }: { name: string | null; email: string | undefined; usage: WorkspaceUsage }) {
  const initials = (name ?? email ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <Link href="/app/uso" className="block space-y-2 px-1 py-2 hover:underline">
        <span className="flex items-center justify-between text-sm">
          <span className="font-medium">Plan {usage.plan.name}</span>
          <span className="text-muted-foreground">
            {usage.adaptations.used}/{usage.adaptations.limit}
          </span>
        </span>
        <UsageMeter used={usage.adaptations.used} limit={usage.adaptations.limit} label="Adaptaciones usadas este mes" />
        <span className="block text-xs text-muted-foreground">adaptaciones este mes</span>
      </Link>
      <div className="flex items-center gap-2 px-1">
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-border text-xs font-semibold text-foreground">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name ?? "Mi cuenta"}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex size-10 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <LogOut aria-hidden className="size-5" />
            <span className="sr-only">Cerrar sesión</span>
          </button>
        </form>
      </div>
    </div>
  );
}
