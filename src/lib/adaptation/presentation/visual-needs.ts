import type { RequestedVisual, ResourceState } from "@/lib/adaptation/resources/service";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import type { VisualState } from "@/lib/render/visual-assets";

/**
 * What the teacher sees about the visuals of a delivered sheet (docs/VISUAL_RESOURCES.md), in plain words: never a technical state
 * (`missing_locator`, `asset_missing`…). Each need says which activity it belongs to, whether the printed sheet waits for it, and
 * which actions are safe: «Seleccionar imagen» (a visual of the original), «Añadir recurso» and «Continuar sin esta imagen» (a
 * visual the original does not have). Original essential visuals can never be skipped: the activity would be unsolvable.
 */
export type VisualNeedStatus = "to_select" | "ready" | "to_provide" | "provided" | "omitted";

export interface VisualNeed {
  key: string;
  origin: "original" | "requested";
  essential: boolean;
  status: VisualNeedStatus;
  /** The printed caption of the original visual, or what the decision wanted the visual for. */
  label: string;
  activity: string | null;
  message: string;
  /** «Continuar sin esta imagen» is offered (and accepted by the server) only where the sheet stays solvable without it. */
  omittable: boolean;
}

const activityOf = (document: MaterialDocument, blockId: string | undefined) => {
  if (!blockId) return null;
  const activity = allBlocks(document).find((b) => b.type === "activity" && (b.resource_block_ids ?? []).includes(blockId));
  return activity?.type === "activity" ? (activity.label ? `Actividad ${activity.label}` : "Una actividad") : null;
};

function originalMessage(essential: boolean, status: VisualNeedStatus, page?: number) {
  if (status === "ready") return page ? `Imagen del documento original incluida (seleccionada en la página ${page}).` : "Imagen del documento original incluida.";
  return essential ? "Esta actividad necesita una imagen del documento original." : "Hay una imagen del documento original que se puede incluir si quieres.";
}

function requestedMessage(essential: boolean, status: VisualNeedStatus) {
  if (status === "provided") return "Recurso añadido.";
  if (status === "omitted") return "Se decidió continuar sin este recurso.";
  if (!essential) return "Apoyo visual opcional: la ficha se puede imprimir sin él.";
  return "Esta actividad necesita un recurso visual que no está en el documento original: añádelo para poder imprimir la ficha.";
}

export function visualNeedsOf(input: { document: MaterialDocument; visuals: VisualState[]; requiredVisuals: readonly string[]; requested: Array<RequestedVisual & { state: ResourceState }> }): VisualNeed[] {
  const blocks = allBlocks(input.document);
  const original: VisualNeed[] = input.visuals.map((v) => {
    const block = blocks.find((b) => b.type === "image" && b.source.kind === "original" && b.source.visual_ref === v.visualId);
    const essential = input.requiredVisuals.includes(v.visualId);
    const status: VisualNeedStatus = v.status === "ready" ? "ready" : "to_select";
    return { key: v.visualId, origin: "original", essential, status, label: (block?.type === "image" ? block.caption : undefined) ?? "Imagen del documento original", activity: activityOf(input.document, block?.id), message: originalMessage(essential, status, v.provenance?.page), omittable: false };
  });
  const requested: VisualNeed[] = input.requested.map((r) => {
    const block = blocks.find((b) => b.type === "image" && b.source.kind === "requested" && b.source.decision_id === r.decisionId);
    const status: VisualNeedStatus = r.state.status === "provided" ? "provided" : r.state.status === "omitted" ? "omitted" : "to_provide";
    return { key: r.decisionId, origin: "requested", essential: r.essential, status, label: r.purpose, activity: activityOf(input.document, block?.id), message: requestedMessage(r.essential, status), omittable: r.omittable };
  });
  return [...original, ...requested];
}

/** Needs the printed sheet waits for: an essential visual still to select or to provide. */
export const blockingNeeds = (needs: readonly VisualNeed[]) => needs.filter((n) => n.essential && (n.status === "to_select" || n.status === "to_provide"));
