import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import type { PedagogicalReview, ReviewCheck } from "@/lib/schemas/pedagogical-review";
import type { NormalizedGeneration } from "./generated";

/**
 * Localized repair of lost original content («Hacer magia»). When a generated REWRITE of an activity (or a text) loses what had to
 * be kept (a datum, a condition, a protected element), the faithful fix needs no model: the original is put back and the supports
 * generated for it stay. Only the rewrite is discarded, and only when every decision keeps at least one block of its own (a
 * decision whose whole adaptation WAS the rewrite is not silently emptied: that one is regenerated with a restriction instead).
 * The checks are never touched: the restored sheet is reviewed again, from scratch, by the same checks.
 */

/** Checks whose FAIL means the original's content did not survive. */
export const PRESERVATION_CHECKS: readonly ReviewCheck[] = ["protected_elements_preserved", "constraints_preserved", "required_data_preserved", "instructions_complete"];

/** Blocks that REPLACE an original unit (`buildDocument`); every other generated block is a support placed next to it. */
const REPLACEMENT_TYPES: ReadonlySet<string> = new Set(["activity", "paragraph", "reading_text"]);

/** The original units (activities, texts, visuals) that the failing preservation checks point at. */
export function preservationRefs(review: Pick<PedagogicalReview, "checks">, analysis: Pick<MaterialAnalysis, "protected_elements">, document: MaterialDocument): Set<string> {
  const refs = new Set<string>();
  const blocks = allBlocks(document);
  for (const check of review.checks) {
    if (check.status !== "FAIL" || check.teacher_override || !PRESERVATION_CHECKS.includes(check.check)) continue;
    for (const target of check.targets) {
      if (/^(act|ctt|vis)_/.test(target)) refs.add(target);
      else if (target.startsWith("prt_")) {
        const element = analysis.protected_elements.find((p) => p.id === target);
        for (const id of [...(element?.activity_ids ?? []), ...(element?.resource_ids ?? [])]) refs.add(id);
      } else if (target.startsWith("blk_")) for (const ref of blocks.find((b) => b.id === target)?.trace.source_refs ?? []) refs.add(ref);
    }
  }
  return refs;
}

type Segment = NormalizedGeneration["segments"]["segments"][number];

const decisionsWithBlocks = (segments: readonly Segment[]) => new Set(segments.flatMap((s) => s.decision_ids));

/**
 * The same generation with the original of `refs` put back: the replacement blocks of those units are dropped, their supports stay.
 * A unit is restored only if no decision is left without any block. Null when nothing could be restored.
 */
export function withOriginals(generation: NormalizedGeneration, refs: ReadonlySet<string>): { generation: NormalizedGeneration; restored: string[] } | null {
  let segments = [...generation.segments.segments];
  const before = decisionsWithBlocks(segments);
  const restored: string[] = [];
  const candidates = [...new Set(segments.filter((s) => refs.has(s.target) && s.blocks.some((b) => REPLACEMENT_TYPES.has(b.type))).map((s) => s.target))].sort();
  for (const ref of candidates) {
    const next = segments.flatMap((s) => {
      if (s.target !== ref) return [s];
      const kept = s.blocks.filter((b) => !REPLACEMENT_TYPES.has(b.type));
      return kept.length > 0 ? [{ ...s, blocks: kept }] : [];
    });
    const after = decisionsWithBlocks(next);
    if ([...before].some((id) => !after.has(id))) continue;
    segments = next;
    restored.push(ref);
  }
  if (restored.length === 0) return null;
  return { generation: { ...generation, segments: { ...generation.segments, segments } }, restored };
}
