import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ProfileActions } from "@/components/profiles/profile-actions";
import { ProfileForm } from "@/components/profiles/profile-form";
import { Alert } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDateTime } from "@/lib/format/date";
import { getCatalog, getProfile } from "@/lib/profiles/repository";
import { deleteProfileAction, duplicateProfileAction, updateProfileAction } from "../actions";

export const metadata: Metadata = { title: "Editar perfil" };

export default async function EditProfilePage({ params, searchParams }: PageProps<"/app/alumnos/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace();
  const [profile, catalog] = await Promise.all([getProfile(ctx.workspace.id, id), getCatalog()]);
  if (!profile) notFound();

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
