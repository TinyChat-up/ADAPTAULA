import { allBlocks, MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { describeSpec, type VisualSpec } from "@/lib/visuals/spec";

/**
 * «Hacer magia» never asks the teacher to locate, upload or omit an image (docs/VISUAL_RESOURCES.md § Política visual). Every
 * visual need of the sheet is resolved by the server, in this order, and the first rung that works is the one recorded:
 *
 *   1. exact_original_visual             the original's figure, located automatically (or by a person earlier) and cropped;
 *   2. reconstructable_structured_visual a simple mathematical figure redrawn from verified data (its pixels, else the analysis's
 *                                        complete description);
 *   3. generatable_support_visual        a NEW support the plan asked for (a sequence of steps, vocabulary cards), drawn by our
 *                                        own renderer from validated short text — never a stand-in for an original's content;
 *   4. rewritable_without_visual         the activity rewritten so it keeps its objective without the visual (an essential
 *                                        original), or the visual left out because the sheet does not need it (an optional one);
 *   5. unresolved_visual                 nothing reliable: the adaptation stops honestly, never «ready» with a gap.
 *
 * This module is pure: what each need IS (from the document and the pinned context) and how a decided plan is applied to the
 * document. The decisions that need the original, the locator or a model are taken in `src/lib/materials/visuals/auto/policy.ts`.
 */

export const VISUAL_POLICY_VERSION = 1;
export const VISUAL_NEED_CATEGORIES = ["exact_original_visual", "reconstructable_structured_visual", "generatable_support_visual", "rewritable_without_visual", "unresolved_visual"] as const;
export type VisualNeedCategory = (typeof VISUAL_NEED_CATEGORIES)[number];

export interface ActivityRewrite {
  activityId: string;
  prompt: string;
  steps: string[];
  lines: number;
}

export type VisualAction =
  | { action: "located" }
  | { action: "figure"; spec: VisualSpec; provenance: "reconstruction" | "generated" }
  | { action: "rewrite"; activities: ActivityRewrite[] }
  | { action: "omit"; reason: string }
  | { action: "unresolved"; reason: string };

export interface VisualNeedOutcome {
  /** `vis_N` (a visual of the original) or `dec_N` (a support a decision asked for). */
  key: string;
  origin: "original" | "requested";
  essential: boolean;
  /** Activities of the sheet that use it. */
  activityIds: string[];
  category: VisualNeedCategory;
  resolution: VisualAction;
  /** Rungs tried, in order (audit). */
  attempts: string[];
}

export interface VisualResolutionPlan {
  policy_version: typeof VISUAL_POLICY_VERSION;
  needs: VisualNeedOutcome[];
}

export interface VisualNeedInput {
  key: string;
  origin: "original" | "requested";
  essential: boolean;
  activityIds: string[];
  purpose?: string;
}

const activitiesUsing = (blocks: readonly Block[], imageBlockIds: ReadonlySet<string>, fallback: readonly string[]) => {
  const fromLinks = blocks.flatMap((b) => (b.type === "activity" && (b.resource_block_ids ?? []).some((r) => imageBlockIds.has(r)) ? b.trace.source_refs.filter((r) => r.startsWith("act_")) : []));
  return [...new Set(fromLinks.length > 0 ? fromLinks : fallback.filter((r) => r.startsWith("act_")))];
};

/** The visual needs of an assembled sheet: its original images (by `vis_N`) and the supports decisions asked for (by `dec_N`). */
export function visualNeedsOfDocument(document: MaterialDocument, requiredVisuals: readonly string[]): VisualNeedInput[] {
  const blocks = allBlocks(document);
  const needs = new Map<string, VisualNeedInput>();
  for (const b of blocks) {
    if (b.type !== "image") continue;
    if (b.source.kind === "original") {
      const ids = new Set(blocks.filter((x) => x.type === "image" && x.source.kind === "original" && x.source.visual_ref === (b.source as { visual_ref: string }).visual_ref).map((x) => x.id));
      const activityIds = activitiesUsing(blocks, ids, b.trace.source_refs);
      // An original visual an activity uses is needed by it even when the analysis did not mark it required: it is rewritten
      // around, never silently dropped. Only one no activity uses can be left out.
      needs.set(b.source.visual_ref, { key: b.source.visual_ref, origin: "original", essential: requiredVisuals.includes(b.source.visual_ref) || activityIds.length > 0, activityIds });
    } else if (b.source.kind === "requested") {
      needs.set(b.source.decision_id, { key: b.source.decision_id, origin: "requested", essential: b.source.essential === true, activityIds: activitiesUsing(blocks, new Set([b.id]), b.trace.source_refs), purpose: b.source.purpose });
    }
  }
  return [...needs.values()];
}

export const unresolvedEssential = (plan: VisualResolutionPlan | null) => (plan ? plan.needs.filter((n) => n.resolution.action === "unresolved") : []);

const keyOf = (b: Block) => (b.type !== "image" ? null : b.source.kind === "original" ? b.source.visual_ref : b.source.kind === "requested" ? b.source.decision_id : null);

/**
 * The plan applied to the assembled sheet: a figure takes the image's place (same block, same links), an omitted or rewritten-away
 * visual leaves no block and no link, and a rewritten activity keeps its label, its links and its trace (marked as adapted).
 * Located originals and unresolved needs are left as they are (the first is drawn from its crop; the second stops the sheet).
 */
export function applyVisualResolution(document: MaterialDocument, plan: VisualResolutionPlan): MaterialDocument {
  const byKey = new Map(plan.needs.map((n) => [n.key, n]));
  const removed = new Set<string>();
  const rewrites = new Map(plan.needs.flatMap((n) => (n.resolution.action === "rewrite" ? n.resolution.activities.map((a) => [a.activityId, a] as const) : [])));
  const rewritten = new Set<string>();
  const pages = document.pages.map((page) => ({
    blocks: page.blocks.flatMap((b): Block[] => {
      const key = keyOf(b);
      const need = key ? byKey.get(key) : undefined;
      if (b.type === "image" && need) {
        const r = need.resolution;
        if (r.action === "omit" || r.action === "rewrite") {
          removed.add(b.id);
          return [];
        }
        if (r.action === "figure") {
          const source = { kind: "figure" as const, spec: r.spec, provenance: r.provenance, ...(need.origin === "original" ? { visual_ref: need.key } : { decision_id: need.key }) };
          return [{ ...b, source, alt_text: describeSpec(r.spec).slice(0, 300) }];
        }
      }
      if (b.type === "activity") {
        const act = b.trace.source_refs.find((r) => rewrites.has(r));
        if (act && !rewritten.has(act)) {
          rewritten.add(act);
          const w = rewrites.get(act)!;
          const decisions = plan.needs.filter((n) => n.resolution.action === "rewrite" && n.activityIds.includes(act));
          return [{ ...b, prompt: w.prompt, ...(w.steps.length > 0 ? { steps: w.steps } : {}), response: b.response.kind === "none" ? { kind: "lines", lines: w.lines } : b.response, trace: { ...b.trace, origin: "adapted", source_refs: [...new Set([...b.trace.source_refs, ...decisions.map((d) => d.key).filter((k) => k.startsWith("vis_"))])] } }];
        }
      }
      return [b];
    }),
  }));
  const cleaned = pages
    .map((p) => ({ blocks: p.blocks.map((b) => (b.type === "activity" && b.resource_block_ids ? { ...b, resource_block_ids: b.resource_block_ids.filter((id) => !removed.has(id)) } : b)) }))
    .filter((p) => p.blocks.length > 0);
  return MaterialDocumentSchema.parse({ ...document, pages: cleaned });
}
