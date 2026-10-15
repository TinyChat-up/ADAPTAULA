import { adapt, type AdaptationPlan } from "./adapter";
import type { Case } from "./cases";
import { CRITERIA, type Criterion, type Evaluation, type Status } from "./contract";
import { evaluate } from "./evaluate";
import { applyMutation, type MutationSpec } from "./mutations";

/**
 * Runs every case: the correct candidates of the controlled adapter (plus a literal-copy control) and every deliberate error,
 * and aggregates what the phase measures. Candidates come from `adapt(original, plan)`; the reference is only read by `evaluate`.
 */

const LITERAL: AdaptationPlan = { id: "control_copia_literal", description: "Copia literal del original sin apoyos (control de falsos bloqueos).", segmentTexts: [], activities: {} };

export interface CandidateResult { caseId: string; plan: string; kind: "correcta" | "control"; evaluation: Evaluation }
export interface MutationResult {
  caseId: string;
  mutation: MutationSpec;
  evaluation: Evaluation;
  /** Verifiable error: FAIL on the expected check. Non-verifiable: whether some check happened to fail anyway. */
  detected: boolean;
  /** FAILs other than the expected one (they also block, but are not what the error was about). */
  otherFails: string[];
}
export interface CaseResult {
  caseId: string;
  split: "development" | "holdout";
  subject: string;
  activityType: string;
  validation: string;
  candidates: CandidateResult[];
  mutations: MutationResult[];
  /** The reference adaptation, if any, scored against its own reference (consistency only, not a result). */
  referenceAdaptation: Evaluation | null;
}

export function runCase(c: Case): CaseResult {
  const ref = c.reference;
  const candidates: CandidateResult[] = [
    ...c.plans.map((p) => ({ caseId: ref.id, plan: p.id, kind: "correcta" as const, evaluation: evaluate(ref, adapt(c.original, p)) })),
    { caseId: ref.id, plan: LITERAL.id, kind: "control" as const, evaluation: evaluate(ref, adapt(c.original, LITERAL)) },
  ];
  const base = adapt(c.original, c.plans.find((p) => p.id === c.mutationBase)!);
  const mutations = c.mutations.map((m): MutationResult => {
    const evaluation = evaluate(ref, applyMutation(base, m));
    const fails = evaluation.findings.filter((f) => f.status === "FAIL");
    const hit = m.expect ? fails.some((f) => f.criterion === m.expect!.criterion && f.check === m.expect!.check) : false;
    return {
      caseId: ref.id, mutation: m, evaluation,
      detected: m.verifiable ? hit : fails.length > 0,
      otherFails: fails.filter((f) => !m.expect || f.criterion !== m.expect.criterion || f.check !== m.expect.check).map((f) => `${f.criterion}/${f.check}`),
    };
  });
  return {
    caseId: ref.id, split: ref.split, subject: ref.subject, activityType: ref.activityType, validation: ref.validation.status, candidates, mutations,
    referenceAdaptation: ref.referenceAdaptation ? evaluate(ref, ref.referenceAdaptation) : null,
  };
}

const count = (findings: Evaluation["findings"], status: Status) => findings.filter((f) => f.status === status).length;

export interface Summary {
  cases: number;
  teacherValidatedReferences: number;
  correctCandidates: number;
  falseBlocks: { caseId: string; plan: string; fails: string[] }[];
  criticalPreservation: { pass: number; total: number };
  verifiableErrors: { total: number; detected: number; missed: { caseId: string; id: string; got: string[] }[] };
  nonVerifiableErrors: { total: number; caughtAnyway: number; reachedTeacher: number; ids: string[] };
  leaks: { mutations: number; detected: number; inCorrectCandidates: number };
  figures: { mutations: number; detected: number; correctCandidatePass: number; correctCandidateTotal: number };
  needsTeacherReview: { correctCandidates: number; findingsPerCandidate: number };
  byCriterionOnCorrect: Record<Criterion, Record<Status, number>>;
  coverage: { subject: string; activityType: string; caseId: string; mutations: number; detected: number; falseBlocks: number }[];
}

const FIGURE_ERRORS = new Set(["etiquetas_confundidas", "figura_sustituida", "figura_resuelta", "figura_reasignada"]);
const isFigureMutation = (m: MutationSpec) => FIGURE_ERRORS.has(m.errorType) || m.ops.some((o) => o.op.includes("figure"));

export function summarize(results: readonly CaseResult[]): Summary {
  const correct = results.flatMap((r) => r.candidates);
  const muts = results.flatMap((r) => r.mutations);
  const verifiable = muts.filter((m) => m.mutation.verifiable);
  const nonVerifiable = muts.filter((m) => !m.mutation.verifiable);
  const leakMuts = verifiable.filter((m) => m.mutation.expect?.criterion === "C_seguridad_respuestas");
  const figMuts = verifiable.filter((m) => isFigureMutation(m.mutation));
  const figFindings = correct.flatMap((c) => c.evaluation.findings.filter((f) => f.check === "figura" || f.check === "figura_resuelta" || f.check === "figura_en_otra_actividad"));
  const critical = correct.flatMap((c) => c.evaluation.findings.filter((f) => f.criterion === "A_conservacion_datos"));
  const byCriterion = Object.fromEntries(CRITERIA.map((k) => [k, { PASS: 0, FAIL: 0, NEEDS_TEACHER_REVIEW: 0, NOT_APPLICABLE: 0 }])) as Summary["byCriterionOnCorrect"];
  for (const c of correct) for (const k of CRITERIA) byCriterion[k][c.evaluation.byCriterion[k]] += 1;
  return {
    cases: results.length,
    teacherValidatedReferences: results.filter((r) => r.validation !== "sintetica_provisional").length,
    correctCandidates: correct.length,
    falseBlocks: correct.filter((c) => c.evaluation.verdict === "FAIL").map((c) => ({ caseId: c.caseId, plan: c.plan, fails: c.evaluation.findings.filter((f) => f.status === "FAIL").map((f) => `${f.criterion}/${f.check}: ${f.detail}`) })),
    criticalPreservation: { pass: count(critical, "PASS"), total: critical.length },
    verifiableErrors: { total: verifiable.length, detected: verifiable.filter((m) => m.detected).length, missed: verifiable.filter((m) => !m.detected).map((m) => ({ caseId: m.caseId, id: m.mutation.id, got: m.otherFails })) },
    nonVerifiableErrors: {
      total: nonVerifiable.length,
      caughtAnyway: nonVerifiable.filter((m) => m.detected).length,
      reachedTeacher: nonVerifiable.filter((m) => m.evaluation.verdict === "NEEDS_TEACHER_REVIEW").length,
      ids: nonVerifiable.map((m) => `${m.caseId}/${m.mutation.id}`),
    },
    leaks: { mutations: leakMuts.length, detected: leakMuts.filter((m) => m.detected).length, inCorrectCandidates: correct.filter((c) => c.evaluation.findings.some((f) => f.criterion === "C_seguridad_respuestas" && f.status === "FAIL")).length },
    figures: { mutations: figMuts.length, detected: figMuts.filter((m) => m.detected).length, correctCandidatePass: count(figFindings, "PASS"), correctCandidateTotal: figFindings.length },
    needsTeacherReview: { correctCandidates: correct.filter((c) => c.evaluation.verdict === "NEEDS_TEACHER_REVIEW").length, findingsPerCandidate: correct.length ? +(correct.reduce((n, c) => n + count(c.evaluation.findings, "NEEDS_TEACHER_REVIEW"), 0) / correct.length).toFixed(1) : 0 },
    byCriterionOnCorrect: byCriterion,
    coverage: results.map((r) => ({
      subject: r.subject, activityType: r.activityType, caseId: r.caseId,
      mutations: r.mutations.filter((m) => m.mutation.verifiable).length, detected: r.mutations.filter((m) => m.mutation.verifiable && m.detected).length,
      falseBlocks: r.candidates.filter((c) => c.evaluation.verdict === "FAIL").length,
    })),
  };
}
