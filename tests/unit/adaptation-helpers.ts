import { buildAdaptationContext } from "@/lib/adaptation/context";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { protectedFor } from "@/lib/adaptation/facts";
import { validatePlan } from "@/lib/adaptation/invariants";
import { normalizePlan } from "@/lib/adaptation/plan";
import { buildReview, checkOf } from "@/lib/adaptation/review";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, DraftDecision } from "@/lib/schemas/adaptation-plan";
import type { AdaptationType } from "@/lib/schemas/adaptation-type";
import type { GeneratedSegments } from "@/lib/schemas/ai-contracts";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block, type DraftBlock, type MaterialDocument } from "@/lib/schemas/material-document";
import type { ReviewCheck } from "@/lib/schemas/pedagogical-review";

export function contextFor(analysis: MaterialAnalysis, profile: FunctionalProfile, adaptationType: AdaptationType = "accessibility"): AdaptationContext {
  return buildAdaptationContext({ profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType }).context;
}

export function decision(over: Partial<DraftDecision> & Pick<DraftDecision, "target" | "action">): DraftDecision {
  return { strategies: [], dimensions: [], intensity: "moderate", preserves: [], supports: [], flags: [], ...over };
}

export function planOf(analysis: MaterialAnalysis, context: AdaptationContext, decisions: DraftDecision[]): AdaptationPlan {
  return normalizePlan({ decisions, summary: [] }, analysis, context);
}

/** Every protected element that concerns a target: what a careful planner declares. */
export const allPreserved = (analysis: MaterialAnalysis, target: string) => protectedFor(analysis, target).map((p) => p.id);

export function issuesOf(analysis: MaterialAnalysis, context: AdaptationContext, decisions: DraftDecision[]): string[] {
  return validatePlan(planOf(analysis, context, decisions), analysis, context).issues.map((i) => `${i.severity}:${i.flag}`);
}

export function segment(target: string, decisionId: string, blocks: DraftBlock[]): GeneratedSegments {
  return { segments: [{ target, decision_ids: [decisionId], blocks, new_item_answers: [] }], change_summary: ["Cambio de prueba"] };
}

export const adapted = (target: string, decisionId: string) => ({ origin: "adapted" as const, source_refs: [target], decision_ids: [decisionId] });

export function documentOf(analysis: MaterialAnalysis, plan: AdaptationPlan, context: AdaptationContext, generated: GeneratedSegments | null = null): MaterialDocument {
  return buildDocument({ analysis, plan, context, generated, newBlockId: sequentialIds() });
}

export function statusOf(analysis: MaterialAnalysis, plan: AdaptationPlan, context: AdaptationContext, document: MaterialDocument, check: ReviewCheck) {
  return checkOf(buildReview({ analysis, plan, context, document }), check);
}

/** Returns a copy of the document with the blocks matching `pick` transformed (bypassing generation, as a faulty model would). */
export function mutate(document: MaterialDocument, pick: (b: Block) => boolean, change: (b: Block) => Block | null): MaterialDocument {
  const copy = structuredClone(document);
  copy.pages = copy.pages.map((p) => ({ blocks: p.blocks.map((b) => (pick(b) ? change(b) : b)).filter((b): b is Block => b !== null) })).filter((p) => p.blocks.length > 0);
  return copy;
}

export const firstActivityBlock = (document: MaterialDocument, ref: string) => allBlocks(document).find((b) => b.type === "activity" && b.trace.source_refs.includes(ref))!;
