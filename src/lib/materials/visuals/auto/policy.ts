import "server-only";
import { answerSignatures, criticalTokens, hasToken, leakedSignature, normalizeText } from "@/lib/adaptation/text";
import { materialNumbers } from "@/lib/adaptation/facts";
import { VISUAL_POLICY_VERSION, visualNeedsOfDocument, type ActivityRewrite, type VisualAction, type VisualNeedCategory, type VisualNeedOutcome, type VisualResolutionPlan } from "@/lib/adaptation/visual-policy";
import type { AIRunRecord } from "@/lib/ai/types";
import { rewriteEquivalence, taskProfile } from "@/lib/adaptation/pedagogical-equivalence";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import type { AnalysisActivity, AnalysisVisual, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { VISUAL_SPEC_VERSION, VisualSpecSchema, type VisualSpec } from "@/lib/visuals/spec";
import type { RewriteDraft, SupportDraft, VisualAssistants } from "./assistants";

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
  recordAiRun?(run: AIRunRecord): Promise<void>;
}

export interface MagicVisualInput {
  analysis: MaterialAnalysis;
  document: MaterialDocument;
  requiredVisuals: readonly string[];
  stage: string | null;
  /** The functional dimensions the sheet attends (no student data): they decide how many steps a rewrite may add. */
  functionalNeeds?: readonly string[];
}

/** Words that point at an image the student will not see. */
const IMAGE_WORDS = /\b(imagen|imagenes|figura|figuras|dibujo|dibujos|grafico|ilustracion|foto|fotografia|observa|mira)\b/;

const activityText = (analysis: MaterialAnalysis, id: string) => {
  const a = analysis.activities.find((x) => x.id === id);
  return a ? (a.context ? `${a.instruction}\n${a.context}` : a.instruction) : "";
};

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
  const record = async (run: AIRunRecord) => deps.recordAiRun?.(run).catch(() => undefined);

  for (const need of needs) {
    const attempts: string[] = [];
    const done = (category: VisualNeedCategory, resolution: VisualAction) => outcomes.push({ ...need, category, resolution, attempts });
    const signatures = signaturesFor(input.analysis, need.activityIds);

    if (need.origin === "original") {
      const visual = input.analysis.visuals.find((v) => v.id === need.key);
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
      // An activity that acts on or interprets the representation (or whose objective is the representation) cannot be rewritten
      // into another one: deterministic, before any model is asked.
      const activities = need.activityIds.map((id) => input.analysis.activities.find((a) => a.id === id)).filter((a): a is AnalysisActivity => a !== undefined);
      const required = activities.map((a) => taskProfile(input.analysis, a, visual)).filter((p) => p.representation === "required");
      if (activities.length === 0 || required.length > 0) {
        done("unresolved_visual", { action: "unresolved", reason: required.length > 0 ? "representation_required" : "exact_visual_unavailable" });
        continue;
      }
      attempts.push("rewrite");
      const visualText = visualTextOf(visual);
      const rewrites: ActivityRewrite[] = [];
      if (deps.assistants && visualText) {
        for (const activity of activities) {
          const { draft, run } = await deps.assistants.rewrite({ stage: input.stage, activity: activityText(input.analysis, activity.id), visual: visualText });
          await record(run);
          const valid = validateRewrite(draft, { analysis: input.analysis, activity, visual, signatures, functionalNeeds: input.functionalNeeds ?? [] });
          if (!valid.ok) break;
          rewrites.push({ activityId: activity.id, ...valid.rewrite });
        }
      }
      if (rewrites.length > 0 && rewrites.length === activities.length) done("rewritable_without_visual", { action: "rewrite", activities: rewrites });
      else done("unresolved_visual", { action: "unresolved", reason: "not_equivalent_or_unavailable" });
      continue;
    }

    attempts.push("generate");
    const activity = need.activityIds.map((id) => activityText(input.analysis, id)).join("\n");
    let spec: VisualSpec | null = null;
    if (deps.assistants && activity) {
      const { draft, run } = await deps.assistants.support({ stage: input.stage, purpose: need.purpose ?? "Apoyo visual para la actividad", activity });
      await record(run);
      spec = validateSupport(draft, activity, signatures);
    }
    spec ??= supportFromSheet(input.document, need.activityIds);
    if (spec) {
      done("generatable_support_visual", { action: "figure", spec, provenance: "generated" });
      continue;
    }
    if (!need.essential) {
      attempts.push("omit");
      done("rewritable_without_visual", { action: "omit", reason: "optional_support" });
      continue;
    }
    done("unresolved_visual", { action: "unresolved", reason: "support_unavailable" });
  }
  return { policy_version: VISUAL_POLICY_VERSION, needs: outcomes };
}
