import { allBlocks, MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { describeSpec, type VisualSpec } from "@/lib/visuals/spec";
import { fingerprint } from "./fingerprint";
import { normalizeText } from "./text";
import type { ChoiceTable, TableEvidence } from "./table-choice";
import type { SingleChoiceResponse } from "./single-choice";

/**
 * «Hacer magia» never asks the teacher to locate, upload or omit an image, and never stops because one is missing when the sheet
 * can be completed in a pedagogically valid way (docs/VISUAL_RESOURCES.md § Política visual). Every visual need of the sheet is
 * resolved by the server, in this order, and the first rung that works is the one recorded:
 *
 *   1. exact_original_visual             the original's figure, located automatically (or by a person earlier) and cropped;
 *   2. reconstructable_structured_visual a simple mathematical figure redrawn from the original's own pixels;
 *   3. generatable_support_visual        a NEW figure drawn by our renderer: an equivalent one of the same kind for an original
 *                                        that could not be used (from the activity's data), or a support the plan asked for;
 *   4. generated_illustration            a NEW educational illustration from an image model, approved by a vision review, for
 *                                        what cannot be an exact figure (a cell, a situation, a process);
 *   5. rewritable_without_visual         the activity rewritten without the visual when it only carried a datum, or the visual
 *                                        left out because the sheet does not need it (an optional one);
 *   6. substituted_activity              a NEW activity with the same objective, level, operation and response type, with its own
 *                                        figure when the competence is working with a representation;
 *   7. unresolved_visual                 nothing valid could be built: the only visual reason left to stop, never «ready» with a gap.
 *
 * Each outcome also carries its CONTRACT (`VisualContract`): what kind of resource it is, where it comes from, why the activity
 * needs it, how it was validated and which asset the sheet uses. Needs are: the original's images (`vis_N`), the supports decisions
 * asked for (`dec_N`), and the picture an activity's own words point at that the sheet does not have (`act_N`, «observa el
 * esquema» with no scheme).
 *
 * This module is pure: what each need IS (from the document and the pinned context) and how a decided plan is applied to the
 * document. The decisions that need the original, the locator or a model are taken in `src/lib/materials/visuals/auto/policy.ts`.
 */

export const VISUAL_POLICY_VERSION = 2;
export const VISUAL_NEED_CATEGORIES = ["exact_original_visual", "reconstructable_structured_visual", "generatable_support_visual", "generated_illustration", "rewritable_without_visual", "substituted_activity", "unresolved_visual"] as const;
export type VisualNeedCategory = (typeof VISUAL_NEED_CATEGORIES)[number];

/**
 * What the resource IS for the activity (the explicit contract of docs/VISUAL_RESOURCES.md § Contrato de recursos visuales).
 * `original_improvable` is reserved: no improvement of an original image is applied yet, so none is classified as such.
 */
export const VISUAL_CLASSES = ["original_essential", "original_improvable", "structured_reconstructable", "new_support_illustration", "must_generate_or_edit", "optional", "unresolvable"] as const;
export type VisualClass = (typeof VISUAL_CLASSES)[number];

export interface VisualContract {
  class: VisualClass;
  provenance: "original_crop" | "pixel_reconstruction" | "generated_spec" | "ai_illustration" | "rewritten_activity" | "substituted_activity" | "omitted" | "none";
  /** Why the activity needs it (a short code, for the audit). */
  reason: string;
  validation: "located_verified" | "pixels_verified" | "spec_verified" | "ai_reviewed" | "equivalence_verified" | "source_table_verified" | "not_required" | "failed";
  /** The private asset the sheet finally uses: a crop of the original (by its visual), a drawn spec (by its hash) or an illustration. */
  asset: { kind: "crop"; visual_ref: string } | { kind: "spec"; sha256: string } | { kind: "illustration"; id: string; sha256: string } | null;
}

export interface ActivityRewrite {
  activityId: string;
  prompt: string;
  steps: string[];
  /** 0: no writing lines (answered on the figure, or on the supplied choice response). */
  lines: number;
  /** Only a server-validated selection executor can supply options; legacy rewrites keep their existing semantics. */
  response?: SingleChoiceResponse;
}

export interface IllustrationAsset {
  id: string;
  sha256: string;
  width: number;
  height: number;
}

export type VisualAction =
  | { action: "located" }
  | { action: "figure"; spec: VisualSpec; provenance: "reconstruction" | "generated" }
  | { action: "illustration"; asset: IllustrationAsset; alt: string }
  | { action: "rewrite"; activities: ActivityRewrite[] }
  | { action: "substitute"; activities: ActivityRewrite[]; spec: VisualSpec | null; table?: ChoiceTable; tableEvidence?: TableEvidence }
  | { action: "omit"; reason: string }
  | { action: "unresolved"; reason: string };

export type VisualNeedOrigin = "original" | "requested" | "referenced";

export interface VisualNeedOutcome {
  /** `vis_N` (a visual of the original), `dec_N` (a support a decision asked for) or `act_N` (a picture an activity refers to). */
  key: string;
  origin: VisualNeedOrigin;
  essential: boolean;
  /** Activities of the sheet that use it. */
  activityIds: string[];
  category: VisualNeedCategory;
  resolution: VisualAction;
  /** Rungs tried, in order (audit). */
  attempts: string[];
  /** Absent only in plans stored before the contract existed (policy v1). */
  contract?: VisualContract;
}

export interface VisualResolutionPlan {
  policy_version: 1 | 2;
  needs: VisualNeedOutcome[];
}

export interface VisualNeedInput {
  key: string;
  origin: VisualNeedOrigin;
  essential: boolean;
  activityIds: string[];
  purpose?: string;
}

const activitiesUsing = (blocks: readonly Block[], imageBlockIds: ReadonlySet<string>, fallback: readonly string[]) => {
  const fromLinks = blocks.flatMap((b) => (b.type === "activity" && (b.resource_block_ids ?? []).some((r) => imageBlockIds.has(r)) ? b.trace.source_refs.filter((r) => r.startsWith("act_")) : []));
  return [...new Set(fromLinks.length > 0 ? fromLinks : fallback.filter((r) => r.startsWith("act_")))];
};

const PICTURE_NOUN = String.raw`(esquema|esquemas|imagen|imagenes|dibujo|dibujos|figura|figuras|ilustracion|ilustraciones|fotografia|fotografias|foto|fotos|diagrama|diagramas|mapa|mapas|grafico|graficos|grafica|graficas|vineta|vinetas|barra|recta numerica)`;
/**
 * The activity's words point at a picture the student is meant to SEE: a definite reference («observa el esquema», «en la
 * figura», «según el gráfico»). An indefinite one («dibuja un esquema») asks the student to make it; «el dibujo que has hecho»
 * is the student's own.
 */
const PICTURE_REFERENCE = new RegExp(String.raw`\b(el|la|los|las|este|esta|estos|estas|del|al)\s+${PICTURE_NOUN}\b(?!\s+que\s+(has|hayas|vas|hagas|dibujes|dibujaste))`);

export function refersToPicture(text: string): boolean {
  return PICTURE_REFERENCE.test(normalizeText(text));
}

const VISUAL_BLOCKS = new Set<Block["type"]>(["image", "table", "chart"]);

/**
 * Activities whose words refer to a picture the student cannot see: no visual block linked to them and none in their zone of the
 * sheet (between the previous activity and the next one, where a student would look). What «observa el esquema» points at.
 */
export function danglingPictureReferences(document: MaterialDocument): Array<{ blockId: string; activityId: string | null }> {
  const blocks = allBlocks(document);
  const visual = new Set(blocks.filter((b) => VISUAL_BLOCKS.has(b.type)).map((b) => b.id));
  const activityAt = blocks.flatMap((b, i) => (b.type === "activity" ? [i] : []));
  return activityAt.flatMap((i, k) => {
    const b = blocks[i]!;
    if (b.type !== "activity" || (b.resource_block_ids ?? []).some((id) => visual.has(id))) return [];
    const from = k === 0 ? 0 : activityAt[k - 1]! + 1;
    const to = k === activityAt.length - 1 ? blocks.length : activityAt[k + 1]!;
    if (blocks.slice(from, to).some((x) => VISUAL_BLOCKS.has(x.type))) return [];
    if (!refersToPicture([b.prompt, ...(b.steps ?? [])].join(" "))) return [];
    return [{ blockId: b.id, activityId: b.trace.source_refs.find((r) => r.startsWith("act_")) ?? null }];
  });
}

/** The visual needs of an assembled sheet: its original images (`vis_N`), the supports decisions asked for (`dec_N`), and the pictures activities refer to that the sheet lacks (`act_N`). */
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
  for (const { activityId } of danglingPictureReferences(document)) {
    if (!activityId || needs.has(activityId) || [...needs.values()].some((n) => n.origin === "original" && n.activityIds.includes(activityId))) continue;
    needs.set(activityId, { key: activityId, origin: "referenced", essential: true, activityIds: [activityId] });
  }
  return [...needs.values()];
}

export const unresolvedEssential = (plan: VisualResolutionPlan | null) => (plan ? plan.needs.filter((n) => n.resolution.action === "unresolved") : []);

/** Unresolved only because the plan has no illustrations (or this month's are used up): a fact about the plan, not the material. */
export const PLAN_LIMITED_REASONS: ReadonlySet<string> = new Set(["illustration_not_in_plan", "illustration_quota_exhausted"]);
export const stoppedByPlan = (unresolved: readonly VisualNeedOutcome[]) => unresolved.length > 0 && unresolved.every((n) => n.resolution.action === "unresolved" && PLAN_LIMITED_REASONS.has(n.resolution.reason));

/**
 * The precise reason an essential visual stopped a sheet (docs/ADAPTATION.md § Figuras imprescindibles), so the teacher is never
 * told «your plan» when no plan could help: new illustrations are switched off in Adaptaula (`illustration_unavailable`), the
 * workspace's plan has none while another plan does (`illustration_not_in_plan`), this month's are used up
 * (`illustration_quota_exhausted`), or nothing valid could be built from the material (any other reason → `visual`).
 */
export type VisualStopCode = "visual" | "visual_plan" | "visual_quota" | "visual_unavailable";
export function visualStopCode(unresolved: readonly VisualNeedOutcome[]): VisualStopCode {
  const reasons = new Set(unresolved.map((n) => (n.resolution.action === "unresolved" ? n.resolution.reason : "")));
  if (reasons.size === 0) return "visual";
  const only = (r: string) => reasons.size === 1 && reasons.has(r);
  if (only("illustration_unavailable")) return "visual_unavailable";
  if (only("illustration_quota_exhausted")) return "visual_quota";
  return stoppedByPlan(unresolved) ? "visual_plan" : "visual";
}
export const VISUAL_STOP_CODES: ReadonlySet<string> = new Set<VisualStopCode>(["visual", "visual_plan", "visual_quota", "visual_unavailable"]);

const STRUCTURED = /\b(barra|recta|tabla|grafico|grafica|cuadricula)\b/;

/** The contract of one decided need (pure: from its origin, its outcome and the analysis's kind of visual). */
export function contractOf(need: Pick<VisualNeedOutcome, "key" | "origin" | "essential" | "resolution">, visualKind: string | null): VisualContract {
  const r = need.resolution;
  const structured = visualKind !== null && (["number_line", "chart", "table", "geometric_figure"].includes(visualKind) || STRUCTURED.test(visualKind));
  const cls: VisualClass =
    r.action === "unresolved" ? "unresolvable"
    : !need.essential ? "optional"
    : need.origin === "requested" ? "new_support_illustration"
    : need.origin === "referenced" ? "must_generate_or_edit"
    : r.action === "located" ? "original_essential"
    : structured || r.action === "figure" ? "structured_reconstructable"
    : "must_generate_or_edit";
  const reason = need.origin === "requested" ? "plan_support" : need.origin === "referenced" ? "activity_refers_to_picture" : need.essential ? "activity_uses_original_visual" : "not_used_by_any_activity";
  switch (r.action) {
    case "located":
      return { class: cls, provenance: "original_crop", reason, validation: "located_verified", asset: { kind: "crop", visual_ref: need.key } };
    case "figure":
      return { class: cls, provenance: r.provenance === "reconstruction" ? "pixel_reconstruction" : "generated_spec", reason, validation: r.provenance === "reconstruction" ? "pixels_verified" : "spec_verified", asset: { kind: "spec", sha256: fingerprint(r.spec) } };
    case "illustration":
      return { class: cls, provenance: "ai_illustration", reason, validation: "ai_reviewed", asset: { kind: "illustration", id: r.asset.id, sha256: r.asset.sha256 } };
    case "rewrite":
      return { class: cls, provenance: "rewritten_activity", reason, validation: "equivalence_verified", asset: null };
    case "substitute":
      return { class: cls, provenance: "substituted_activity", reason, validation: r.table ? "source_table_verified" : "equivalence_verified", asset: r.spec ? { kind: "spec", sha256: fingerprint(r.spec) } : null };
    case "omit":
      return { class: cls, provenance: "omitted", reason, validation: "not_required", asset: null };
    case "unresolved":
      return { class: cls, provenance: "none", reason, validation: "failed", asset: null };
  }
}

const keyOf = (b: Block) => (b.type === "table" ? b.trace.source_refs.find((r) => r.startsWith("vis_")) ?? null : b.type !== "image" ? null : b.source.kind === "original" ? b.source.visual_ref : b.source.kind === "requested" ? b.source.decision_id : null);

/** The image source a decided need puts on the sheet, when it draws or shows something. */
function sourceFor(need: VisualNeedOutcome): { source: Extract<Block, { type: "image" }>["source"]; alt: string } | null {
  const r = need.resolution;
  const ref = need.origin === "original" ? { visual_ref: need.key } : need.origin === "requested" ? { decision_id: need.key } : { activity_ref: need.key };
  if (r.action === "figure" || (r.action === "substitute" && r.spec)) {
    const spec = r.action === "figure" ? r.spec : r.spec!;
    // A figure stands for an original or a support; the picture an activity referred to is a new drawing for it.
    const figureRef = need.origin === "referenced" ? {} : ref;
    return { source: { kind: "figure", spec, provenance: r.action === "figure" ? r.provenance : "generated", ...figureRef }, alt: describeSpec(spec).slice(0, 300) };
  }
  if (r.action === "illustration") return { source: { kind: "generated", asset_id: r.asset.id, sha256: r.asset.sha256, ...ref }, alt: r.alt.slice(0, 300) };
  return null;
}

/** The id of the block that shows the picture an activity referred to (deterministic, so a repeated application is identical). */
const pictureBlockId = (activityId: string) => `blk_pic${activityId.replace("act_", "").padStart(4, "0")}`;

/**
 * The plan applied to the assembled sheet: a figure or an illustration takes the image's place (same block, same links), the
 * picture an activity referred to is placed just before it and linked to it, an omitted or rewritten-away visual leaves no block
 * and no link, and a rewritten or substituted activity keeps its label, its links and its trace (marked as adapted).
 * Located originals and unresolved needs are left as they are (the first is drawn from its crop; the second stops the sheet).
 */
export function applyVisualResolution(document: MaterialDocument, plan: VisualResolutionPlan): MaterialDocument {
  const byKey = new Map(plan.needs.map((n) => [n.key, n]));
  const removed = new Set<string>();
  const rewrites = new Map(plan.needs.flatMap((n) => (n.resolution.action === "rewrite" || n.resolution.action === "substitute" ? n.resolution.activities.map((a) => [a.activityId, a] as const) : [])));
  const rewritten = new Set<string>();
  const pages = document.pages.map((page) => ({
    blocks: page.blocks.flatMap((b): Block[] => {
      const key = keyOf(b);
      const need = key ? byKey.get(key) : undefined;
      if ((b.type === "image" || b.type === "table") && need?.resolution.action === "substitute" && need.resolution.table) {
        const table = need.resolution.table;
        return [{ id: b.id, type: "table", headers: table.headers, rows: table.rows, ...(table.unit ? { unit: table.unit } : {}), trace: b.trace }];
      }
      if (b.type === "image" && need) {
        const r = need.resolution;
        if (r.action === "omit" || r.action === "rewrite" || (r.action === "substitute" && !r.spec)) {
          removed.add(b.id);
          return [];
        }
        const shown = sourceFor(need);
        if (shown) return [{ ...b, source: shown.source, alt_text: shown.alt }];
      }
      if (b.type !== "activity") return [b];
      const out: Block[] = [];
      let activity = b;
      const actRef = b.trace.source_refs.find((r) => r.startsWith("act_"));
      // The picture this activity's words refer to, now drawn or illustrated: right before it, and linked to it.
      const referenced = actRef ? byKey.get(actRef) : undefined;
      const picture = referenced && referenced.origin === "referenced" ? sourceFor(referenced) : null;
      if (picture && actRef) {
        const id = pictureBlockId(actRef);
        out.push({ id, type: "image", source: picture.source, alt_text: picture.alt, trace: { origin: "adapted", source_refs: [actRef], decision_ids: [] } });
        activity = { ...activity, resource_block_ids: [...new Set([...(activity.resource_block_ids ?? []), id])] };
      }
      const act = b.trace.source_refs.find((r) => rewrites.has(r));
      if (act && !rewritten.has(act)) {
        rewritten.add(act);
        const w = rewrites.get(act)!;
        const decisions = plan.needs.filter((n) => (n.resolution.action === "rewrite" || n.resolution.action === "substitute") && n.activityIds.includes(act));
        // A substitute brings a new task: its own answer space (none when it is answered on its figure), never the old one's.
        const substitute = decisions.some((d) => d.resolution.action === "substitute");
        const response = w.response ?? (w.lines === 0 ? ({ kind: "none" } as const) : substitute || activity.response.kind === "none" ? ({ kind: "lines", lines: w.lines } as const) : activity.response);
        activity = { ...activity, prompt: w.prompt, ...(w.steps.length > 0 ? { steps: w.steps } : substitute ? { steps: undefined } : {}), response, trace: { ...activity.trace, origin: "adapted", source_refs: [...new Set([...activity.trace.source_refs, ...decisions.map((d) => d.key).filter((k) => k.startsWith("vis_"))])] } };
      }
      out.push(activity);
      return out;
    }),
  }));
  const cleaned = pages
    .map((p) => ({ blocks: p.blocks.map((b) => (b.type === "activity" && b.resource_block_ids ? { ...b, resource_block_ids: b.resource_block_ids.filter((id) => !removed.has(id)) } : b)) }))
    .filter((p) => p.blocks.length > 0);
  return MaterialDocumentSchema.parse({ ...document, pages: cleaned });
}
