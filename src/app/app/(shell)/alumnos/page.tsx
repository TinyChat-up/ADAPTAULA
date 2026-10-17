import type { Metadata } from "next";
import { ProfileDirectory } from "@/components/profiles/profile-directory";
import { Users } from "lucide-react";
import { LimitReachedCard } from "@/components/app/limit-reached-card";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { checkEntitlement } from "@/lib/permissions/check-entitlement";
import { limitCopy } from "@/lib/plans/format";
import { getUpgradeCta } from "@/lib/plans/upgrade";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { labelsFor } from "@/lib/profiles/catalog";
import { countActiveProfiles, getCatalog, listProfiles } from "@/lib/profiles/repository";
import { summarizeProfile, teaser } from "@/lib/profiles/summary";

export const metadata: Metadata = { title: "Perfiles de alumnado" };

const NOTICES: Record<string, string> = {
  creado: "Perfil creado.",
  guardado: "Cambios guardados.",
  eliminado: "Perfil eliminado.",
};

export default async function ProfilesPage({ searchParams }: PageProps<"/app/alumnos">) {
  const ctx = await requireWorkspace();
  const params = await searchParams;
  const notice = typeof params.aviso === "string" ? NOTICES[params.aviso] : undefined;

  const [profiles, catalog, usage, entitlement, count] = await Promise.all([
    listProfiles(ctx.workspace.id),
    getCatalog(),
    getWorkspaceUsage(ctx.workspace.id),
    checkEntitlement(ctx, "profile.create"),
    countActiveProfiles(ctx.workspace.id),
  ]);
  const limitReached = !entitlement.allowed && entitlement.reason === "limit_reached";
  const canCreate = entitlement.allowed;
  const remaining = Math.max(0, usage.max_profiles - count);

  return (
    <div className="space-y-8">
      <PageHeader
        icon={Users}
        title="Perfiles de alumnado"
        description="Define los apoyos una vez y reutilízalos al adaptar tus materiales. Identifica cada perfil con un alias o iniciales."
        actions={
          canCreate ? (
            <LinkButton href="/app/alumnos/nuevo">
              Nuevo perfil
            </LinkButton>
          ) : null
        }
      />

      <p className="text-sm text-muted-foreground">{count} de {usage.max_profiles} perfiles utilizados en {usage.plan.name} · {remaining} {remaining === 1 ? "disponible" : "disponibles"}</p>

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {limitReached ? (
        <LimitReachedCard title={limitCopy(usage.plan.name, entitlement.limit)} upgrade={await getUpgradeCta(entitlement)}>
          Puedes eliminar un perfil que ya no uses para crear otro.
        </LimitReachedCard>
      ) : null}

      {profiles.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Todavía no tienes perfiles"
          description="Crea un perfil para reutilizar las mismas adaptaciones en diferentes materiales."
        >
          {canCreate ? <LinkButton href="/app/alumnos/nuevo" variant="secondary">Nuevo perfil</LinkButton> : null}
        </EmptyState>
      ) : (
        <ProfileDirectory items={profiles.map((p) => {
          const labels = labelsFor(catalog, p.stage_slug, p.grade_slug);
          const { shown, more } = teaser(summarizeProfile(p.functional_profile));
          return { id: p.id, name: p.display_name, grade: labels.grade ?? "", stage: labels.stage ?? "", gradeSlug: p.grade_slug ?? "", updatedAt: p.updated_at,
            summary: shown.length ? `${shown.join(" · ")}${more > 0 ? ` · y ${more} más` : ""}` : "Sin ajustes configurados" };
        })} />
      )}
    </div>
  );
}
