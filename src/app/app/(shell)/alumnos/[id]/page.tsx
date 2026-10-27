import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ProfileActions } from "@/components/profiles/profile-actions";
import { ProfileSummaryPanel } from "@/components/profiles/profile-summary-panel";
import { summarizeProfile } from "@/lib/profiles/summary";
import { checkEntitlement } from "@/lib/permissions/check-entitlement";
import { labelsFor } from "@/lib/profiles/catalog";
import { ProfileForm } from "@/components/profiles/profile-form";
import { Alert } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { AdaptationList } from "@/components/adaptation/adaptation-list";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/layout";
import { listAdaptations } from "@/lib/adaptation/orchestration/page-data";
import { requireWorkspace, WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { listMaterials } from "@/lib/materials/repository";
import { formatDateTime } from "@/lib/format/date";
import { getCatalog, getProfile } from "@/lib/profiles/repository";
import { deleteProfileAction, duplicateProfileAction, updateProfileAction } from "../actions";

export const metadata: Metadata = { title: "Perfil de alumnado" };

export default async function EditProfilePage({ params, searchParams }: PageProps<"/app/alumnos/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace();
  const profile = await getProfile(ctx.workspace.id, id);
  if (!profile) notFound();
  const [catalog, materials, adaptations] = await Promise.all([
    getCatalog(),
    listMaterials(ctx.workspace.id, { status: "analyzed" }),
    listAdaptations({ profileId: id, limit: 10 }),
  ]);
  const canWrite = hasRole(ctx.role, WRITE_ROLES);
  const creation = await checkEntitlement(ctx, "profile.create");
  const labels = labelsFor(catalog, profile.stage_slug, profile.grade_slug);

  return (
    <div className="space-y-8">
      <Link href="/app/alumnos" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Perfiles
      </Link>
      <PageHeader
        title={profile.display_name}
        description={`Última actualización: ${formatDateTime(profile.updated_at)}`}
        actions={canWrite ? <ProfileActions canDuplicate={creation.allowed} duplicate={duplicateProfileAction.bind(null, id)} remove={deleteProfileAction.bind(null, id)} /> : null}
      />
      {query.aviso === "duplicado" ? <Alert tone="success">Perfil duplicado. Ya puedes ajustarlo.</Alert> : null}

      <p className="text-sm text-muted-foreground">{[labels.stage, labels.grade].filter(Boolean).join(" · ")}</p>
      {!canWrite ? <Alert>Tu acceso es de solo lectura. Puedes consultar los apoyos y las adaptaciones guardadas.</Alert> : null}

      {canWrite ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Adaptar un material con este perfil</h2>
          {materials.length === 0 ? (
            <>
              <p className="text-sm text-muted-foreground">Todavía no tienes materiales analizados. Sube uno y podrás adaptarlo con este perfil.</p>
              <LinkButton href="/app/adaptar" variant="secondary">
                Subir material
              </LinkButton>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Elige un material analizado. Continuarás en la ficha con este perfil seleccionado.</p>
              <ul className="space-y-1">
                {materials.slice(0, 6).map((m) => (
                  <li key={m.id}>
                    <Link href={`/app/materiales/${m.id}?perfil=${id}#adaptar`} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
                      {m.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {materials.length > 6 ? (
                <Link href="/app/materiales?estado=analyzed" className="text-sm font-medium text-primary underline underline-offset-2">
                  Ver todos los materiales analizados
                </Link>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {adaptations.length > 0 ? (
        <section aria-labelledby="adaptaciones-perfil" className="space-y-3">
          <h2 id="adaptaciones-perfil" className="text-lg font-semibold">
            Adaptaciones con este perfil
          </h2>
          <AdaptationList items={adaptations} show={{ material: true, profile: false }} />
        </section>
      ) : null}
      {canWrite ? <ProfileForm
        catalog={catalog}
        submitLabel="Guardar cambios"
        initial={{
          display_name: profile.display_name,
          stage_slug: profile.stage_slug ?? "",
          grade_slug: profile.grade_slug ?? "",
          functional_profile: profile.functional_profile,
          expected_updated_at: profile.updated_at,
        }}
        onSubmit={updateProfileAction.bind(null, id)}
      /> : <ProfileSummaryPanel summary={summarizeProfile(profile.functional_profile)} />}
    </div>
  );
}
