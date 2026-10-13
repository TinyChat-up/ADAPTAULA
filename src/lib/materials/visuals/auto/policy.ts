import "server-only";
import { answerSignatures, criticalTokens, hasToken, leakedSignature, normalizeText } from "@/lib/adaptation/text";
import { materialNumbers } from "@/lib/adaptation/facts";
import { AdaptationError } from "@/lib/adaptation/orchestration/errors";
import { VISUAL_POLICY_VERSION, contractOf, visualNeedsOfDocument, type ActivityRewrite, type VisualAction, type VisualNeedCategory, type VisualNeedOutcome, type VisualResolutionPlan } from "@/lib/adaptation/visual-policy";
import type { AIRunRecord } from "@/lib/ai/types";
import { rewriteEquivalence, substitutionEquivalence, taskProfile } from "@/lib/adaptation/pedagogical-equivalence";
import { DIMENSIONS, type DimensionKey } from "@/lib/schemas/functional-profile";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import type { AnalysisActivity, AnalysisVisual, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { drawableFamily, generateEquivalentFigure } from "@/lib/visuals/from-task";
import { VISUAL_SPEC_VERSION, VisualSpecSchema, specIssues, type VisualSpec } from "@/lib/visuals/spec";
import type { RewriteDraft, SubstituteDraft, SupportDraft, VisualAssistants } from "./assistants";
import { ILLUSTRATION_LIMITS, type IllustrationOutcome, type IllustrationRequest } from "../illustrate/service";

/**
 * The visual policy of «Hacer magia», decided for one assembled sheet (rungs and categories: `src/lib/adaptation/visual-policy.ts`).
 * Every model answer is validated here before it can reach the sheet; a failed rung goes on to the next one, never to the teacher.
 */

export interface MagicVisualDeps {
  /**
   * Which originals have a usable crop now: a person's, or one the CURRENT automatic engine accepted in this material version
   * (an earlier engine's locator that was not found again does not count).
   */
  readyOriginals(visualIds: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * The figure rebuilt from the original's own pixels, corroborated by a complete description (`corroborateSpec`). Absent →
   * nothing is rebuilt: a description alone is never drawn.
   */
  corroborate?(visual: AnalysisVisual, activityTexts: readonly string[]): Promise<VisualSpec | null>;
  /** Absent → no model rung (the deterministic ones still run). */
  assistants?: VisualAssistants | null;
  /**
   * A new educational illustration (image model + vision review, `../illustrate`), bound to this adaptation. Absent → not
   * available to it (flag, plan, quota or credentials): its rung is skipped.
   */
  illustrate?: ((request: Omit<IllustrationRequest, "workspaceId" | "adaptationId" | "deadline">) => Promise<IllustrationOutcome>) | null;
  /** Illustrations this adaptation may get (the plan's `features.illustrations_per_adaptation`); never above the hard limit. */
  maxIllustrations?: number;
  /** Why `illustrate` is absent: the workspace's plan does not include illustrations, or the service is not set up. */
  illustrationsWithheld?: "plan" | "service" | null;
  recordAiRun?(run: AIRunRecord): Promise<void>;
}

export interface MagicVisualInput {
  analysis: MaterialAnalysis;
  document: MaterialDocument;
  requiredVisuals: readonly string[];
  stage: string | null;
  grade?: string | null;
  subject?: string | null;
  /** The functional dimensions the sheet attends (no student data): they decide how many steps a rewrite may add. */
  functionalNeeds?: readonly string[];
}

/** Kinds of original picture an image model may stand in for: never data, measures, scales or real places. */
const ILLUSTRABLE = new Set<AnalysisVisual["kind"]>(["image", "diagram", "other"]);
const EXACT_IN_WORDS = /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|dm|m|km|g|kg|l|ml|%|°|º|grados|metros|litros|euros|€)\b|\bescala\b/;
const LOW_DETAIL: ReadonlySet<string> = new Set(["visual_distraction_reduction", "visual_density"]);
const illustrable = (visual: AnalysisVisual) => ILLUSTRABLE.has(visual.kind) && visual.role !== "decorative" && !EXACT_IN_WORDS.test(normalizeText(`${visual.title ?? ""} ${visual.description} ${visual.text ?? ""}`));

/** Words that point at an image the student will not see. */
const IMAGE_WORDS = /\b(imagen|imagenes|figura|figuras|dibujo|dibujos|grafico|ilustracion|foto|fotografia|observa|mira)\b/;

const activityText = (analysis: MaterialAnalysis, id: string) => {
  const a = analysis.activities.find((x) => x.id === id);
  return a ? (a.context ? `${a.instruction}\n${a.context}` : a.instruction) : "";
};

/** The sheet as a whole, for a support that belongs to no single activity: title, objectives and instructions (material only). */
const sheetContext = (analysis: MaterialAnalysis) =>
  [analysis.identification.title, ...analysis.pedagogical_intent.objectives.map((o) => o.text), ...analysis.activities.map((a) => (a.label ? `${a.label}. ${a.instruction}` : a.instruction))]
    .filter((x): x is string => Boolean(x))
    .join("\n")
    .slice(0, 2000);

const signaturesFor = (analysis: MaterialAnalysis, activityIds: readonly string[]) => {
  const numbers = materialNumbers(analysis);
  return analysis.activities.filter((a) => activityIds.includes(a.id) && a.expected_answer.value).flatMap((a) => answerSignatures(a.expected_answer.value!, numbers));
};

/** A new support: valid spec, short, not a copy of the task, and without the answer. */
export function validateSupport(draft: SupportDraft | null, activity: string, signatures: readonly string[]): VisualSpec | null {
  if (!draft || !draft.useful || !draft.kind) return null;
  const candidate =
    draft.kind === "steps"
      ? { spec_version: VISUAL_SPEC_VERSION, kind: "steps", ...(draft.title ? { title: draft.title } : {}), items: (draft.steps ?? []).map((s) => s.trim()).filter(Boolean) }
      : { spec_version: VISUAL_SPEC_VERSION, kind: "cards", ...(draft.title ? { title: draft.title } : {}), items: (draft.cards ?? []).map((c) => ({ term: c.term.trim(), hint: c.hint.trim() })) };
  const parsed = VisualSpecSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const texts = parsed.data.kind === "steps" ? parsed.data.items : parsed.data.kind === "cards" ? parsed.data.items.flatMap((c) => [c.term, c.hint]) : [];
  const all = texts.join("\n");
  if (leakedSignature(all, signatures)) return null;
  if (texts.some((t) => normalizeText(t).length > 20 && normalizeText(activity).includes(normalizeText(t)))) return null;
  return parsed.data;
}

export interface RewriteContext {
  analysis: MaterialAnalysis;
  activity: AnalysisActivity;
  visual: AnalysisVisual | undefined;
  signatures: readonly string[];
  functionalNeeds: readonly string[];
}

const visualTextOf = (visual: AnalysisVisual | undefined) => (visual ? [visual.title, visual.description, visual.text].filter(Boolean).join(". ") : "");

/**
 * A rewrite: pedagogically equivalent first (`rewriteEquivalence`: same objective, operation, representation, demand, response
 * type and needs — keeping the numbers is not enough), then every datum of the task kept (and every number the figure gave),
 * no image mentioned, no answer. The model's own «feasible» is only a precondition, never the proof.
 */
export function validateRewrite(draft: RewriteDraft | null, ctx: RewriteContext): { ok: true; rewrite: Omit<ActivityRewrite, "activityId"> } | { ok: false; violations: string[] } {
  if (!draft || !draft.feasible || !draft.prompt) return { ok: false, violations: ["not_feasible"] };
  const activity = activityText(ctx.analysis, ctx.activity.id);
  const visualText = visualTextOf(ctx.visual);
  const prompt = draft.prompt.trim();
  const steps = (draft.steps ?? []).map((s) => s.trim()).filter(Boolean);
  const lines = draft.lines ?? 2;
  const equivalence = rewriteEquivalence({ analysis: ctx.analysis, activity: ctx.activity, visual: ctx.visual, rewrite: { prompt, steps, lines }, needs: ctx.functionalNeeds });
  const violations = [...equivalence.violations];
  const full = [prompt, ...steps].join("\n");
  const norm = normalizeText(full);
  if (prompt.length < 15 || norm === normalizeText(activity)) violations.push("not_rewritten");
  if (IMAGE_WORDS.test(norm)) violations.push("mentions_image");
  const required = [...criticalTokens(activity), ...criticalTokens(visualText).filter((t) => t.kind === "number")];
  if (required.some((t) => !hasToken(norm, t))) violations.push("data_lost");
  if (leakedSignature(full, ctx.signatures)) violations.push("answer_leaked");
  return violations.length === 0 ? { ok: true, rewrite: { prompt, steps, lines } } : { ok: false, violations };
}

/** Words for an image the student will not see; with the substitute's own figure on the sheet, «observa la barra» is fine. */
const MISSING_IMAGE_WORDS = /\b(imagen|imagenes|dibujo|dibujos|ilustracion|foto|fotografia)\b/;

/** The substitute's figure, as DATA from the model, built and verified by us (labels: whole numbers only; nothing to answer). */
export function figureFromDraft(figure: SubstituteDraft["figure"]): VisualSpec | null {
  if (!figure) return null;
  const shaded = (k: number | null, of: number) => (k !== null && k <= of ? Array.from({ length: k }, (_, i) => i) : null);
  let candidate: unknown = null;
  if (figure.kind === "fraction_bar" && figure.parts) candidate = { spec_version: VISUAL_SPEC_VERSION, kind: "fraction_bar", parts: figure.parts, shaded: shaded(figure.shaded, figure.parts) };
  if (figure.kind === "circle" && figure.parts) candidate = { spec_version: VISUAL_SPEC_VERSION, kind: "part_whole", shape: "circle", parts: figure.parts, shaded: shaded(figure.shaded, figure.parts) };
  if (figure.kind === "grid" && figure.rows && figure.cols) candidate = { spec_version: VISUAL_SPEC_VERSION, kind: "grid", rows: figure.rows, cols: figure.cols, shaded: shaded(figure.shaded, figure.rows * figure.cols) };
  if (figure.kind === "number_line" && figure.line_end && figure.divisions && figure.divisions % figure.line_end === 0) {
    const unit = figure.divisions / figure.line_end;
    candidate = { spec_version: VISUAL_SPEC_VERSION, kind: "number_line", start: { n: 0, d: 1 }, end: { n: figure.line_end, d: 1 }, divisions: figure.divisions, labels: Array.from({ length: figure.line_end + 1 }, (_, k) => ({ tick: k * unit, text: String(k) })) };
  }
  const parsed = VisualSpecSchema.safeParse(candidate);
  return parsed.success && specIssues(parsed.data).length === 0 ? parsed.data : null;
}

/**
 * A substitute activity: pedagogically equivalent (`substitutionEquivalence`), its figure valid when it brings one, no reference
 * to a missing image, and no answer (neither the original's nor the shaded fraction of its own figure).
 */
export function validateSubstitute(draft: SubstituteDraft | null, ctx: RewriteContext & { drawable: boolean }): { ok: true; rewrite: Omit<ActivityRewrite, "activityId">; spec: VisualSpec | null } | { ok: false; violations: string[] } {
  if (!draft || !draft.feasible || !draft.prompt) return { ok: false, violations: ["not_feasible"] };
  const spec = figureFromDraft(draft.figure);
  if (draft.figure && !spec) return { ok: false, violations: ["figure_invalid"] };
  const prompt = draft.prompt.trim();
  const steps = (draft.steps ?? []).map((x) => x.trim()).filter(Boolean);
  const lines = draft.lines ?? 2;
  const equivalence = substitutionEquivalence({ analysis: ctx.analysis, activity: ctx.activity, visual: ctx.visual, candidate: { prompt, steps, lines, figure: spec }, needs: ctx.functionalNeeds, drawable: ctx.drawable });
  const violations = [...equivalence.violations];
  const full = [prompt, ...steps].join("\n");
  const norm = normalizeText(full);
  // The same question over its own new figure is a valid substitute; without one, an unchanged prompt still needs the lost image.
  if (prompt.length < 15 || (!spec && norm === normalizeText(activityText(ctx.analysis, ctx.activity.id)))) violations.push("not_rewritten");
  if ((spec ? MISSING_IMAGE_WORDS : IMAGE_WORDS).test(norm)) violations.push("mentions_image");
  if (leakedSignature(full, ctx.signatures)) violations.push("answer_leaked");
  const shown = spec?.kind === "fraction_bar" || spec?.kind === "part_whole" ? `${spec.shaded.length}/${spec.parts}` : null;
  if (shown && norm.includes(shown) && ctx.activity.response_format !== "mark") violations.push("answer_leaked(figure)");
  return violations.length === 0 ? { ok: true, rewrite: { prompt, steps, lines }, spec } : { ok: false, violations };
}

/** Without a model, a support can still be drawn from the activity's own steps in the sheet (never invented). */
function supportFromSheet(document: MaterialDocument, activityIds: readonly string[]): VisualSpec | null {
  const block = allBlocks(document).find((b) => b.type === "activity" && b.trace.source_refs.some((r) => activityIds.includes(r)));
  const steps = block?.type === "activity" ? (block.steps ?? []) : [];
  if (steps.length < 2) return null;
  const parsed = VisualSpecSchema.safeParse({ spec_version: VISUAL_SPEC_VERSION, kind: "steps", items: steps.slice(0, 6).map((s) => s.slice(0, 90)) });
  return parsed.success ? parsed.data : null;
}

export async function resolveMagicVisuals(deps: MagicVisualDeps, input: MagicVisualInput): Promise<VisualResolutionPlan> {
  const needs = visualNeedsOfDocument(input.document, input.requiredVisuals);
  const ready = await deps.readyOriginals(needs.filter((n) => n.origin === "original").map((n) => n.key));
  const outcomes: VisualNeedOutcome[] = [];
  // Transient provider trouble is never an answer: going down the ladder on it would end in a stop that blames the material. The
  // stage is retried later instead, within the job's attempts.
  const record = async (run: AIRunRecord, transient = false) => {
    await deps.recordAiRun?.(run).catch(() => undefined);
    if (transient) throw new AdaptationError("provider_transient", "visual_assistant_unavailable");
  };
  const functionalNeeds = input.functionalNeeds ?? [];
  const supports = functionalNeeds.flatMap((d) => (d in DIMENSIONS ? [DIMENSIONS[d as DimensionKey].label] : []));
  let illustrations = 0;
  /**
   * Needs an illustration would have resolved but the plan stopped: its plan has none, or this month's are used up. If nothing else
   * resolves them, the stop says so («your plan»), never a sheet with a gap.
   */
  const planLimited = new Map<string, "illustration_not_in_plan" | "illustration_quota_exhausted">();
  /** One illustration for a need: within the adaptation's limit, with the activities' own words and answers. */
  const illustrate = async (needKey: string, activities: readonly AnalysisActivity[], missing: string | null, purpose: string): Promise<IllustrationOutcome | null> => {
    if (!deps.illustrate && deps.illustrationsWithheld === "plan" && activities.length > 0) planLimited.set(needKey, "illustration_not_in_plan");
    const limit = Math.min(ILLUSTRATION_LIMITS.perAdaptation, deps.maxIllustrations ?? ILLUSTRATION_LIMITS.perAdaptation);
    if (!deps.illustrate || illustrations >= limit || activities.length === 0) return null;
    illustrations += 1;
    const objective = input.analysis.pedagogical_intent.objectives.filter((o) => activities.some((a) => a.objective_ids.includes(o.id))).map((o) => o.text).join(". ") || null;
    const answers = activities.map((a) => a.expected_answer.value).filter((v): v is string => Boolean(v));
    return deps.illustrate({ needKey, stage: input.stage, grade: input.grade ?? null, subject: input.subject ?? null, activity: activities.map((a) => activityText(input.analysis, a.id)).join("\n"), objective, missing, purpose, supports, expectedAnswer: answers.length > 0 ? answers.join("; ") : null, signatures: signaturesFor(input.analysis, activities.map((a) => a.id)), lowDetail: functionalNeeds.some((d) => LOW_DETAIL.has(d)) });
  };

  for (const need of needs) {
    const attempts: string[] = [];
    const visual = need.origin === "original" ? input.analysis.visuals.find((v) => v.id === need.key) : undefined;
    const done = (category: VisualNeedCategory, given: VisualAction) => {
      const limited = planLimited.get(need.key);
      const resolution: VisualAction = given.action === "unresolved" && limited ? { action: "unresolved", reason: limited } : given;
      const outcome = { ...need, category, resolution, attempts };
      outcomes.push({ ...outcome, contract: contractOf(outcome, visual?.kind ?? null) });
    };
    const signatures = signaturesFor(input.analysis, need.activityIds);
    const activities = need.activityIds.map((id) => input.analysis.activities.find((a) => a.id === id)).filter((a): a is AnalysisActivity => a !== undefined);
    // Only a rung really tried is recorded (no illustrations for this adaptation → nothing to record).
    const illustrated = (outcome: IllustrationOutcome | null) => {
      if (!outcome) return false;
      if (!outcome.ok) {
        attempts.push(`illustrate:${outcome.reason}`);
        if (outcome.reason === "quota_exhausted") planLimited.set(need.key, "illustration_quota_exhausted");
        return false;
      }
      attempts.push("illustrate");
      done("generated_illustration", { action: "illustration", asset: { id: outcome.asset.id, sha256: outcome.asset.sha256, width: outcome.asset.width, height: outcome.asset.height }, alt: outcome.asset.alt });
      return true;
    };

    if (need.origin === "referenced") {
      // The activity's words point at a picture the sheet does not have: drawn from its own data, or illustrated; never delivered as is.
      attempts.push("generate");
      const generated = generateEquivalentFigure({ kind: "other", title: null, description: "", text: null }, activities);
      if (generated) {
        done("generatable_support_visual", { action: "figure", spec: generated.spec, provenance: "generated" });
        continue;
      }
      if (illustrated(await illustrate(need.key, activities, null, "La actividad remite a una imagen que la ficha no tiene"))) continue;
      done("unresolved_visual", { action: "unresolved", reason: deps.illustrate ? "referenced_picture_not_built" : "referenced_picture_unavailable" });
      continue;
    }

    if (need.origin === "original") {
      attempts.push("locate");
      if (ready.has(need.key)) {
        done("exact_original_visual", { action: "located" });
        continue;
      }
      attempts.push("reconstruct");
      const spec = visual && deps.corroborate ? await deps.corroborate(visual, need.activityIds.map((id) => activityText(input.analysis, id))).catch(() => null) : null;
      if (spec) {
        done("reconstructable_structured_visual", { action: "figure", spec, provenance: "reconstruction" });
        continue;
      }
      if (!need.essential) {
        attempts.push("omit");
        done("rewritable_without_visual", { action: "omit", reason: "optional_original" });
        continue;
      }
      if (!visual || activities.length === 0) {
        done("unresolved_visual", { action: "unresolved", reason: "exact_visual_unavailable" });
        continue;
      }
      // 3 · A NEW figure of the same kind, from the activity's own data: the competence is kept without a model.
      attempts.push("generate");
      const generated = generateEquivalentFigure(visual, activities);
      if (generated) {
        done("generatable_support_visual", { action: "figure", spec: generated.spec, provenance: "generated" });
        continue;
      }
      const required = activities.some((a) => taskProfile(input.analysis, a, visual).representation === "required");
      const drawable = drawableFamily(visual, activities) !== null;
      // 4 · A new illustration for a picture that carries no exact data (a cell, a scene, a process), reviewed before it is used.
      if (illustrable(visual) && illustrated(await illustrate(need.key, activities, visualTextOf(visual), "Sustituye a una imagen del original que no está disponible"))) continue;
      const ctx = { analysis: input.analysis, visual, signatures, functionalNeeds };
      const visualText = visualTextOf(visual);
      // 5 · Rewritten without it, only when the figure was a mere data source (decided before any model is asked).
      if (!required && deps.assistants && visualText) {
        attempts.push("rewrite");
        const rewrites: ActivityRewrite[] = [];
        for (const activity of activities) {
          const { draft, run, transient } = await deps.assistants.rewrite({ stage: input.stage, activity: activityText(input.analysis, activity.id), visual: visualText });
          await record(run, transient);
          const valid = validateRewrite(draft, { ...ctx, activity });
          if (!valid.ok) break;
          rewrites.push({ activityId: activity.id, ...valid.rewrite });
        }
        if (rewrites.length === activities.length) {
          done("rewritable_without_visual", { action: "rewrite", activities: rewrites });
          continue;
        }
      }
      // 6 · A new equivalent activity: with its own figure when the representation is required (only a drawable one can be);
      // a representation we cannot draw is never replaced by words.
      if (deps.assistants && (drawable || !required)) {
        attempts.push("substitute");
        const substituted = await substituteAll(deps.assistants, record, input, activities, visualText, { ...ctx, drawable });
        if (substituted) {
          done("substituted_activity", { action: "substitute", activities: substituted.activities, spec: substituted.spec });
          continue;
        }
      }
      done("unresolved_visual", { action: "unresolved", reason: !deps.assistants && !deps.illustrate ? "no_model_available" : required && !drawable ? "representation_not_buildable" : "no_equivalent_activity" });
      continue;
    }

    // A support a decision asked for: a picture (an illustration) when that is what it asked, a drawn sequence or cards otherwise.
    const wantsPicture = need.purpose !== undefined && requestedStyle(input.document, need.key) !== null && ["illustration", "photo_like"].includes(requestedStyle(input.document, need.key)!);
    if (wantsPicture && illustrated(await illustrate(need.key, activities, null, need.purpose ?? "Apoyo visual para la actividad"))) continue;
    attempts.push("generate");
    // A support for the whole sheet (no activity linked) is built from the sheet itself; it must give away no answer of any activity.
    const sheetWide = need.activityIds.length === 0;
    const activity = sheetWide ? sheetContext(input.analysis) : need.activityIds.map((id) => activityText(input.analysis, id)).join("\n");
    const supportSignatures = sheetWide ? signaturesFor(input.analysis, input.analysis.activities.map((a) => a.id)) : signatures;
    let spec: VisualSpec | null = null;
    if (deps.assistants && activity) {
      const { draft, run, transient } = await deps.assistants.support({ stage: input.stage, purpose: need.purpose ?? "Apoyo visual para la actividad", activity });
      await record(run, transient);
      spec = validateSupport(draft, activity, supportSignatures);
    }
    spec ??= supportFromSheet(input.document, need.activityIds);
    if (spec) {
      done("generatable_support_visual", { action: "figure", spec, provenance: "generated" });
      continue;
    }
    if (!wantsPicture && need.essential && illustrated(await illustrate(need.key, activities, null, need.purpose ?? "Apoyo visual para la actividad"))) continue;
    if (!need.essential) {
      attempts.push("omit");
      done("rewritable_without_visual", { action: "omit", reason: "optional_support" });
      continue;
    }
    done("unresolved_visual", { action: "unresolved", reason: "support_unavailable" });
  }
  return { policy_version: VISUAL_POLICY_VERSION, needs: outcomes };
}

/** The style a decision asked for its visual (`requested` image block), if the sheet has it. */
function requestedStyle(document: MaterialDocument, decisionId: string): string | null {
  const block = allBlocks(document).find((b) => b.type === "image" && b.source.kind === "requested" && b.source.decision_id === decisionId);
  return block?.type === "image" && block.source.kind === "requested" ? block.source.style : null;
}

const SUBSTITUTE_ATTEMPTS = 2;

async function substituteAll(assistants: VisualAssistants, record: (run: AIRunRecord, transient?: boolean) => Promise<void>, input: MagicVisualInput, activities: readonly AnalysisActivity[], visualText: string, ctx: Omit<RewriteContext, "activity"> & { drawable: boolean }): Promise<{ activities: ActivityRewrite[]; spec: VisualSpec | null } | null> {
  const out: ActivityRewrite[] = [];
  let spec: VisualSpec | null = null;
  for (const activity of activities) {
    const objective = input.analysis.pedagogical_intent.objectives.filter((o) => activity.objective_ids.includes(o.id)).map((o) => o.text).join(". ") || null;
    let accepted: { rewrite: Omit<ActivityRewrite, "activityId">; spec: VisualSpec | null } | null = null;
    for (let attempt = 0; attempt < SUBSTITUTE_ATTEMPTS && !accepted; attempt++) {
      const { draft, run, transient } = await assistants.substitute({ stage: input.stage, activity: activityText(input.analysis, activity.id), objective, visual: visualText || "(sin descripción)" });
      await record({ ...run, attempt: attempt + 1 }, transient);
      const valid = validateSubstitute(draft, { ...ctx, activity });
      // Several activities share the figure: they must agree on it (one figure on the sheet).
      if (valid.ok && (!spec || !valid.spec || JSON.stringify(spec) === JSON.stringify(valid.spec))) accepted = valid;
    }
    if (!accepted) return null;
    spec ??= accepted.spec;
    out.push({ activityId: activity.id, ...accepted.rewrite });
  }
  return { activities: out, spec };
}
