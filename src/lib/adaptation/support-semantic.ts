import type { AdaptationPlan, Decision, SupportKind } from "@/lib/schemas/adaptation-plan";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { CheckResult } from "@/lib/schemas/pedagogical-review";
import { MAX_SUPPORT_JUDGMENTS, type SupportClass, type SupportHow, type SupportJudgment } from "@/lib/schemas/reviewer-findings";
import { EXPLAINING, assessSupports, type SupportCleared, type SupportFindingCode } from "./assessment-safety";
import { studentText } from "./document-text";
import { EVALUATED_TYPES, contentStems } from "./support-evidence";
import { kindsOfBlock, type SupportFlag } from "./support-substitution";

/**
 * Etapa 2.3 · the semantic review of the supports. The reviewer (pedagogical_reviewer@v2) JUDGES each support next to what its activity
 * evaluates; THIS module decides what a judgment may change. Pure and deterministic: no model, no network.
 *
 *   access ≠ the answer          a support may teach a procedure, give vocabulary or recall a criterion without doing the student's work;
 *   a coincidence is not a fault only a judgment that names WHAT it replaces (an evaluated protected element of that activity) and HOW
 *                                (a concept stated, an operation performed, an item resolved or assigned, a result given) is confirmed;
 *   a missing judgment is never an approval  a support nobody judged is recorded and warns; it is never read as legitimate;
 *   an analogy is only suspected until it is shown to resolve an item or to replace the evaluated operation.
 */

export const SEMANTIC_POLICY_VERSION = "support_semantic@v1";

/**
 * `REVIEWER_V2_MODE`: `off` (default) the v1 reviewer exactly as it is; `shadow` the v2 reviewer judges and the SEMANTIC judgments are RECORDED with
 * no consequence (no check, no restriction, no flag, no substitution). It is one call, the v2 one, so the review's GENERAL findings come from the v2
 * prompt and may differ from what a v1 call would have said: the verdict and the delivery can differ from `off` for that reason alone.
 * `on` the judgments have consequences (only after validation and authorization).
 */
export type ReviewerV2Mode = "off" | "shadow" | "on";
export const REVIEWER_V2_MODES: readonly ReviewerV2Mode[] = ["off", "shadow", "on"];
export const DEFAULT_REVIEWER_V2_MODE: ReviewerV2Mode = "off";

/** The mode an adaptation really runs: the v2 prompt must be the one frozen at its creation, else it is the v1 reviewer whatever the switch says. */
export function effectiveReviewerMode(configured: ReviewerV2Mode | undefined, pinnedPromptVersion: number): ReviewerV2Mode {
  return pinnedPromptVersion === 2 ? (configured ?? DEFAULT_REVIEWER_V2_MODE) : "off";
}

// ---------------------------------------------------------------------------------------------------------------------
// What is judged
// ---------------------------------------------------------------------------------------------------------------------

/** Blocks that can carry content a student could copy or deduce an answer from. Planners and structure are procedural and are not judged. */
const JUDGED_BLOCKS = new Set<Block["type"]>(["vocabulary", "worked_example", "help_box", "list", "checklist", "sentence_starters"]);
const SUPPORT_ORIGINS = new Set<Block["trace"]["origin"]>(["support", "extension"]);

export interface SupportUnit {
  block_id: string;
  /** The activities the support belongs to (empty: a support for the whole sheet). */
  activity_ids: string[];
  decisions: string[];
  kind: SupportKind;
  /** The functional needs the decisions behind it attend: the profile's reason for this support. */
  serves: DimensionKey[];
}

export interface SemanticActivity {
  id: string;
  type: string;
  /** `explain`: the answer is an explanation or interpretation; `apply`: the student applies a procedure or a criterion. */
  asks: "explain" | "apply";
  response: string;
  /** What the activity evaluates: its protected concept/operation/reasoning/formula (`prt_N`) and its objectives. */
  evaluates: { protected: string[]; objectives: Array<{ id: string; text: string }> };
}

export interface SemanticSignal {
  block_id: string;
  /** Mechanical warnings of the support audit (etapa 2.1). A hint for priority, never a verdict. */
  codes: SupportFindingCode[];
  cleared?: SupportCleared;
}

export interface SemanticScope {
  units: SupportUnit[];
  activities: SemanticActivity[];
  signals: SemanticSignal[];
  /** Supports the sheet has but that did not fit the limit of judgments, in the order they were left out. */
  not_evaluated: SupportUnit[];
}

const SIGNAL_RANK = (codes: readonly SupportFindingCode[], cleared: SupportCleared | undefined): number => {
  if (codes.some((c) => c === "direct_answer_part" || c === "example_solves_item" || c === "defines_listed_categories")) return 0;
  if (codes.some((c) => c === "example_near_item" || c === "example_reuses_data" || c === "assigns_item_to_category")) return 1;
  if (codes.length > 0) return 2;
  return cleared ? 4 : 3;
};
const KIND_RANK: Partial<Record<SupportKind, number>> = { worked_example: 0, glossary: 1, key_idea: 2, guiding_questions: 3, reminder: 4, checklist: 5, self_check: 5, sentence_starters: 6 };

const cap = (text: string, n: number) => text.replace(/\s+/g, " ").trim().slice(0, n);

/**
 * The supports to judge and the context each one needs. When the sheet has more than `MAX_SUPPORT_JUDGMENTS`, the ones with the most
 * mechanical evidence come first, then by how much a kind of support can carry (an example before a reminder), then in the order of the
 * sheet: deterministic, and what is left out is returned (`not_evaluated`), never dropped silently and never read as approved.
 */
export function buildSemanticScope(analysis: MaterialAnalysis, plan: Pick<AdaptationPlan, "decisions">, document: MaterialDocument): SemanticScope {
  const assessment = assessSupports(analysis, document);
  const blocks = allBlocks(document);
  const candidates = blocks.flatMap((block, order) => {
    if (!SUPPORT_ORIGINS.has(block.trace.origin) || !JUDGED_BLOCKS.has(block.type)) return [];
    const decisions = block.trace.decision_ids.map((id) => plan.decisions.find((d) => d.id === id)).filter((d): d is Decision => d !== undefined);
    const kind = kindsOfBlock(block, decisions[0] ?? { supports: [] })[0];
    if (!kind) return [];
    const codes = [...new Set(assessment.findings.filter((f) => f.block_id === block.id).map((f) => f.code))];
    const cleared = assessment.cleared.find((c) => c.block_id === block.id)?.class;
    const unit: SupportUnit = {
      block_id: block.id,
      activity_ids: [...new Set(block.trace.source_refs.filter((r) => r.startsWith("act_")))],
      decisions: block.trace.decision_ids,
      kind,
      serves: [...new Set(decisions.flatMap((d) => d.dimensions))],
    };
    return [{ unit, codes, cleared, order, rank: [SIGNAL_RANK(codes, cleared), KIND_RANK[kind] ?? 7, order] as const }];
  });
  candidates.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
  const kept = candidates.slice(0, MAX_SUPPORT_JUDGMENTS);
  // Back to the order of the sheet: what the model reads follows the document, whatever decided what fits.
  kept.sort((a, b) => a.order - b.order);

  const activityIds = new Set(kept.flatMap((c) => c.unit.activity_ids));
  const sheetWide = kept.some((c) => c.unit.activity_ids.length === 0);
  const activities = analysis.activities
    .filter((a) => activityIds.has(a.id) || sheetWide)
    .map((a): SemanticActivity => ({
      id: a.id,
      type: a.type,
      asks: EXPLAINING.has(a.type) ? "explain" : "apply",
      response: a.response_format,
      evaluates: {
        protected: analysis.protected_elements.filter((p) => EVALUATED_TYPES.has(p.type) && p.activity_ids.includes(a.id)).map((p) => p.id),
        objectives: analysis.pedagogical_intent.objectives.filter((o) => a.objective_ids.includes(o.id)).map((o) => ({ id: o.id, text: cap(o.text, 160) })),
      },
    }));
  return {
    units: kept.map((c) => c.unit),
    activities,
    signals: kept.filter((c) => c.codes.length > 0 || c.cleared).map((c) => ({ block_id: c.unit.block_id, codes: c.codes, ...(c.cleared ? { cleared: c.cleared } : {}) })),
    not_evaluated: candidates.slice(MAX_SUPPORT_JUDGMENTS).map((c) => c.unit),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// From judgment to status
// ---------------------------------------------------------------------------------------------------------------------

/** confirmed: the support does what the activity evaluates (may fail the review); suspected: possible, only recorded and warned; legitimate; unjudged: nobody judged it. */
export type SemanticStatus = "confirmed" | "suspected" | "legitimate" | "unjudged";
export type SemanticReason =
  | "performs_cited"
  | "legitimate"
  | "hint"
  | "reviewer_unsure"
  | "analogy_needs_demonstration"
  | "how_not_demonstrated"
  | "uncited_element"
  | "concept_not_in_support"
  | "criterion_card_kept"
  | "conflicting_judgments"
  | "missing"
  | "over_limit";

export interface SemanticRecord {
  block_id: string;
  activity_ids: string[];
  decision_ids: string[];
  kind: SupportKind;
  status: SemanticStatus;
  class: SupportClass | null;
  how: SupportHow | null;
  protected_id: string | null;
  reason_code: SemanticReason;
  /** The reviewer's own short reason (≤120): kept with the record, never logged. */
  reason?: string;
}

/** The ways of «performing» that name something concrete a student was meant to do. An analogy is never one of them. */
const CONFIRMING: ReadonlySet<SupportHow> = new Set(["states_concept", "performs_operation", "resolves_item", "assigns_item", "gives_result"]);
/** What a criterion card may never do: carry out an item. Stating the criterion is what a card is for. */
const DIRECT: ReadonlySet<SupportHow> = new Set(["resolves_item", "assigns_item", "gives_result"]);

export interface SemanticOutcome {
  records: SemanticRecord[];
  /** Judgments that could not be used, as counts: a block that was not asked, a repeated block. Never an approval. */
  discarded: { unknown_block: number; duplicates: number };
}

export function judgeSupports(input: { analysis: MaterialAnalysis; scope: SemanticScope; document: MaterialDocument; judgments: readonly SupportJudgment[] }): SemanticOutcome {
  const { analysis, scope, document } = input;
  const blocks = new Map(allBlocks(document).map((b) => [b.id, b] as const));
  const asked = new Set(scope.units.map((u) => u.block_id));
  const byBlock = new Map<string, SupportJudgment[]>();
  const discarded = { unknown_block: 0, duplicates: 0 };
  for (const j of input.judgments) {
    if (!asked.has(j.block_id)) {
      discarded.unknown_block += 1;
      continue;
    }
    byBlock.set(j.block_id, [...(byBlock.get(j.block_id) ?? []), j]);
  }
  const card = new Set(scope.signals.filter((s) => s.cleared === "criterion_card").map((s) => s.block_id));
  const asks = new Map(scope.activities.map((a) => [a.id, a.asks] as const));

  const base = (unit: SupportUnit) => ({ block_id: unit.block_id, activity_ids: unit.activity_ids, decision_ids: unit.decisions, kind: unit.kind });
  const records = scope.units.map((unit): SemanticRecord => {
    const list = byBlock.get(unit.block_id) ?? [];
    if (list.length === 0) return { ...base(unit), status: "unjudged", class: null, how: null, protected_id: null, reason_code: "missing" };
    discarded.duplicates += list.length - 1;
    const j = list[0]!;
    const reason = j.reason ? { reason: j.reason } : {};
    const make = (status: SemanticStatus, reason_code: SemanticReason): SemanticRecord => ({ ...base(unit), status, class: j.class, how: j.how ?? null, protected_id: j.protected_id ?? null, reason_code, ...reason });
    // Two answers about the same support that disagree are not a judgment: possible at most, whichever way they lean.
    if (list.some((x) => x.class !== j.class || x.how !== j.how) && !list.every((x) => x.class === "legitimate")) return make("suspected", "conflicting_judgments");
    if (j.class === "legitimate") return make("legitimate", "legitimate");
    if (j.class === "unsure") return make("suspected", "reviewer_unsure");
    if (j.how === "analogy_of_item") return make("suspected", "analogy_needs_demonstration");
    if (j.class === "hints") return make("suspected", "hint");
    // class = performs: confirmed only when it names WHAT it replaces (an evaluated element of its own activity) and HOW.
    if (!j.how || !CONFIRMING.has(j.how)) return make("suspected", "how_not_demonstrated");
    const element = analysis.protected_elements.find((p) => p.id === j.protected_id && EVALUATED_TYPES.has(p.type) && (unit.activity_ids.length === 0 || p.activity_ids.some((a) => unit.activity_ids.includes(a))));
    if (!element) return make("suspected", "uncited_element");
    if (j.how === "states_concept") {
      // Stating a concept is only «performing» when the activity asks to EXPLAIN it; for an activity that APPLIES it, that is a criterion card.
      if (!element.activity_ids.some((a) => (unit.activity_ids.length === 0 || unit.activity_ids.includes(a)) && asks.get(a) === "explain")) return make("suspected", "criterion_card_kept");
      // An example illustrates a procedure; it does not state a concept: that claim about it is not demonstrated.
      if (unit.kind === "worked_example") return make("suspected", "how_not_demonstrated");
      // The support must actually speak of what is evaluated: at least two content words of the cited element or its objectives.
      const block = blocks.get(unit.block_id);
      const evaluated = contentStems([element.value, ...analysis.pedagogical_intent.objectives.filter((o) => analysis.activities.some((a) => element.activity_ids.includes(a.id) && a.objective_ids.includes(o.id))).map((o) => o.text)].join(" "));
      if (!block || [...contentStems(studentText(block))].filter((stem) => evaluated.has(stem)).length < 2) return make("suspected", "concept_not_in_support");
    }
    // A criterion card the audit already recognised is only confirmed if it carries out an item.
    if (card.has(unit.block_id) && !DIRECT.has(j.how)) return make("suspected", "criterion_card_kept");
    return make("confirmed", "performs_cited");
  });
  const unevaluated = scope.not_evaluated.map((unit): SemanticRecord => ({ ...base(unit), status: "unjudged", class: null, how: null, protected_id: null, reason_code: "over_limit" }));
  return { records: [...records, ...unevaluated], discarded };
}

// ---------------------------------------------------------------------------------------------------------------------
// Consequences (only in `on`)
// ---------------------------------------------------------------------------------------------------------------------

const WHAT: Record<SupportHow, string> = {
  states_concept: "enuncia el concepto que la actividad pide explicar",
  performs_operation: "realiza la operación que la actividad evalúa",
  resolves_item: "resuelve un ítem de la actividad",
  assigns_item: "asigna un ítem a su categoría",
  gives_result: "da el resultado de lo evaluado",
  analogy_of_item: "",
  other: "",
};

/**
 * The restriction a confirmed finding asks of the generator (fixed server wording: never the reviewer's text, never content). Each one says
 * what the support must not do and what it may still do: the educational need stays, only the part that did the student's work goes.
 */
export const SEMANTIC_RESTRICTIONS: Partial<Record<SupportHow, string>> = {
  states_concept: "No definas ni expliques en un apoyo lo que la actividad pide explicar: ofrece vocabulario secundario o preguntas de observación que no nombren lo evaluado.",
  performs_operation: "El apoyo no puede hacer la operación que evalúa la actividad: muestra el método con otros datos de otro ámbito y deja la operación al alumno.",
  resolves_item: "El apoyo no puede resolver ningún ítem de la actividad: usa otro ámbito y otros datos y deja el ítem al alumno.",
  assigns_item: "No asignes ningún ítem de la hoja a su categoría: explica el criterio sin clasificar nada.",
  gives_result: "El apoyo no puede dar el resultado de lo evaluado: guía el proceso sin dar el resultado.",
};
export const restrictionFor = (record: Pick<SemanticRecord, "how">): string | null => (record.how ? (SEMANTIC_RESTRICTIONS[record.how] ?? null) : null);

const ids = (list: Array<string | undefined>) => [...new Set(list.filter((t): t is string => !!t))];

/**
 * The checks a set of judgments adds to the review. A confirmed one FAILS `answers_not_leaked` on its support (so the automatic
 * correction repairs it); a suspected one and a support nobody judged each WARN once, together, and never block.
 */
export function semanticChecks(records: readonly SemanticRecord[]): CheckResult[] {
  const out: CheckResult[] = [];
  for (const r of records.filter((x) => x.status === "confirmed")) {
    const where = r.activity_ids[0] ? ` de ${r.activity_ids[0]}` : "";
    out.push({
      check: "answers_not_leaked",
      method: "ai",
      status: "FAIL",
      targets: ids([r.block_id, r.activity_ids[0], r.protected_id ?? undefined]),
      detail: `El apoyo ${r.block_id}${where} ${WHAT[r.how!]} (${r.protected_id}): el alumno ya no lo hace él; deja de ser un apoyo de acceso.`.slice(0, 240),
    });
  }
  const suspected = records.filter((x) => x.status === "suspected");
  if (suspected.length > 0) out.push({ check: "answers_not_leaked", method: "ai", status: "WARN", targets: suspected.map((r) => r.block_id).slice(0, 30), detail: `Posible apoyo que facilita en exceso la respuesta en ${suspected.length} caso(s); sin evidencia suficiente para bloquear: se registra.` });
  const unjudged = records.filter((x) => x.status === "unjudged");
  if (unjudged.length > 0) out.push({ check: "answers_not_leaked", method: "ai", status: "WARN", targets: unjudged.map((r) => r.block_id).slice(0, 30), detail: `Sin juicio semántico sobre ${unjudged.length} apoyo(s) (${unjudged.some((r) => r.reason_code === "over_limit") ? "fuera del límite de la revisión o " : ""}no juzgados): no se dan por aprobados.`, needs_semantic_review: true });
  return out;
}

/**
 * The decisions whose support the semantic review CONFIRMED as performing the evaluated work, as the flags the repair already knows
 * (etapa 2.2). `kinds` are the kinds of the confirmed blocks only: the substitution replaces what failed, nothing else.
 */
export function semanticFlags(records: readonly SemanticRecord[], effective: readonly Decision[]): Map<string, SupportFlag> {
  const flags = new Map<string, SupportFlag>();
  for (const r of records.filter((x) => x.status === "confirmed")) {
    for (const id of r.decision_ids) {
      const decision = effective.find((d) => d.id === id && d.action !== "keep");
      if (!decision) continue;
      const before = flags.get(id);
      flags.set(id, {
        decisionId: id,
        activityId: r.activity_ids[0] ?? decision.target,
        blockIds: [...new Set([...(before?.blockIds ?? []), r.block_id])],
        kinds: [...new Set([...(before?.kinds ?? []), r.kind])],
        trigger: "semantic_confirmed",
        codes: [],
      });
    }
  }
  return flags;
}

/** What each decision's needs can be called after the review: `clear` is the only state that may be read as «the need is applied». */
export type NeedState = "clear" | "suspected" | "unjudged" | "flagged";
export function needStates(records: readonly SemanticRecord[], decisions: readonly Pick<Decision, "id" | "dimensions">[]): Array<{ decision_id: string; dimensions: DimensionKey[]; state: NeedState }> {
  const rank: Record<NeedState, number> = { clear: 0, suspected: 1, unjudged: 2, flagged: 3 };
  const of = (r: SemanticRecord): NeedState => (r.status === "confirmed" ? "flagged" : r.status === "suspected" ? "suspected" : r.status === "unjudged" ? "unjudged" : "clear");
  return decisions.flatMap((d) => {
    const mine = records.filter((r) => r.decision_ids.includes(d.id));
    if (mine.length === 0) return [];
    const state = mine.map(of).reduce((a, b) => (rank[b] > rank[a] ? b : a), "clear" as NeedState);
    return [{ decision_id: d.id, dimensions: [...d.dimensions], state }];
  });
}

/** The record of a review's semantic judgments as stored next to it: ids, codes and counts. */
export interface SemanticRecordSet {
  policy: typeof SEMANTIC_POLICY_VERSION;
  mode: ReviewerV2Mode;
  /**
   * Where the GENERAL findings of this review (age, tone, functional supports, the leak check of v1) came from: the same v2 call that produced
   * the judgments, merged as always. In `shadow` the judgments have no consequences, but these findings DO count, and they may differ from the
   * ones a v1 call would have given: `shadow` is not transparent with respect to them (docs/qa/etapa-2-3-semantica).
   */
  general_findings: "v2_call";
  records: SemanticRecord[];
  counts: Record<SemanticStatus, number>;
  discarded: SemanticOutcome["discarded"];
  needs: ReturnType<typeof needStates>;
}

export function summarize(mode: ReviewerV2Mode, outcome: SemanticOutcome, decisions: readonly Pick<Decision, "id" | "dimensions">[]): SemanticRecordSet {
  const counts: Record<SemanticStatus, number> = { confirmed: 0, suspected: 0, legitimate: 0, unjudged: 0 };
  for (const r of outcome.records) counts[r.status] += 1;
  return { policy: SEMANTIC_POLICY_VERSION, mode, general_findings: "v2_call", records: outcome.records, counts, discarded: outcome.discarded, needs: needStates(outcome.records, decisions) };
}
