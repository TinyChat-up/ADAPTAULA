import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getWorkspaceUsage } from "@/lib/plans/usage";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const ctx = await requireWorkspace();
  const usage = await getWorkspaceUsage(ctx.workspace.id);
  const rows: [string, string][] = [
    ["Nombre", ctx.profile.fullName ?? "Sin indicar"],
    ["Email", ctx.user.email ?? "—"],
    ["Espacio de trabajo", ctx.workspace.name],
    ["Plan", usage.plan.name],
  ];
  return (
    <div className="space-y-8">
      <PageHeader title="Configuración" description="Datos de tu cuenta. La edición y la gestión de la suscripción llegarán más adelante." />
      <Card>
        <dl className="divide-y divide-border">
          {rows.map(([term, value]) => (
            <div key={term} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr]">
              <dt className="text-sm font-medium text-muted-foreground">{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
