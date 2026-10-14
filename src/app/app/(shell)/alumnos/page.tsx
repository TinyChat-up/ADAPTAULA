import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { LimitReachedCard } from "@/components/app/limit-reached-card";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { requireWorkspace } from "@/lib/auth/workspace";
import { formatDay } from "@/lib/format/date";
import { checkEntitlement } from "@/lib/permissions/check-entitlement";
import { limitCopy } from "@/lib/plans/format";
import { getUpgradeCta } from "@/lib/plans/upgrade";
import { getWorkspaceUsage } from "@/lib/plans/usage";
import { labelsFor } from "@/lib/profiles/catalog";
import { getCatalog, listProfiles } from "@/lib/profiles/repository";
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

  const [profiles, catalog, usage, entitlement] = await Promise.all([
    listProfiles(ctx.workspace.id),
    getCatalog(),
    getWorkspaceUsage(ctx.workspace.id),
    checkEntitlement(ctx, "profile.create"),
  ]);
  const limitReached = !entitlement.allowed && entitlement.reason === "limit_reached";
  const canCreate = entitlement.allowed;

  return (
    <div className="space-y-8">
      <PageHeader
        icon={Users}
        title="Perfiles de alumnado"
        description="Guarda las necesidades de cada alumno o alumna una vez y reutilízalas en todos tus materiales."
        actions={
          canCreate ? (
            <LinkButton href="/app/alumnos/nuevo">
              Nuevo perfil
            </LinkButton>
          ) : null
        }
      />

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
        <ul className="editorial-list">
          {profiles.map((p) => {
            const labels = labelsFor(catalog, p.stage_slug, p.grade_slug);
            const { shown, more } = teaser(summarizeProfile(p.functional_profile));
            return (
              <li key={p.id}>
                <Link href={`/app/alumnos/${p.id}`} className="group block py-6 transition-colors duration-150 hover:bg-surface/60">
                  <span className="block min-w-0 space-y-2">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-lg font-semibold">{p.display_name}</span>
                      <span className="text-sm text-muted-foreground">{[labels.stage, labels.grade].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {shown.length > 0 ? `${shown.join(" · ")}${more > 0 ? ` · y ${more} más` : ""}` : "Sin ajustes configurados"}
                    </span>
                    <span className="block text-xs text-muted-foreground">Actualizado el {formatDay(p.updated_at)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
