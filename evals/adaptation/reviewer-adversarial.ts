import { fingerprint } from "@/lib/adaptation/fingerprint";
import { protectedFor } from "@/lib/adaptation/facts";
import { reviewPlan, type ReviewedPlan } from "@/lib/adaptation/plan-review";
import { deterministicChecks } from "@/lib/adaptation/review";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { AdaptationPlanSchema, type AdaptationPlan, type Decision } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { CheckResult, PedagogicalReview, ReviewCheck } from "@/lib/schemas/pedagogical-review";
import type { PlanReview } from "@/lib/schemas/plan-review";

/**
 * Adversarial copy of a REAL MaterialDocument, for an eval of the pedagogical reviewer only (docs/ADAPTATION.md § Revisor).
 * Deterministic and pure: the base document, its plan and its review are never modified (everything is cloned); five support
 * blocks are added, each under a decision added to a COPY of the plan, so the trace stays coherent and the ReviewContext has the
 * same shape it would have in production. Nothing in the document marks a block as adversarial. The expectations and the scoring
 * rules are data, frozen to disk with their hashes BEFORE the model is called.
 */

export const ADVERSARIAL_VERSION = 1;

export type Risk = "semantic_leak" | "indirect_hint" | "infantilization" | "semantic_redundancy" | "safe_control";
export type Severity = "PASS" | "WARN" | "FAIL";

interface BlockSpec {
  type: "help_box" | "planner";
  variant?: "key_idea" | "reminder" | "tip" | "strategy";
  text?: string;
  title?: string;
  slots?: Array<{ label: string; lines: number }>;
}

export interface MutationSpec {
  mutation_id: string;
  risk: Risk;
  /** Activity the support is attached to. */
  target: string;
  support_kind: "reminder" | "key_idea" | "planner";
  block: BlockSpec;
  /** Checks that should react (any of them counts) and the lowest severity that is a detection. */
  expected_checks: ReviewCheck[];
  min_severity: Severity;
  /** How a finding is matched to this mutation: structurally, never by wording. */
  match: "block_decision_or_activity" | "block_or_decision";
  /** Why this mutation is in the experiment. */
  intent: string;
}

export const MUTATIONS: readonly MutationSpec[] = [
  {
    mutation_id: "mut_A_semantic_leak",
    risk: "semantic_leak",
    target: "act_3",
    support_kind: "reminder",
    block: { type: "help_box", variant: "reminder", text: "Fíjate en cómo la idea que aparece después se enfrenta a la anterior." },
    expected_checks: ["answers_not_leaked"],
    min_severity: "FAIL",
    match: "block_decision_or_activity",
    intent: "Revela la relación (valor adversativo) sin usar oposición, contraste ni adversativa: un buscador de subcadenas no puede verlo.",
  },
  {
    mutation_id: "mut_B_indirect_hint",
    risk: "indirect_hint",
    target: "act_4",
    support_kind: "key_idea",
    block: { type: "help_box", variant: "key_idea", text: "En este texto no hay expresiones coloquiales y las frases son largas y muy elaboradas: eso es lo que tienes que mencionar al justificar." },
    expected_checks: ["answers_not_leaked", "functional_supports_applied"],
    min_severity: "WARN",
    match: "block_or_decision",
    intent: "Da de antemano el registro y el tipo de rasgos que el alumno debía decidir: reduce el razonamiento sin ser una respuesta completa.",
  },
  {
    mutation_id: "mut_C_infantilization",
    risk: "infantilization",
    target: "act_5",
    support_kind: "reminder",
    block: { type: "help_box", variant: "reminder", text: "Vamos a jugar a ser escritores: primero piensa tu idea y luego completa cada paso como un reto." },
    expected_checks: ["age_appropriate", "no_infantilization"],
    min_severity: "WARN",
    match: "block_or_decision",
    intent: "Tono impropio de Bachillerato sin emoji, diminutivo ni «niño»: exige juicio semántico.",
  },
  {
    mutation_id: "mut_D_semantic_redundancy",
    risk: "semantic_redundancy",
    target: "act_1",
    support_kind: "reminder",
    block: { type: "help_box", variant: "reminder", text: "Tu resumen tiene que ser corto, con tus propias palabras y sin copiar las frases del texto tal como están." },
    expected_checks: ["functional_supports_applied"],
    min_severity: "WARN",
    match: "block_or_decision",
    intent: "Reformula sin copiar lo que la consigna ya dice: más carga y ninguna función nueva.",
  },
  {
    mutation_id: "mut_E_safe_control",
    risk: "safe_control",
    target: "act_2",
    support_kind: "planner",
    block: { type: "planner", title: "Mis notas", slots: [{ label: "Mis ideas", lines: 2 }, { label: "Orden de mi respuesta", lines: 2 }, { label: "Lo que reviso", lines: 1 }] },
    expected_checks: [],
    min_severity: "PASS",
    match: "block_or_decision",
    intent: "Control negativo: un planificador vacío de proceso, sin contenido de respuesta ni repetición de la consigna. No debe generar un hallazgo material.",
  },
];

export interface AppliedMutation extends MutationSpec {
  block_id: string;
  decision_id: string;
}

export interface AdversarialCopy {
  document: MaterialDocument;
  rawPlan: AdaptationPlan;
  review: PlanReview;
  reviewed: ReviewedPlan;
  mutations: AppliedMutation[];
}

const blockNumber = (id: string) => Number(/^blk_(\d+)$/.exec(id)?.[1] ?? 0);

export interface AdversarialSource {
  analysis: MaterialAnalysis;
  context: AdaptationContext;
  rawPlan: AdaptationPlan;
  review: PlanReview;
  document: MaterialDocument;
}

/** Pure: clones everything, adds the given mutations (default all) and never touches the source. */
export function buildAdversarialCopy(source: AdversarialSource, only?: readonly string[]): AdversarialCopy {
  const specs = MUTATIONS.filter((m) => (only ? only.includes(m.mutation_id) : true));
  const document = structuredClone(source.document);
  const rawPlan: AdaptationPlan = structuredClone(source.rawPlan);
  const review: PlanReview = structuredClone(source.review);
  const dimension = source.context.needs.find((n) => n.dimension === "planning_support")?.dimension ?? source.context.needs[0]!.dimension;

  let nextBlock = Math.max(0, ...allBlocks(document).map((b) => blockNumber(b.id)));
  let nextDecision = Math.max(0, ...rawPlan.decisions.map((d) => Number(d.id.slice(4))));
  const applied: AppliedMutation[] = [];

  for (const spec of specs) {
    const decisionId = `dec_${++nextDecision}`;
    const blockId = `blk_${String(++nextBlock).padStart(4, "0")}`;
    const decision: Decision = {
      id: decisionId,
      target: spec.target,
      action: "add_support",
      strategies: ["planning_support"],
      dimensions: [dimension],
      intensity: "light",
      preserves: protectedFor(source.analysis, spec.target).map((p) => p.id),
      supports: [{ kind: spec.support_kind, uses_task_data: false }],
      flags: [],
    };
    rawPlan.decisions.push(decision);
    review.entries.push({ decision_id: decisionId, action: "approved", reason: "Apoyo del experimento adversarial." });

    const trace = { origin: "support" as const, source_refs: [spec.target], decision_ids: [decisionId] };
    const block = (spec.block.type === "planner"
      ? { id: blockId, type: "planner", title: spec.block.title, slots: spec.block.slots, trace }
      : { id: blockId, type: "help_box", variant: spec.block.variant, text: spec.block.text, trace }) as Block;

    // Right after the last block of the target activity, on its page.
    let placed = false;
    for (const page of document.pages) {
      const last = page.blocks.map((b, i) => (b.trace.source_refs.includes(spec.target) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
      if (last >= 0) {
        page.blocks.splice(last + 1, 0, block);
        placed = true;
        break;
      }
    }
    if (!placed) throw new Error(`No hay bloque de ${spec.target} donde insertar ${spec.mutation_id}.`);
    applied.push({ ...spec, block_id: blockId, decision_id: decisionId });
  }

  // The review is bound to the COPY of the plan; the historical review and plan keep their own fingerprints.
  review.plan_fingerprint = fingerprint(AdaptationPlanSchema.parse(rawPlan));
  review.reviewer = { kind: "eval", label: "eval-adversarial" };
  const reviewed = reviewPlan(rawPlan, review, source.analysis, source.context);
  return { document, rawPlan, review, reviewed, mutations: applied };
}

/** Which deterministic checks react to each mutation on its own, compared with the base document. */
export function deterministicDetection(source: AdversarialSource): Array<{ mutation_id: string; changed: Array<{ check: string; from: string; to: string }>; fails: string[]; opens_semantic_review: boolean }> {
  const baseReviewed = reviewPlan(source.rawPlan, source.review, source.analysis, source.context);
  const base = deterministicChecks({ analysis: source.analysis, plan: baseReviewed.effective, context: source.context, document: source.document, validation: baseReviewed.effectiveValidation });
  return MUTATIONS.map((m) => {
    const one = buildAdversarialCopy(source, [m.mutation_id]);
    const now = deterministicChecks({ analysis: source.analysis, plan: one.reviewed.effective, context: source.context, document: one.document, validation: one.reviewed.effectiveValidation });
    const at = (list: CheckResult[], check: string) => list.find((c) => c.check === check);
    const changed = now
      .filter((c) => {
        const before = at(base, c.check);
        return !before || before.status !== c.status || JSON.stringify(before.targets) !== JSON.stringify(c.targets);
      })
      .map((c) => ({ check: c.check, from: at(base, c.check)?.status ?? "—", to: c.status }));
    return { mutation_id: m.mutation_id, changed, fails: now.filter((c) => c.status === "FAIL").map((c) => c.check), opens_semantic_review: now.some((c) => c.needs_semantic_review) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Scoring: structural and frozen. A finding is matched to a mutation by check and target, never by what it says.
// ---------------------------------------------------------------------------------------------------------------------

export type Detection = "HIT" | "PARTIAL" | "MISS" | "CORRECT" | "TOO_STRICT" | "FALSE_POSITIVE";
const RANK: Record<Severity, number> = { PASS: 0, WARN: 1, FAIL: 2 };

export interface MutationScore {
  mutation_id: string;
  detection: Detection;
  severity: Severity | null;
  matched: Array<{ check: string; status: string; targets: string[] }>;
}

export function scoreMutations(mutations: readonly AppliedMutation[], review: Pick<PedagogicalReview, "checks">): MutationScore[] {
  const ai = review.checks.filter((c) => c.method === "ai");
  return mutations.map((m) => {
    const direct = (c: CheckResult) => c.targets.includes(m.block_id) || c.targets.includes(m.decision_id) || (m.match === "block_decision_or_activity" && c.targets.includes(m.target));
    const matched = ai.filter((c) => (m.risk === "safe_control" ? direct(c) : m.expected_checks.includes(c.check) && direct(c)));
    const documentWide = m.risk === "safe_control" ? [] : ai.filter((c) => m.expected_checks.includes(c.check) && c.targets.length === 0 && c.status !== "PASS");
    const severity = matched.reduce<Severity | null>((worst, c) => (worst === null || RANK[c.status as Severity] > RANK[worst] ? (c.status as Severity) : worst), null);
    const brief = (c: CheckResult) => ({ check: c.check, status: c.status, targets: c.targets });

    if (m.risk === "safe_control") {
      const adverse = matched.filter((c) => c.status !== "PASS");
      if (adverse.some((c) => c.status === "FAIL")) return { mutation_id: m.mutation_id, detection: "TOO_STRICT", severity: "FAIL", matched: adverse.map(brief) };
      if (adverse.length > 0) return { mutation_id: m.mutation_id, detection: "FALSE_POSITIVE", severity: "WARN", matched: adverse.map(brief) };
      return { mutation_id: m.mutation_id, detection: "CORRECT", severity, matched: matched.map(brief) };
    }
    // Semantic redundancy is a WARN: a FAIL would be over-severe, so it is only a partial detection.
    if (m.risk === "semantic_redundancy" && severity === "FAIL") return { mutation_id: m.mutation_id, detection: "PARTIAL", severity, matched: matched.map(brief) };
    const need = RANK[m.min_severity];
    if (severity !== null && RANK[severity] >= need) return { mutation_id: m.mutation_id, detection: "HIT", severity, matched: matched.map(brief) };
    if (severity !== null && severity !== "PASS") return { mutation_id: m.mutation_id, detection: "PARTIAL", severity, matched: matched.map(brief) };
    if (documentWide.length > 0) return { mutation_id: m.mutation_id, detection: "PARTIAL", severity: documentWide[0]!.status as Severity, matched: documentWide.map(brief) };
    return { mutation_id: m.mutation_id, detection: "MISS", severity, matched: matched.map(brief) };
  });
}
