import { ImageIcon } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { blockingNeeds, type VisualNeed } from "@/lib/adaptation/presentation/visual-needs";
import { ResourceActions } from "./resource-actions";

/**
 * The visuals of a delivered sheet, for the teacher, OUTSIDE the sheet (hidden in print): what each activity still needs and the
 * one safe action for it. Shown first on the sheet page, so finishing a sheet that waits for an image is the obvious next step.
 * Read-only members see the state without actions.
 */
function NeedRow({ need, adaptationId, canWrite, locateHref }: { need: VisualNeed; adaptationId: string; canWrite: boolean; locateHref: (visualId: string) => string }) {
  const done = need.status === "ready" || need.status === "provided" || need.status === "omitted";
  return (
    <li className="space-y-2 rounded-card border border-border p-3">
      <p className="text-sm">
        {need.activity ? <span className="font-semibold">{need.activity}: </span> : null}
        {need.message}
      </p>
      <p className="text-sm text-muted-foreground">
        {need.origin === "original" ? need.label : `Recurso: ${need.label}`}
        {need.essential && !done ? " · imprescindible para imprimir la ficha" : ""}
      </p>
      {canWrite && need.origin === "original" ? (
        <LinkButton size="sm" variant={need.status === "ready" ? "secondary" : "primary"} href={locateHref(need.key)}>
          {need.status === "ready" ? "Cambiar la selección" : "Seleccionar imagen"}
        </LinkButton>
      ) : null}
      {canWrite && need.origin === "requested" ? (
        <ResourceActions adaptationId={adaptationId} decisionId={need.key} canOmit={need.status === "to_provide"} hasResource={need.status === "provided"} />
      ) : null}
    </li>
  );
}

export function VisualNeedsPanel({ needs, adaptationId, canWrite, locateHref }: { needs: VisualNeed[]; adaptationId: string; canWrite: boolean; locateHref: (visualId: string) => string }) {
  if (needs.length === 0) return null;
  const blocking = blockingNeeds(needs);
  const open = needs.filter((n) => n.status === "to_select" || n.status === "to_provide");
  return (
    <section className="ms-chrome space-y-3" aria-labelledby="recursos-visuales">
      <h2 id="recursos-visuales" className="flex items-center gap-2 text-lg font-semibold">
        <ImageIcon aria-hidden className="size-5" />
        Imágenes y recursos visuales
      </h2>
      {blocking.length > 0 ? (
        <Alert tone="warning" title={blocking.length === 1 ? "Falta una imagen para poder imprimir la ficha" : `Faltan ${blocking.length} imágenes para poder imprimir la ficha`}>
          {canWrite ? "Complétala aquí: no hace falta crear otra adaptación." : "Tienes acceso de solo lectura: quien edita este espacio de trabajo puede completarla."}
        </Alert>
      ) : open.length === 0 ? null : (
        <p className="text-sm text-muted-foreground">La ficha se puede imprimir. Puedes añadir los apoyos opcionales si quieres.</p>
      )}
      <ul className="space-y-3">
        {needs.map((need) => (
          <NeedRow key={need.key} need={need} adaptationId={adaptationId} canWrite={canWrite} locateHref={locateHref} />
        ))}
      </ul>
    </section>
  );
}
