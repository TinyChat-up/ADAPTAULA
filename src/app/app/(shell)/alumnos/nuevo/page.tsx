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
import { z } from "zod";
import { getMaterialDetail } from "@/lib/materials/repository";
import { createProfileAction, createProfileForMaterialAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo perfil" };

export default async function NewProfilePage({ searchParams }: PageProps<"/app/alumnos/nuevo">) {
  const ctx = await requireWorkspace();
  const query = await searchParams;
  const materialParam = typeof query.material === "string" && z.uuid().safeParse(query.material).success ? query.material : null;
  const [catalog, usage, entitlement, material] = await Promise.all([
    getCatalog(),
    getWorkspaceUsage(ctx.workspace.id),
    checkEntitlement(ctx, "profile.create"),
    materialParam ? getMaterialDetail(ctx.workspace.id, materialParam) : Promise.resolve(null),
  ]);
  // Coming from a material the user can see: after creating, back to it with the new profile chosen.
  const from = material ? { id: material.material.id, title: material.material.title } : null;

  return (
    <div className="space-y-8">
      <Link href={from ? `/app/materiales/${from.id}` : "/app/alumnos"} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        {from ? "Volver al material" : "Perfiles"}
      </Link>
      <PageHeader
        title="Nuevo perfil"
        description={from ? `Empieza por lo básico. Al crearlo volverás a «${from.title}» para adaptarlo.` : "Empieza por lo básico. Puedes ajustar el resto después."}
      />
      {entitlement.allowed ? (
        <ProfileForm catalog={catalog} submitLabel="Crear perfil" onSubmit={from ? createProfileForMaterialAction.bind(null, from.id) : createProfileAction} />
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
