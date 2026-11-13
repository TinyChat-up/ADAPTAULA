import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, Decision, StrategyKey, SupportKind } from "@/lib/schemas/adaptation-plan";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { AnalysisActivity, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { Block } from "@/lib/schemas/material-document";
import type { DecisionEdits, PlanReview } from "@/lib/schemas/plan-review";
import { reaches, viable } from "./automatic-resolution";
import { isResolvedByPresentation } from "./context";
import { DIMENSION_STRATEGIES } from "./strategies";
import type { SupportFinding, SupportFindingCode } from "./assessment-safety";

/**
 * Etapa 2.2 · functional substitution of a support that hands over the answer. Pure and deterministic: no model, no wording of the
 * material decides anything. A support is replaced only by one that serves THE SAME NEED (two supports that serve different needs
 * are never equivalent), that the invariants accept and that an executor can write; the decision's target, dimensions and
 * protected elements are never edited. What it cannot replace is never presented as applied: it is recorded as uncovered.
 */

export type SubstitutionMode = "on" | "dry_run" | "off";
export const SUBSTITUTION_MODES: readonly SubstitutionMode[] = ["on", "dry_run", "off"];
/**
 * What happens when nobody turned it on: it only RECORDS what it would do. `on` is an explicit, controlled activation
 * (`SUPPORT_SUBSTITUTION_MODE=on`), never the default of a deployment or of a missing dependency.
 */
export const DEFAULT_SUBSTITUTION_MODE: SubstitutionMode = "dry_run";

/** The only findings that may start a repair: the support carries an answer part the sheet does not show, and it is reliable. */
export const LITERAL_CODES: readonly SupportFindingCode[] = ["direct_answer_part", "example_solves_item"];
export const isActionable = (f: Pick<SupportFinding, "code" | "literal">) => f.literal === true && LITERAL_CODES.includes(f.code);

/** Marks the review entry that is a substitution (one per decision: a second one is never attempted). */
export const SUBSTITUTION_REASON = "Apoyo sustituido por otro de la misma función: el original entregaba parte de la respuesta";

// ---------------------------------------------------------------------------------------------------------------------
// What each kind of support serves
// ---------------------------------------------------------------------------------------------------------------------

/** The kinds of support a strategy produces (docs/ADAPTATION.md § Estrategias). A kind serves a need only through a strategy that lists it. */
const STRATEGY_KINDS: Partial<Record<StrategyKey, readonly SupportKind[]>> = {
  vocabulary_support: ["glossary"],
  prior_knowledge_activation: ["guiding_questions", "key_idea"],
  comprehension_support: ["key_idea", "guiding_questions"],
  worked_example: ["worked_example"],
  working_memory_support: ["reminder"],
  planning_support: ["planner", "checklist"],
  instruction_clarification: ["step_list", "checklist"],
  task_sequencing: ["step_list"],
  self_regulation: ["checklist", "self_check"],
  response_format: ["sentence_starters"],
  attention_focus: ["key_idea"],
  visual_support: ["visual_cue"],
  extension: ["extension_task"],
};

/** Whether a support of this kind can serve a need: some strategy the need calls for produces that kind. */
export function kindServes(kind: SupportKind, dimension: DimensionKey): boolean {
  return (DIMENSION_STRATEGIES[dimension] ?? []).some((s) => STRATEGY_KINDS[s]?.includes(kind));
}

/** Every need of the decision is served by at least one of the kinds (a need the presentation resolves needs no support). */
export const servesAll = (kinds: readonly SupportKind[], dimensions: readonly DimensionKey[], context: Pick<AdaptationContext, "presentation">) =>
  dimensions.every((d) => isResolvedByPresentation(d, context.presentation) || kinds.some((k) => kindServes(k, d)));

/** The support kinds a generated block stands for (a list is steps or guiding questions: the decision's own kinds say which). */
export function kindsOfBlock(block: Block, decision: Pick<Decision, "supports">): SupportKind[] {
  switch (block.type) {
    case "vocabulary": return ["glossary"];
    case "worked_example": return ["worked_example"];
    case "help_box": return block.variant === "key_idea" ? ["key_idea"] : ["reminder"];
    case "planner": return ["planner"];
    case "sentence_starters": return ["sentence_starters"];
    case "checklist": return [decision.supports.find((s) => s.kind === "checklist" || s.kind === "self_check")?.kind ?? "checklist"];
    case "list": return [decision.supports.find((s) => s.kind === "step_list" || s.kind === "guiding_questions")?.kind ?? "step_list"];
    default: return [];
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Alternatives
// ---------------------------------------------------------------------------------------------------------------------

export const OPTION_IDS = ["secondary_vocabulary", "guiding_questions", "method_reminder", "other_domain_example"] as const;
export type OptionId = (typeof OPTION_IDS)[number];

export interface SubstitutionOption {
  id: OptionId;
  /** The kind that replaces the flagged one. */
  kind: SupportKind;
  restrictions: string[];
}

const EVALUATED = new Set(["concept", "target_operation", "reasoning_constraint", "formula"]);

/** What the activity evaluates, in the protected elements' own short words (the generator already receives them), never an answer. */
export function evaluatedTerms(analysis: MaterialAnalysis, activity: AnalysisActivity): string {
  const values = analysis.protected_elements.filter((p) => p.activity_ids.includes(activity.id) && EVALUATED.has(p.type)).map((p) => p.value.replace(/\s+/g, " ").trim().slice(0, 60));
  return [...new Set(values)].slice(0, 2).join("; ");
}

const cap = (text: string) => text.slice(0, 200);

function restrictionsFor(id: OptionId, terms: string): string[] {
  const about = terms ? ` Lo que evalúa la actividad: ${terms}.` : "";
  switch (id) {
    case "secondary_vocabulary": return [cap(`Define solo vocabulario secundario de la consigna o del texto; no definas ni expliques lo evaluado.${about}`)];
    case "guiding_questions": return [cap(`Escribe preguntas de observación sobre lo que el alumno ve; ninguna contiene la respuesta ni nombra lo evaluado.${about}`)];
    case "method_reminder": return [cap(`Recuerda solo cómo trabajar (qué mirar y en qué orden); no digas la respuesta ni nombres lo evaluado.${about}`)];
    case "other_domain_example": return [cap("Ejemplo de otro ámbito y con otros datos y términos que no aparezcan en la hoja; no nombres ni resuelvas ningún ítem de la actividad.")];
  }
}

const EXPLAINING = new Set<AnalysisActivity["type"]>(["short_answer", "open_question", "reading_comprehension", "graph_interpretation", "experiment"]);

/**
 * How well an option suits the activity and the profile (lower first). Not a fixed sequence: it depends on what the activity asks
 * (explain or interpret vs apply a procedure) and on the profile's high needs.
 */
function fit(option: OptionId, activity: AnalysisActivity, context: Pick<AdaptationContext, "needs">): number {
  const explaining = EXPLAINING.has(activity.type);
  const base: Record<OptionId, number> = explaining
    ? { guiding_questions: 0, secondary_vocabulary: 1, other_domain_example: 1, method_reminder: 2 }
    : { method_reminder: 0, other_domain_example: 0, secondary_vocabulary: 1, guiding_questions: 2 };
  const high = new Set(context.needs.filter((n) => n.level === "high").map((n) => n.dimension));
  let score = base[option];
  if (option === "method_reminder" && (high.has("working_memory_support") || high.has("written_instructions") || high.has("instruction_chunking"))) score -= 1;
  if (option === "secondary_vocabulary" && (high.has("vocabulary_support") || high.has("vocabulary_complexity") || high.has("decoding_support"))) score -= 1;
  if (option === "guiding_questions" && (high.has("inferential_demand") || high.has("background_knowledge_support"))) score -= 1;
  return score;
}

/** The option the flagged kind can be replaced by (never a different NEED: the new supports must still serve every need of the decision). */
const OPTIONS_FOR: Partial<Record<SupportKind, readonly OptionId[]>> = {
  glossary: ["secondary_vocabulary", "guiding_questions"],
  key_idea: ["guiding_questions", "method_reminder", "secondary_vocabulary"],
  reminder: ["method_reminder"],
  step_list: ["method_reminder"],
  guiding_questions: ["guiding_questions", "method_reminder"],
  worked_example: ["other_domain_example"],
  checklist: ["method_reminder"],
  self_check: ["method_reminder"],
};
const KIND_OF_OPTION: Record<OptionId, SupportKind> = { secondary_vocabulary: "glossary", guiding_questions: "guiding_questions", method_reminder: "reminder", other_domain_example: "worked_example" };

/** Decisions the generator DECLINED because writing the support would reveal the answer (v1 `blocked`, v2 `skipped`). */
export function revealDeclines(generation: { declined: readonly string[]; issues: ReadonlyArray<{ code: string; decision_id: string | null; detail: string }> }): string[] {
  const reveal = (i: { code: string; detail: string }) => (i.code === "model_blocked" && i.detail.startsWith("would_reveal_answer")) || (i.code === "skipped_support" && i.detail.endsWith("would_reveal_answer"));
  const revealing = new Set(generation.issues.filter(reveal).map((i) => i.decision_id));
  return generation.declined.filter((id) => revealing.has(id));
}

/**
 * Lexical evidence (C): a glossary or key idea on an activity that asks to EXPLAIN or INTERPRET may define what is evaluated. It never
 * triggers a call by itself: the decision keeps its place, its needs stay applied and the FIRST generation is simply told what not to
 * define. Empty when nothing is at stake (an activity that applies a procedure, a criterion card, no protected concept).
 */
export function priorGuard(decision: Pick<Decision, "target" | "supports">, analysis: MaterialAnalysis): string[] {
  const activity = analysis.activities.find((a) => a.id === decision.target);
  if (!activity || !EXPLAINING.has(activity.type) || !decision.supports.some((s) => s.kind === "glossary" || s.kind === "key_idea")) return [];
  const terms = evaluatedTerms(analysis, activity);
  return terms ? [cap(`No definas ni expliques lo que evalúa la actividad: ${terms}. Aclara solo vocabulario secundario de la consigna o del texto.`)] : [];
}

export interface SupportGuardResult {
  review: PlanReview;
  /** The decisions that get (`on`) or WOULD get (`dry_run`) a restriction. Ids only. */
  guarded: string[];
}

/**
 * Evidence C applied to a whole automatic review, AFTER every other resolution (the capability-aware one and the V2.2 autonomous one),
 * on what each decision will really carry: its effective supports (an edit may have changed them) and its own restrictions, which are
 * kept: a guard is added to them, never in their place, and only if the six allowed still fit. `on` returns the review with the
 * guards; `dry_run` returns it UNTOUCHED and lists what it would do; `off` does nothing. A decision left out is never touched.
 */
export function applySupportGuard(review: PlanReview, plan: Pick<AdaptationPlan, "decisions">, analysis: MaterialAnalysis, mode: SubstitutionMode): SupportGuardResult {
  if (mode === "off") return { review, guarded: [] };
  const guarded: string[] = [];
  const entries = review.entries.map((entry) => {
    if (entry.action === "rejected") return entry;
    const decision = plan.decisions.find((d) => d.id === entry.decision_id);
    if (!decision) return entry;
    const guard = priorGuard({ target: decision.target, supports: entry.edits?.supports ?? decision.supports }, analysis);
    const current = entry.restrictions ?? [];
    const missing = guard.filter((g) => !current.includes(g));
    if (missing.length === 0 || current.length + missing.length > 6) return entry;
    guarded.push(entry.decision_id);
    return mode === "on" ? { ...entry, restrictions: [...current, ...missing] } : entry;
  });
  return { review: mode === "on" ? { ...review, entries } : review, guarded };
}

/** Structural evidence (B): asked only when a repair is already happening for another reason; never a call of its own. */
export const STRUCTURAL_RESTRICTIONS: Partial<Record<SupportFindingCode, string>> = {
  example_near_item: "Usa otros números y otros datos que los de la hoja; no demuestres la misma relación que pide la actividad.",
  example_reuses_data: "Usa otros números y otros datos que los de la hoja; no demuestres la misma relación que pide la actividad.",
  assigns_item_to_category: "No asignes ningún componente de la hoja a una categoría: explica el criterio sin clasificar nada.",
};

export interface SubstitutionPlan {
  /** The option that replaces the flagged support (what the record names). */
  option: OptionId;
  edits: DecisionEdits;
  restrictions: string[];
  /** The decision's supports after the swap. */
  to: SupportKind[];
}

/**
 * The one substitution for a decision whose support (of the `flagged` kinds) hands over the answer, or null when none exists that
 * serves the same needs, passes the invariants and has an executor. Candidates are ordered by how they suit the activity and the
 * profile. A candidate that leaves a need of the decision unserved may be completed with ONE more safe support that serves it (a
 * glossary of secondary vocabulary plus a guiding question for a decision that served vocabulary AND background knowledge); with
 * none, it is not an alternative. The first viable one wins.
 */
export function planSubstitution(input: { raw: AdaptationPlan; decision: Decision; flagged: readonly SupportKind[]; analysis: MaterialAnalysis; context: AdaptationContext; activity: AnalysisActivity }): SubstitutionPlan | null {
  const { raw, decision, flagged, analysis, context, activity } = input;
  const kept = decision.supports.filter((s) => !flagged.includes(s.kind));
  const rank = (ids: readonly OptionId[]) =>
    [...new Set(ids)].map((id) => ({ id, kind: KIND_OF_OPTION[id], score: fit(id, activity, context) })).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const primary = rank(flagged.flatMap((k) => OPTIONS_FOR[k] ?? []));
  const complements = rank(OPTION_IDS);
  const terms = evaluatedTerms(analysis, activity);
  for (const candidate of primary) {
    const chosen = [candidate];
    let supports = [...kept, { kind: candidate.kind, uses_task_data: false as const }];
    const unserved = () => decision.dimensions.filter((d) => !isResolvedByPresentation(d, context.presentation) && !supports.some((s) => kindServes(s.kind, d)));
    for (const extra of complements) {
      if (unserved().length === 0 || supports.length >= 4) break;
      if (supports.some((s) => s.kind === extra.kind) || !unserved().some((d) => kindServes(extra.kind, d))) continue;
      chosen.push(extra);
      supports = [...supports, { kind: extra.kind, uses_task_data: false as const }];
    }
    // The same NEEDS stay served: a support with a different function is never an equivalent (dimensions are never edited: they are the contract).
    if (unserved().length > 0) continue;
    const edits: DecisionEdits = { supports };
    if (!viable(raw, decision, edits, analysis, context)) continue;
    return { option: candidate.id, edits, restrictions: chosen.flatMap((c) => restrictionsFor(c.id, terms)).slice(0, 4), to: supports.map((s) => s.kind) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Traceability: codes and ids only
// ---------------------------------------------------------------------------------------------------------------------

export type ResolutionTrigger = "literal_answer" | "declined_reveal" | "structural_signal" | "semantic_confirmed";
export type ResolutionAction = "restricted" | "substituted" | "omitted" | "stopped" | "would_restrict" | "would_substitute";
/**
 * Where a need stays served after a support is left out: by another decision on the SAME activity, by a resource or a support for the
 * whole document that REACHES it (`reaches`), by the presentation, or by nothing. Another decision on the same DIMENSION but on an
 * activity that does not reach this one covers nothing here, whatever the level of the need.
 */
export type ResolutionCoverage = "same_activity" | "reachable_resource" | "presentation" | "none";

export interface SupportResolutionRecord {
  decision_id: string;
  activity_id: string;
  block_ids: string[];
  trigger: ResolutionTrigger;
  codes: SupportFindingCode[];
  mode: SubstitutionMode;
  action: ResolutionAction;
  /** The support kinds the decision carried, and the ones it carries after (null: nothing replaces them). */
  from: SupportKind[];
  to: SupportKind[] | null;
  option: OptionId | null;
  /** The needs (dimensions) of the decision: never edited. */
  dimensions: DimensionKey[];
  /** Where the needs stay served after this (the worst of its dimensions). */
  coverage: ResolutionCoverage;
  /** The needs (dimensions) that nothing serves for this activity after this. */
  uncovered: DimensionKey[];
  /** The pedagogical meaning of the support is judged by the semantic review (stage 2.3): `cleared` is not a validation. */
  /** `confirmed`: the semantic reviewer (stage 2.3) judged this support and its judgment was confirmed; `pending_2_3`: no semantic judgment (mechanical evidence only). */
  semantic_review: "pending_2_3" | "confirmed";
}

const COVERAGE_RANK: Record<ResolutionCoverage, number> = { same_activity: 0, presentation: 1, reachable_resource: 2, none: 3 };

/**
 * What a decision's needs have left once it is left out: per dimension, the closest thing that really serves it FOR THIS ACTIVITY.
 * `essential`: some uncovered need is a high one (the honest stop). Medium and low needs are recorded, never silently «covered elsewhere».
 */
export function coverageOf(decision: Pick<Decision, "id" | "target" | "dimensions">, others: readonly Pick<Decision, "id" | "target" | "dimensions">[], context: Pick<AdaptationContext, "needs" | "presentation">, analysis: MaterialAnalysis): { coverage: ResolutionCoverage; uncovered: DimensionKey[]; essential: boolean } {
  const high = new Set(context.needs.filter((n) => n.level === "high").map((n) => n.dimension));
  const rest = others.filter((k) => k.id !== decision.id);
  const uncovered: DimensionKey[] = [];
  let worst: ResolutionCoverage = "same_activity";
  for (const dim of decision.dimensions) {
    const serving = rest.filter((k) => k.dimensions.includes(dim));
    const here: ResolutionCoverage = isResolvedByPresentation(dim, context.presentation) ? "presentation" : serving.some((k) => k.target === decision.target) ? "same_activity" : serving.some((k) => reaches(k, decision, analysis)) ? "reachable_resource" : "none";
    if (here === "none") uncovered.push(dim);
    if (COVERAGE_RANK[here] > COVERAGE_RANK[worst]) worst = here;
  }
  return { coverage: worst, uncovered, essential: uncovered.some((d) => high.has(d)) };
}

export interface SupportFlag {
  decisionId: string;
  activityId: string;
  blockIds: string[];
  kinds: SupportKind[];
  trigger: ResolutionTrigger;
  codes: SupportFindingCode[];
}

export function recordOf(flag: SupportFlag, decision: Pick<Decision, "dimensions" | "supports">, mode: SubstitutionMode, action: ResolutionAction, extra: { to?: SupportKind[] | null; option?: OptionId | null; coverage: ResolutionCoverage; uncovered?: DimensionKey[] }): SupportResolutionRecord {
  return {
    decision_id: flag.decisionId,
    activity_id: flag.activityId,
    block_ids: flag.blockIds,
    trigger: flag.trigger,
    codes: flag.codes,
    mode,
    action,
    from: decision.supports.map((s) => s.kind),
    to: extra.to ?? null,
    option: extra.option ?? null,
    dimensions: [...decision.dimensions],
    coverage: extra.coverage,
    uncovered: extra.uncovered ?? [],
    semantic_review: flag.trigger === "semantic_confirmed" ? "confirmed" : "pending_2_3",
  };
}

