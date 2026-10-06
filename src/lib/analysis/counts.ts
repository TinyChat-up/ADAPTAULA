import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";

type Counts = MaterialAnalysis["structure"]["counts"];
type CountInput = Pick<MaterialAnalysis, "sections" | "texts" | "visuals" | "activities">;

/**
 * Exact semantics of `structure.counts`. They are computed from the FINAL graph, never by the model, and every entity is
 * counted in exactly one visual category because a table, a chart or a figure is a single entity with a single `kind`:
 *
 * - sections           number of sections.
 * - activities         number of activities.
 * - responses_required activities whose `response_format` is not "none" (the student must produce something).
 * - answer_spaces      activities whose ORIGINAL sheet offers a physical answer area (`answer_area.type` neither "none" nor
 *                      "unknown"). It says nothing about whether a response is required.
 * - reading_texts      texts of kind "reading_text".
 * - examples           texts of kind "example".
 * - formulas           texts of kind "formula".
 * - tables             visuals of kind "table" (the data lives in `table`; there is no second "table image").
 * - charts             visuals of kind "chart".
 * - images             visuals of kind "image" that are not decorative.
 * - figures            visuals of kind "diagram", "geometric_figure", "number_line", "map" or "other" that are not decorative.
 * - decorative         visuals that are decorative (kind "decorative" or role "decorative"): never part of the previous four.
 */
export function computeCounts(a: CountInput): Counts {
  const decorative = (v: CountInput["visuals"][number]) => v.kind === "decorative" || v.role === "decorative";
  const meaningful = a.visuals.filter((v) => !decorative(v));
  return {
    sections: a.sections.length,
    activities: a.activities.length,
    responses_required: a.activities.filter((x) => x.response_format !== "none").length,
    answer_spaces: a.activities.filter((x) => x.answer_area.type !== "none" && x.answer_area.type !== "unknown").length,
    reading_texts: a.texts.filter((t) => t.kind === "reading_text").length,
    examples: a.texts.filter((t) => t.kind === "example").length,
    formulas: a.texts.filter((t) => t.kind === "formula").length,
    tables: meaningful.filter((v) => v.kind === "table").length,
    charts: meaningful.filter((v) => v.kind === "chart").length,
    images: meaningful.filter((v) => v.kind === "image").length,
    figures: meaningful.filter((v) => ["diagram", "geometric_figure", "number_line", "map", "other"].includes(v.kind)).length,
    decorative: a.visuals.filter(decorative).length,
  };
}
