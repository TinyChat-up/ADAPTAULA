import type { LucideIcon } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";

/** Honest placeholder for sections whose functionality is not built yet. No fake data. */
export function ComingSoon({
  title,
  description,
  icon,
  emptyTitle,
  emptyText,
  action,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyText: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title={emptyTitle} description={emptyText}>
        {action ? <LinkButton href={action.href}>{action.label}</LinkButton> : null}
      </EmptyState>
    </div>
  );
}
