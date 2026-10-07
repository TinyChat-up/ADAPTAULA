import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ProfileActions } from "@/components/profiles/profile-actions";
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

export const metadata: Metadata = { title: "Editar perfil" };

export default async function EditProfilePage({ params, searchParams }: PageProps<"/app/alumnos/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace();
  const [profile, catalog, materials, adaptations] = await Promise.all([
    getProfile(ctx.workspace.id, id),
    getCatalog(),
    listMaterials(ctx.workspace.id, { status: "analyzed" }),
    listAdaptations({ profileId: id, limit: 10 }),
  ]);
  if (!profile) notFound();
  const canWrite = hasRole(ctx.role, WRITE_ROLES);

  return (
    <div className="space-y-8">
      <Link href="/app/alumnos" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Perfiles
      </Link>
      <PageHeader
        title={profile.display_name}
        description={`Última actualización: ${formatDateTime(profile.updated_at)}`}
        actions={<ProfileActions duplicate={duplicateProfileAction.bind(null, id)} remove={deleteProfileAction.bind(null, id)} />}
      />
      {query.aviso === "duplicado" ? <Alert tone="success">Perfil duplicado. Ya puedes ajustarlo.</Alert> : null}

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
              <p className="text-sm text-muted-foreground">Elige un material analizado. Antes de crear la ficha podrás revisar la propuesta.</p>
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
      <ProfileForm
        catalog={catalog}
        submitLabel="Guardar cambios"
        initial={{
          display_name: profile.display_name,
          stage_slug: profile.stage_slug ?? "",
          grade_slug: profile.grade_slug ?? "",
          functional_profile: profile.functional_profile,
        }}
        onSubmit={updateProfileAction.bind(null, id)}
      />
    </div>
  );
}
