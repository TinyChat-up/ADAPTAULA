import type { Decision } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";

/**
 * What a plan decision asks for visually, and who can provide it (docs/VISUAL_RESOURCES.md). No model draws or invents an image:
 *  - `original`  a visual of the original material (`reuse_original`, or `transform_original` of a visual): the assembler keeps it,
 *                as the original or rebuilt from its verified table/chart data, next to its activity. A transformation the
 *                renderer cannot make is NOT pretended: the original is kept and the report says so.
 *  - `requested` a visual the original does not have (`new_representation`, `optional_support`, or a plain `visual_cue`): the
 *                assembler reserves its place in the sheet and the teacher provides it, or decides explicitly to go on without it.
 *                Essential ones block the printed sheet until then; optional ones never do.
 */
export type VisualTreatment =
  | { kind: "original"; visualId: string; structured: boolean; requestedTransform: boolean }
  | { kind: "requested"; essential: boolean; purpose: string; style: "diagram" | "icon" };

const DEFAULT_PURPOSE = "Apoyo visual para la actividad";

/** Actions whose visual part the assembler carries out by itself: they add or arrange, none rewrites the target. */
export const VISUAL_ACTIONS: ReadonlySet<Decision["action"]> = new Set<Decision["action"]>(["add_support", "reorganize", "segment", "keep"]);

export function visualTreatment(decision: Pick<Decision, "visual" | "supports" | "note">, analysis: Pick<MaterialAnalysis, "visuals">): VisualTreatment | null {
  const visual = decision.visual;
  if (visual && (visual.mode === "reuse_original" || visual.mode === "transform_original") && visual.source_visual) {
    const source = analysis.visuals.find((v) => v.id === visual.source_visual);
    if (!source) return null;
    return { kind: "original", visualId: source.id, structured: !!(source.table || source.chart), requestedTransform: visual.mode === "transform_original" };
  }
  if (visual && (visual.mode === "new_representation" || visual.mode === "optional_support")) {
    return { kind: "requested", essential: visual.essential && visual.mode === "new_representation", purpose: visual.purpose, style: visual.mode === "new_representation" ? "diagram" : "icon" };
  }
  if (decision.supports.some((s) => s.kind === "visual_cue")) return { kind: "requested", essential: false, purpose: decision.note ?? DEFAULT_PURPOSE, style: "icon" };
  return null;
}
