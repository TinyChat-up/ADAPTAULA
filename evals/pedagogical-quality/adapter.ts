import { z } from "zod";
import { SUPPORT_KINDS, type AdaptedSheet, type OriginalSheet } from "./contract";

/**
 * Controlled adapter (Phase III, no model): applies a hand-written plan to the transcription of the ORIGINAL sheet. It only
 * receives the original and the plan; it never sees the reference used to score (answers, elements to keep, unacceptable
 * changes), so a candidate cannot pass because it was built from its own answer key. `tests/unit/pedagogical-quality.test.ts`
 * checks this module does not import the reference.
 */

const Support = z.object({ kind: z.enum(SUPPORT_KINDS), text: z.string().min(1), addresses: z.array(z.string()).default([]) });

export const AdaptationPlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  description: z.string().max(300),
  /** Paragraph segmentation of a source text (one block per original paragraph, with a visible marker). */
  segmentTexts: z.array(z.string()).default([]),
  activities: z.record(z.string(), z.object({
    instruction: z.string().min(3).optional(),
    content: z.string().optional(),
    supports: z.array(Support).default([]),
  })).default({}),
});
export type AdaptationPlan = z.infer<typeof AdaptationPlanSchema>;

const segment = (text: string) => text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).map((p) => `▸ ${p}`).join("\n\n");

export function adapt(original: OriginalSheet, plan: AdaptationPlan): AdaptedSheet {
  return {
    referenceId: original.id,
    producedBy: `adaptador_controlado:${plan.id}`,
    sourceTexts: original.sourceTexts.map((t) => ({ id: t.id, text: plan.segmentTexts.includes(t.id) ? segment(t.text) : t.text })),
    activities: original.activities.map((a) => {
      const p = plan.activities[a.id];
      return { sourceIds: [a.id], number: a.number, instruction: p?.instruction ?? a.instruction, content: p?.content ?? a.content, operations: [...a.operations], supports: (p?.supports ?? []).map((s) => ({ ...s, addresses: [...s.addresses] })) };
    }),
    figures: original.figures.map((f) => ({ id: f.id, activityIds: [...f.activityIds], kind: f.kind, facts: { ...f.facts } })),
  };
}
