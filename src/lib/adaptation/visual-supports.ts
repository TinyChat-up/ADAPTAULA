import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, MaterialDocumentSchema, type MaterialDocument } from "@/lib/schemas/material-document";
import { analogFractionBlocks } from "@/lib/visuals/analog-example";
import { sameValue } from "@/lib/visuals/spec";
import { answerSignatures, leakedSignature, normalizeText } from "./text";

/** Deliberately narrow: a literal, single operation with equal denominators; never inferred from a story or a drawing. */
export function addVisualSupports(document: MaterialDocument, analysis: MaterialAnalysis, context: AdaptationContext): MaterialDocument {
  if (!context.visual_supports?.requested || !context.needs.some((n) => ["visual_math_support", "number_sense_support", "worked_examples"].includes(n.dimension))) return document;
  const ids = new Set(allBlocks(document).map((b) => b.id));
  const signatures = analysis.activities.flatMap((a) => answerSignatures(a.expected_answer.value ?? "", new Set()));
  const answerFractions = signatures.flatMap((s) => [...s.matchAll(/(\d+)\/(\d+)/g)].map((m) => ({ n: Number(m[1]), d: Number(m[2]) })));
  let added = false;
  const pages = document.pages.map((page) => ({ ...page, blocks: page.blocks.flatMap((block) => {
    if (added || block.type !== "activity") return [block];
    const activity = analysis.activities.find((a) => block.trace.source_refs.includes(a.id));
    if (!activity || activity.type !== "calculation" || allBlocks(document).some((b) => (b.type === "worked_example" || b.type === "image") && b.trace.source_refs.includes(activity.id))) return [block];
    const literal = normalizeText(activity.instruction);
    const match = /^(?:calcula|resuelve|opera)\s*:?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*([+−-])\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*[.¿?]?$/u.exec(literal);
    if (!match) return [block];
    const exercise = { left: { n: Number(match[1]), d: Number(match[2]) }, right: { n: Number(match[4]), d: Number(match[5]) }, operation: match[3] === "+" ? "add" : "subtract" };
    const exampleId = `blk_vex${activity.id.slice(4)}`, figureId = `blk_vfig${activity.id.slice(4)}`;
    if (ids.has(exampleId) || ids.has(figureId)) return [block];
    for (const d of [6, 8, 10, 12]) {
      const example = { left: { n: 5, d }, right: { n: 1, d }, operation: exercise.operation };
      const result = { n: exercise.operation === "add" ? 6 : 4, d };
      if ([example.left, example.right, result].some((f) => answerFractions.some((a) => a.d > 0 && sameValue(f, a)))) continue;
      try {
        const blocks = analogFractionBlocks({ exercise, example }, { example: exampleId, figure: figureId, activityRef: activity.id });
        const text = blocks.filter((b) => b.type === "worked_example").map((b) => JSON.stringify(b)).join(" ");
        if (leakedSignature(text, signatures)) continue;
        added = true;
        return [...blocks, block];
      } catch { /* Unsupported or equivalent example: try a different, exact denominator. */ }
    }
    return [block];
  }) }));
  return added ? MaterialDocumentSchema.parse({ ...document, pages }) : document;
}
