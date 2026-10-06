import { z } from "zod";
import { AdaptationActionSchema, DecisionIdSchema, IntensitySchema, ProtectedRefSchema, StrategyKeySchema, type AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import { IMPORTANCE, type MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { BlockIdSchema, BlockSchema, MaterialDocumentSchema, allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { REVIEW_CHECKS, type PedagogicalReview } from "@/lib/schemas/pedagogical-review";

/**
 * Teacher corrections (docs/ADAPTATION.md § Corrección docente). Each one is local: editing a block creates a new document
 * version with only that block changed; overriding a decision marks only its blocks for regeneration; reinterpreting a
 * protected element is an overlay on the analysis (the stored analysis is never rewritten); accepting a review warning
 * keeps the original status for audit. Nothing here regenerates the whole material.
 */

export const TeacherCorrectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("block_edit"), block_id: BlockIdSchema, block: BlockSchema }),
  z.object({ kind: z.literal("instruction_edit"), block_id: BlockIdSchema, text: z.string().trim().min(1).max(3000) }),
  z.object({
    kind: z.literal("decision_override"),
    decision_id: DecisionIdSchema,
    action: AdaptationActionSchema.optional(),
    intensity: IntensitySchema.optional(),
    strategies: z.array(StrategyKeySchema).max(3).optional(),
    discard: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("protected_reinterpretation"),
    protected_id: ProtectedRefSchema,
    importance: z.enum(IMPORTANCE).optional(),
    value: z.string().trim().min(1).max(300).optional(),
    dismissed: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("review_override"), check: z.enum(REVIEW_CHECKS), note: z.string().max(240).optional() }),
]);
export type TeacherCorrection = z.infer<typeof TeacherCorrectionSchema>;

/** Replaces one block, keeping its id and marking its trace as edited. Every other block is untouched (same objects). */
export function applyBlockEdit(doc: MaterialDocument, blockId: string, replacement: Block): MaterialDocument {
  if (!allBlocks(doc).some((b) => b.id === blockId)) throw new Error(`No existe el bloque ${blockId}`);
  const original = allBlocks(doc).find((b) => b.id === blockId)!;
  const edited = { ...replacement, id: blockId, trace: { ...original.trace, teacher_edited: true } } as Block;
  return MaterialDocumentSchema.parse({ ...doc, pages: doc.pages.map((p) => ({ blocks: p.blocks.map((b) => (b.id === blockId ? edited : b)) })) });
}

export function applyInstructionEdit(doc: MaterialDocument, blockId: string, text: string): MaterialDocument {
  const block = allBlocks(doc).find((b) => b.id === blockId);
  if (!block) throw new Error(`No existe el bloque ${blockId}`);
  if (block.type === "activity") return applyBlockEdit(doc, blockId, { ...block, prompt: text });
  if (block.type === "instruction") return applyBlockEdit(doc, blockId, { ...block, text });
  throw new Error("Solo se editan como instrucción las actividades y las instrucciones");
}

/** Blocks produced by a decision: the only ones to regenerate when the teacher changes or discards it. */
export function blocksOfDecision(doc: MaterialDocument, decisionId: string): string[] {
  return allBlocks(doc).filter((b) => b.trace.decision_ids.includes(decisionId)).map((b) => b.id);
}

export function applyDecisionOverride(plan: AdaptationPlan, correction: Extract<TeacherCorrection, { kind: "decision_override" }>): AdaptationPlan {
  if (correction.discard) return { ...plan, decisions: plan.decisions.filter((d) => d.id !== correction.decision_id) };
  return {
    ...plan,
    decisions: plan.decisions.map((d) =>
      d.id === correction.decision_id
        ? { ...d, action: correction.action ?? d.action, intensity: correction.intensity ?? d.intensity, strategies: correction.strategies ?? d.strategies }
        : d,
    ),
  };
}

/** The teacher's reading of the protected elements, applied in memory before building the context and checking. */
export function applyProtectedOverlay(analysis: MaterialAnalysis, corrections: TeacherCorrection[]): MaterialAnalysis {
  const overlay = corrections.filter((c): c is Extract<TeacherCorrection, { kind: "protected_reinterpretation" }> => c.kind === "protected_reinterpretation");
  if (overlay.length === 0) return analysis;
  const dismissed = new Set(overlay.filter((c) => c.dismissed).map((c) => c.protected_id));
  return {
    ...analysis,
    protected_elements: analysis.protected_elements
      .filter((p) => !dismissed.has(p.id))
      .map((p) => {
        const c = overlay.find((x) => x.protected_id === p.id);
        return c ? { ...p, importance: c.importance ?? p.importance, value: c.value ?? p.value } : p;
      }),
  };
}

/** Marks a review check as knowingly accepted by the teacher; the verdict ignores it, the original status stays. */
export function applyReviewOverride(review: PedagogicalReview, check: (typeof REVIEW_CHECKS)[number], note?: string): PedagogicalReview {
  return { ...review, checks: review.checks.map((c) => (c.check === check && c.status !== "PASS" ? { ...c, teacher_override: { accepted: true as const, note } } : c)) };
}
