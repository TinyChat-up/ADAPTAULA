import type { Block, MaterialDocument } from "@/lib/schemas/material-document";

/**
 * Execution of the decisions the pipeline deferred to the renderer (`deferred_to_renderer`: layout intents on something that
 * already exists, "segment"/"reorganize" without a help to write). The renderer executes only what it can do WITHOUT touching
 * content: `isolate` gives an activity its own visual group (more room, kept together, a rule above). Anything else is reported
 * as `unsupported`, a target that is no longer in the sheet as `not_applicable`; nothing is ever claimed as applied without an
 * executor. These outcomes are for the teacher/debug view, never for the student's sheet.
 */
export interface DeferredInput {
  id: string;
  target: string;
  action: string;
}

export type DeferredStatus = "applied" | "unsupported" | "not_applicable";
export interface DeferredOutcome extends DeferredInput {
  status: DeferredStatus;
  instruction?: "isolate_activity";
  reason: string;
}

const LAYOUT_ACTIONS = new Set(["segment", "reorganize"]);
const blocksOf = (doc: Pick<MaterialDocument, "pages">): Block[] => doc.pages.flatMap((p) => p.blocks);

export interface DeferredPlan {
  outcomes: DeferredOutcome[];
  /** Block ids of the activities that get the `isolate` presentation. */
  isolate: Set<string>;
}

export function planDeferred(doc: Pick<MaterialDocument, "pages">, deferred: readonly DeferredInput[]): DeferredPlan {
  const blocks = blocksOf(doc);
  const isolate = new Set<string>();
  const outcomes = deferred.map((d): DeferredOutcome => {
    if (!LAYOUT_ACTIONS.has(d.action)) return { ...d, status: "unsupported", reason: `La acción «${d.action}» no tiene ejecutor en la presentación` };
    const activities = blocks.filter((b) => b.type === "activity" && (d.target === "document" || b.trace.source_refs.includes(d.target)));
    if (d.target !== "document" && !blocks.some((b) => b.trace.source_refs.includes(d.target))) return { ...d, status: "not_applicable", reason: "El elemento ya no está en la ficha" };
    if (activities.length === 0) return { ...d, status: "unsupported", reason: "Solo se sabe separar visualmente actividades; este elemento no es una actividad" };
    for (const a of activities) isolate.add(a.id);
    return { ...d, status: "applied", instruction: "isolate_activity", reason: "Cada actividad afectada se muestra como un grupo propio, con más espacio y sin partirse" };
  });
  return { outcomes, isolate };
}
