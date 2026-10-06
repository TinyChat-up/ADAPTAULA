import { LockKeyhole } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/layout";

export function LimitReachedCard({
  title,
  children,
  upgrade,
}: {
  title: string;
  children?: React.ReactNode;
  upgrade: { href: string; label: string } | null;
}) {
  return (
    <Card className="border-warning/40 bg-warning/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <LockKeyhole aria-hidden className="mt-1 size-5 shrink-0 text-warning" />
          <div className="space-y-1">
            <h2 className="font-semibold">{title}</h2>
            {children ? <p className="text-sm text-foreground/80">{children}</p> : null}
          </div>
        </div>
        {upgrade ? <LinkButton href={upgrade.href}>{upgrade.label}</LinkButton> : null}
      </div>
    </Card>
  );
}
