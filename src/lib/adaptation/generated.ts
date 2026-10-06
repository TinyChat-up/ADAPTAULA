import type { DraftGeneratedSegments, GeneratedSegments } from "@/lib/schemas/ai-contracts";
import { CLOSED_RESPONSES, type Decision, type SupportKind } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { DraftBlock } from "@/lib/schemas/material-document";
import { responseForDecision } from "./document";
import type { ReviewedPlan } from "./plan-review";

/**
 * Draft segments (what the generator wrote) → `GeneratedSegments` (what `buildDocument` assembles). This is where the rules of
 * the effective plan are enforced on a model's output, whatever the model: segments for decisions that are not applied are
 * dropped, a segment can only live at its decision's target, and only the block types an approved decision authorises are
 * accepted. Ids, traces, answer areas and resource links are filled in by the server, never taken from the model.
 */

/** Blocks each support kind may produce. A support not in the effective decision authorises nothing (a removed `sentence_starters` stays removed). */
export const SUPPORT_BLOCKS: Record<SupportKind, readonly string[]> = {
  glossary: ["vocabulary"],
  key_idea: ["help_box"],
  reminder: ["help_box"],
  checklist: ["checklist"],
  planner: ["planner"],
  sentence_starters: ["sentence_starters"],
  worked_example: ["worked_example"],
  guiding_questions: ["list", "help_box"],
  step_list: ["list"],
  self_check: ["checklist"],
  visual_cue: ["help_box"],
  extension_task: ["help_box"],
};

/** Actions that replace the target's own block with a rewritten one (a segmented activity, a rephrased text). */
const REWRITING = new Set(["segment", "rephrase", "reduce", "reorganize", "change_response_format"]);

export type GenerationIssueCode =
  | "unapproved_decision"
  | "target_mismatch"
  | "unauthorized_block"
  | "multiple_activity_blocks"
  | "unsupported_response_format"
  | "model_blocked"
  | "no_segment"
  // generator v2
  | "unauthorized_support"
  | "rewrite_not_needed"
  | "rewrite_lost_requirements"
  | "rewrite_copies_original"
  | "redundant_support_dropped"
  | "duplicate_item_dropped"
  | "unsupported_action"
  | "skipped_support"
  | "near_duplicate"
  | "support_over_budget"
  | "planner_label_restates";

/** The model proposed something its decisions do not authorise (counted as non-compliance; the server already dropped it). */
export const UNAUTHORIZED_CODES: readonly GenerationIssueCode[] = ["unapproved_decision", "target_mismatch", "unauthorized_block", "multiple_activity_blocks", "unauthorized_support", "rewrite_not_needed"];
/** The model wrote something redundant or lossy that the server dropped or replaced by the original. */
export const REDUNDANCY_CODES: readonly GenerationIssueCode[] = ["rewrite_lost_requirements", "rewrite_copies_original", "redundant_support_dropped", "duplicate_item_dropped"];

export interface GenerationIssue {
  code: GenerationIssueCode;
  decision_id: string | null;
  detail: string;
}

export interface NormalizedGeneration {
  /** Which generator contract produced the draft. */
  version: 1 | 2;
  segments: GeneratedSegments;
  issues: GenerationIssue[];
  /** Effective decisions the generator was asked to execute. */
  requested: string[];
  /** Effective decisions that ended up with at least one block. */
  generated: string[];
  /** Effective decisions with neither a block nor a structured refusal: approved and ignored. */
  ignored: string[];
  /** Decisions the model declined with a structured reason. */
  declined: string[];
  /** Effective decisions satisfied by KEEPING the original (v2: a short instruction is never rewritten). Not ignored, not requested. */
  preserved: string[];
}

/**
 * Decisions the generator has to write something for: those that add a support or rewrite an activity or a text. `keep`,
 * `remove` and pure layout decisions (reorganising a document or a visual) need no model: layout is the renderer's.
 */
export function decisionsToGenerate(effective: readonly Decision[], analysis: MaterialAnalysis): Decision[] {
  return effective.filter((d) => {
    if (d.action === "keep" || d.action === "remove") return false;
    // Segmenting a source text is deterministic (the assembler labels its paragraphs): only a rephrase of a text needs the model.
    const rewritable = analysis.activities.some((a) => a.id === d.target) || (analysis.texts.some((t) => t.id === d.target) && d.action === "rephrase");
    return d.supports.length > 0 || (REWRITING.has(d.action) && rewritable);
  });
}

/** Block types a decision authorises at its target. The one rule behind both the normaliser and the document audit. */
export function authorizedBlockTypes(decision: Decision, targetKind: "activity" | "text" | "visual" | "document"): Set<string> {
  const allowed = new Set<string>();
  for (const s of decision.supports) for (const t of SUPPORT_BLOCKS[s.kind]) allowed.add(t);
  if (REWRITING.has(decision.action)) {
    if (targetKind === "activity") allowed.add("activity");
    if (targetKind === "text" && decision.action === "rephrase") allowed.add("paragraph");
  }
  return allowed;
}

export function targetKindOf(analysis: MaterialAnalysis, target: string): "activity" | "text" | "visual" | "document" {
  return analysis.activities.some((a) => a.id === target) ? "activity" : analysis.texts.some((t) => t.id === target) ? "text" : analysis.visuals.some((v) => v.id === target) ? "visual" : "document";
}

export function normalizeGenerated(draft: DraftGeneratedSegments, reviewed: ReviewedPlan, analysis: MaterialAnalysis): NormalizedGeneration {
  const effective = new Map(reviewed.effective.decisions.map((d) => [d.id, d]));
  const issues: GenerationIssue[] = [];
  const blocksByDecision = new Map<string, GeneratedSegments["segments"][number]>();

  for (const segment of draft.segments) {
    const decision = effective.get(segment.decision_id);
    if (!decision) {
      const known = reviewed.decisions.find((d) => d.id === segment.decision_id);
      issues.push({ code: "unapproved_decision", decision_id: segment.decision_id, detail: known ? `La decisión no está aplicada (${known.outcome})` : "La decisión no existe en el plan" });
      continue;
    }
    if (segment.target !== decision.target) {
      issues.push({ code: "target_mismatch", decision_id: decision.id, detail: `El segmento actúa sobre ${segment.target} y la decisión sobre ${decision.target}` });
      continue;
    }
    const activity = analysis.activities.find((a) => a.id === decision.target);
    const allowed = authorizedBlockTypes(decision, targetKindOf(analysis, decision.target));
    const closed = decision.response_target !== undefined && (CLOSED_RESPONSES as readonly string[]).includes(decision.response_target);
    if (closed) issues.push({ code: "unsupported_response_format", decision_id: decision.id, detail: `El formato ${decision.response_target} necesita una clave de respuestas: no soportado por el generador v1` });

    const blocks: DraftBlock[] = [];
    let activityBlocks = 0;
    segment.blocks.forEach((block, i) => {
      if (!allowed.has(block.type)) {
        issues.push({ code: "unauthorized_block", decision_id: decision.id, detail: `El bloque ${block.type} no está autorizado por la decisión` });
        return;
      }
      const common = { id: `${decision.id}-g${i}`, trace: { origin: (decision.action === "extend" ? "extension" : "support") as "extension" | "support", source_refs: decision.target === "document" ? [] : [decision.target], decision_ids: [decision.id] } };
      if (block.type === "activity") {
        activityBlocks += 1;
        if (activityBlocks > 1 || !activity) {
          issues.push({ code: "multiple_activity_blocks", decision_id: decision.id, detail: "Solo se admite un bloque de actividad por decisión" });
          return;
        }
        blocks.push({
          id: common.id,
          type: "activity",
          label: block.label ?? activity.label ?? undefined,
          prompt: block.prompt,
          ...(block.steps ? { steps: block.steps } : {}),
          ...(block.requirements ? { requirements: block.requirements } : {}),
          resource_block_ids: activity.resource_ids,
          response: responseForDecision(activity, closed ? undefined : decision.response_target),
          trace: { ...common.trace, origin: "adapted" },
        });
        return;
      }
      if (block.type === "paragraph") blocks.push({ ...common, type: "paragraph", text: block.text, trace: { ...common.trace, origin: "adapted" } });
      else blocks.push({ ...common, ...block } as DraftBlock);
    });
    if (blocks.length === 0) continue;
    const existing = blocksByDecision.get(decision.id);
    if (existing) existing.blocks.push(...blocks);
    else blocksByDecision.set(decision.id, { target: decision.target, decision_ids: [decision.id], blocks, new_item_answers: [] });
  }

  const declined = new Set<string>();
  for (const b of draft.blocked) {
    if (!effective.has(b.decision_id)) continue;
    declined.add(b.decision_id);
    issues.push({ code: "model_blocked", decision_id: b.decision_id, detail: `${b.reason}: ${b.note}` });
  }

  const requested = decisionsToGenerate(reviewed.effective.decisions, analysis).map((d) => d.id);
  const generated = requested.filter((id) => blocksByDecision.has(id));
  const ignored = requested.filter((id) => !blocksByDecision.has(id) && !declined.has(id));
  for (const id of ignored) issues.push({ code: "no_segment", decision_id: id, detail: "Decisión aprobada sin ningún bloque generado" });

  return {
    version: 1,
    segments: { segments: [...blocksByDecision.values()], change_summary: draft.change_summary.length > 0 ? draft.change_summary : ["Sin resumen"] },
    issues,
    requested,
    generated,
    ignored,
    declined: [...declined],
    preserved: [],
  };
}
