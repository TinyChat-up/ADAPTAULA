import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getWorkspaceUsage } from "@/lib/plans/usage";

export const metadata: Metadata = { title: "Clases" };

export default async function ClassesPage() {
  const ctx = await requireWorkspace();
  const usage = await getWorkspaceUsage(ctx.workspace.id);
  const included = usage.max_classes > 0;
  return (
    <div className="space-y-8">
      <PageHeader title="Clases" description="Agrupa perfiles para adaptar un material a toda una clase." />
      <EmptyState
        icon={UsersRound}
        title={included ? "Las clases llegarán pronto" : "Las clases no están incluidas en tu plan"}
        description={
          included
            ? "Tu plan incluye clases. Estamos terminando esta sección."
            : "Con un plan superior podrás agrupar perfiles por clase."
        }
      >
        {included ? null : <LinkButton href="/precios">Ver planes</LinkButton>}
      </EmptyState>
    </div>
  );
}
