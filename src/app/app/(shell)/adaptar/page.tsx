import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FilePlus2, FileText } from "lucide-react";
import { MaterialUploader } from "@/components/materials/uploader";
import { Card, PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { effectiveLimits } from "@/lib/materials/config";
import { listMaterials } from "@/lib/materials/repository";
import { getWorkspaceUsage } from "@/lib/plans/usage";

export const metadata: Metadata = { title: "Adaptar material" };

export default async function AdaptPage() {
  const ctx = await requireWorkspace();
  const [usage, analyzed] = await Promise.all([getWorkspaceUsage(ctx.workspace.id), listMaterials(ctx.workspace.id, { status: "analyzed" })]);
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader icon={FilePlus2} title="Adapta un material" description="Sube una ficha que ya utilizas y prepararemos una versión adaptada." />
      <MaterialUploader limits={effectiveLimits(usage.features)} />
      {analyzed.length > 0 ? (
        // An analyzed material is adapted from its own page (one entry point): no second upload, no second analysis.
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">¿Ya lo has subido?</h2>
          <p className="text-sm text-muted-foreground">Elige un material analizado para adaptarlo a otro perfil.</p>
          <ul className="stagger -mx-2 space-y-1">
            {analyzed.slice(0, 5).map((m) => (
              <li key={m.id}>
                <Link
                  href={`/app/materiales/${m.id}#adaptar`}
                  className="group flex min-h-11 items-center gap-3 rounded-control px-2 py-1.5 font-medium text-primary transition-colors hover:bg-primary-soft/60"
                >
                  <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">
                    <FileText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate underline underline-offset-2">{m.title}</span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
          {analyzed.length > 5 ? (
            <Link href="/app/materiales?estado=analyzed" className="text-sm font-medium text-primary underline underline-offset-2">
              Ver todos los materiales analizados
            </Link>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
