import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { LimitReachedCard } from "@/components/app/limit-reached-card";
import { ProfileForm } from "@/components/profiles/profile-form";
import { PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { checkEntitlement } from "@/lib/permissions/check-entitlement";
import { limitCopy } from "@/lib/plans/format";
import { getUpgradeCta } from "@/lib/plans/upgrade";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { getCatalog } from "@/lib/profiles/repository";
import { createProfileAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo perfil" };

export default async function NewProfilePage() {
  const ctx = await requireWorkspace();
  const [catalog, usage, entitlement] = await Promise.all([
    getCatalog(),
    getWorkspaceUsage(ctx.workspace.id),
    checkEntitlement(ctx, "profile.create"),
  ]);

  return (
    <div className="space-y-8">
      <Link href="/app/alumnos" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Perfiles
      </Link>
      <PageHeader title="Nuevo perfil" description="Empieza por lo básico. Puedes ajustar el resto después." />
      {entitlement.allowed ? (
        <ProfileForm catalog={catalog} submitLabel="Crear perfil" onSubmit={createProfileAction} />
      ) : entitlement.reason === "limit_reached" ? (
        <LimitReachedCard title={limitCopy(usage.plan.name, entitlement.limit)} upgrade={await getUpgradeCta(entitlement)}>
          Puedes eliminar un perfil que ya no uses para crear otro.
        </LimitReachedCard>
      ) : (
        <LimitReachedCard title="Tu rol no permite crear perfiles" upgrade={null} />
      )}
    </div>
  );
}
