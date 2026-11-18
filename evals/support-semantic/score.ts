import type { SemanticStatus } from "@/lib/adaptation/support-semantic";
import type { CorpusEntry, CorpusLabel } from "./corpus";

/**
 * How the semantic review is measured BEFORE it is allowed to act (`REVIEWER_V2_MODE=on`). Pure: it scores a list of results against the labels
 * of the corpus; running the real reviewer (which costs money and needs a person's authorization) only produces the `results`.
 *
 * Two honesty rules:
 *  1. The reference label is the one a person wrote (`review.final_label`), and the report says WHO wrote it (`labels`): an AI-assisted review
 *     is one reviewer, not two; the team's provisional label is never a reference.
 *  2. A sample says only what its size allows. With a few dozen supports a rate cannot be «shown high with statistical confidence»: the report
 *     gives the exact count, the 95 % interval and how many cases a claim would need, and marks the result `exploratory` until it has them.
 *
 * Priorities, in order: legitimate supports confirmed (false positives), answer-giving supports not even suspected (false negatives), changes
 * of deliverability against v1, stability of the judgments, and cost per valid delivered adaptation.
 */

/** What should NEVER be confirmed: supports that give access, recall a criterion to apply or teach a procedure. */
const LEGITIMATE: ReadonlySet<CorpusLabel> = new Set(["legitimate_access", "criterion_card", "method_example"]);
/** What a confirmed finding should be: the support does what the activity evaluates. */
const POSITIVE: ReadonlySet<CorpusLabel> = new Set(["performs_competence"]);
/** Worth at least a suspicion. */
const SUSPECT: ReadonlySet<CorpusLabel> = new Set(["performs_competence", "over_hint"]);

export interface ScoredResult {
  id: string;
  status: SemanticStatus;
}

// ---------------------------------------------------------------------------------------------------------------------
// Statistics that respect the sample size
// ---------------------------------------------------------------------------------------------------------------------

/** Lower bound of the 95 % Wilson interval: what a small sample really supports. */
export function wilsonLower(successes: number, n: number, z = 1.96): number | null {
  if (n === 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
}

/** P(X ≤ k) for X ~ Binomial(n, p). */
function binomialCdf(k: number, n: number, p: number): number {
  let term = Math.pow(1 - p, n);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= ((n - i + 1) / i) * (p / (1 - p));
    sum += term;
  }
  return Math.min(1, sum);
}

/**
 * Exact one-sided 95 % upper bound (Clopper–Pearson) of a rate observed as `events` in `n`: the highest true rate that still makes what was
 * seen plausible. With 0 events it is 1 − 0.05^(1/n) («rule of three»: ≈ 3/n).
 */
export function upperBound95(events: number, n: number): number | null {
  if (n === 0) return null;
  if (events >= n) return 1;
  let lo = events / n;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(events, n, mid) > 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The cases needed, ALL without a failure, for the upper bound of the failure rate to be at most `maxRate` (95 %). 29 for 10 %, 59 for 5 %. */
export const casesForZeroFailures = (maxRate: number): number => Math.ceil(Math.log(0.05) / Math.log(1 - maxRate));

// ---------------------------------------------------------------------------------------------------------------------
// Who labelled
// ---------------------------------------------------------------------------------------------------------------------

/** From weakest to strongest. A set of labels is as strong as its weakest entry. */
export const LABEL_LEVELS = ["provisional", "single_reviewer_ai_assisted", "single_human", "two_independent_humans"] as const;
export type LabelLevel = (typeof LABEL_LEVELS)[number];

/** The level of ONE entry: only distinct `human` reviewers are independent; `human_ai_assisted` is one reviewer; `ai` is not a reviewer. */
export function entryLevel(e: CorpusEntry): LabelLevel {
  if (e.review.final_label === null) return "provisional";
  const humans = new Set(e.review.labels.filter((l) => l.source === "human").map((l) => l.reviewer));
  const assisted = new Set(e.review.labels.filter((l) => l.source === "human_ai_assisted").map((l) => l.reviewer));
  if (humans.size >= 2) return "two_independent_humans";
  if (humans.size === 1) return "single_human";
  return assisted.size >= 1 ? "single_reviewer_ai_assisted" : "provisional";
}

export const labelLevel = (entries: readonly CorpusEntry[]): LabelLevel =>
  entries.map(entryLevel).reduce<LabelLevel>((weakest, level) => (LABEL_LEVELS.indexOf(level) < LABEL_LEVELS.indexOf(weakest) ? level : weakest), "two_independent_humans");

/** Entries whose decision matters most and that should have a second HUMAN before anything acts: the final label differs from the team's provisional one, or it says the support performs the competence / hints too much / is ambiguous. */
export const isCritical = (e: CorpusEntry): boolean => {
  const label = e.review.final_label ?? e.provisional.label;
  return label !== e.provisional.label || label === "ambiguous" || SUSPECT.has(label);
};

export const referenceLabel = (e: CorpusEntry): CorpusLabel => e.review.final_label ?? e.provisional.label;

// ---------------------------------------------------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------------------------------------------------

export interface CorpusScore {
  labels: LabelLevel;
  n: number;
  /** Ambiguous entries: left out of the rates, counted here. */
  excluded: number;
  legitimate_n: number;
  positives_n: number;
  /** Critical entries that do not have a second independent human yet. */
  critical_without_second_human: number;
  confirmed: { total: number; true_positive: number; false_positive: number; precision: number | null; precision_wilson_lower: number | null };
  /** Legitimate supports (access, criterion card, method example) confirmed: the first priority. */
  false_positive_ids: string[];
  /** Upper bound (95 %) of the rate of legitimate supports that would be confirmed, given what was observed. */
  false_positive_rate_upper95: number | null;
  /** Legitimate supports merely suspected: not blocking, but noise in the record. */
  suspected_legitimate_ids: string[];
  /** Supports that perform the competence and were not even suspected: the second priority. */
  false_negative_ids: string[];
  recall_confirmed: number | null;
  recall_at_least_suspected: number | null;
  unjudged: number;
  /** `exploratory`: the sample does not allow a statistical claim about the false-positive rate; see `EVIDENCE`. */
  evidence: "exploratory" | "supports_pilot" | "supports_default";
}

export function scoreCorpus(entries: readonly CorpusEntry[], results: readonly ScoredResult[]): CorpusScore {
  const byId = new Map(results.map((r) => [r.id, r.status] as const));
  const rated = entries.filter((e) => referenceLabel(e) !== "ambiguous");
  const statusOf = (e: CorpusEntry): SemanticStatus => byId.get(e.id) ?? "unjudged";

  const confirmed = rated.filter((e) => statusOf(e) === "confirmed");
  const truePositive = confirmed.filter((e) => POSITIVE.has(referenceLabel(e))).length;
  const falsePositive = confirmed.filter((e) => LEGITIMATE.has(referenceLabel(e)));
  const legitimate = rated.filter((e) => LEGITIMATE.has(referenceLabel(e)));
  const positives = rated.filter((e) => POSITIVE.has(referenceLabel(e)));
  const suspectable = rated.filter((e) => SUSPECT.has(referenceLabel(e)));
  const fpUpper = upperBound95(falsePositive.length, legitimate.length);
  return {
    labels: labelLevel(entries),
    n: rated.length,
    excluded: entries.length - rated.length,
    legitimate_n: legitimate.length,
    positives_n: positives.length,
    critical_without_second_human: entries.filter((e) => isCritical(e) && entryLevel(e) !== "two_independent_humans").length,
    confirmed: { total: confirmed.length, true_positive: truePositive, false_positive: falsePositive.length, precision: confirmed.length ? truePositive / confirmed.length : null, precision_wilson_lower: wilsonLower(truePositive, confirmed.length) },
    false_positive_ids: falsePositive.map((e) => e.id),
    false_positive_rate_upper95: fpUpper,
    suspected_legitimate_ids: legitimate.filter((e) => statusOf(e) === "suspected").map((e) => e.id),
    false_negative_ids: positives.filter((e) => statusOf(e) === "legitimate" || statusOf(e) === "unjudged").map((e) => e.id),
    recall_confirmed: positives.length ? positives.filter((e) => statusOf(e) === "confirmed").length / positives.length : null,
    recall_at_least_suspected: suspectable.length ? suspectable.filter((e) => statusOf(e) === "confirmed" || statusOf(e) === "suspected").length / suspectable.length : null,
    unjudged: rated.filter((e) => statusOf(e) === "unjudged").length,
    evidence: falsePositive.length > 0 ? "exploratory" : legitimate.length >= EVIDENCE.default.zeroFailureCases ? "supports_default" : legitimate.length >= EVIDENCE.pilot.zeroFailureCases ? "supports_pilot" : "exploratory",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stability, deliverability, cost
// ---------------------------------------------------------------------------------------------------------------------

/** Agreement between repeated runs of the SAME frozen corpus: the share of supports that got the same status every time. */
export function consistency(runs: ReadonlyArray<readonly ScoredResult[]>): number | null {
  if (runs.length < 2) return null;
  const ids = [...new Set(runs.flatMap((r) => r.map((x) => x.id)))];
  if (ids.length === 0) return null;
  const same = ids.filter((id) => new Set(runs.map((r) => r.find((x) => x.id === id)?.status ?? "unjudged")).size === 1).length;
  return same / ids.length;
}

/**
 * The instability that matters: a support that one run CONFIRMS and another calls LEGITIMATE. A move between «suspected» and either of them is
 * noise; this one decides whether a support is withdrawn or kept, so each is listed and examined, never averaged away.
 */
export function criticalFlips(runs: ReadonlyArray<readonly ScoredResult[]>): string[] {
  const ids = [...new Set(runs.flatMap((r) => r.map((x) => x.id)))];
  return ids.filter((id) => {
    const seen = new Set(runs.map((r) => r.find((x) => x.id === id)?.status));
    return seen.has("confirmed") && seen.has("legitimate");
  });
}

/** Documents whose delivery changes between v1 and v2 (`usable` = delivered). Each one is a case for a person, not a rate. */
export function deliverabilityChanges(pairs: ReadonlyArray<{ id: string; v1Usable: boolean; v2Usable: boolean }>): { became_unusable: string[]; became_usable: string[]; n: number } {
  return {
    became_unusable: pairs.filter((p) => p.v1Usable && !p.v2Usable).map((p) => p.id),
    became_usable: pairs.filter((p) => !p.v1Usable && p.v2Usable).map((p) => p.id),
    n: pairs.length,
  };
}

/**
 * What a VALID DELIVERED adaptation costs: everything spent on the adaptations of the cohort (the ones that were not delivered and the
 * regenerations and re-asks included) divided by how many were delivered. A cost that is unknown makes the result unknown, never a lower number.
 */
export function costPerDelivered(adaptations: ReadonlyArray<{ delivered: boolean; costsUsd: ReadonlyArray<number | null> }>): { usd: number | null; delivered: number; total_usd: number | null } {
  const delivered = adaptations.filter((a) => a.delivered).length;
  const all = adaptations.flatMap((a) => a.costsUsd);
  const total = all.some((c) => c === null) ? null : all.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  return { usd: total === null || delivered === 0 ? null : total / delivered, delivered, total_usd: total };
}

// ---------------------------------------------------------------------------------------------------------------------
// What each decision needs (PROPOSED; none of this is evidence yet)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Requirements by decision, sized to what a sample can show. Zero false positives among `n` legitimate supports bounds the true rate by 3/n
 * (95 %): 29 cases for ≤ 10 %, 59 for ≤ 5 %. The corpus of 27 (about 17 legitimate) bounds it only at ≈ 16 %: it is exploratory.
 *   pilot    `on` with the substitution in `dry_run`, in a controlled workspace, each confirmed finding reviewed by a person;
 *   default  v2 replaces v1 for every new adaptation (one call, no parallel reviewers).
 */
export const EVIDENCE = {
  pilot: { zeroFailureCases: casesForZeroFailures(0.1), minPositives: 10, labels: "single_reviewer_ai_assisted", criticalWithoutSecondHuman: "reported", criticalFlips: 0, deliverabilityChangesUnexplained: 0 },
  default: { zeroFailureCases: casesForZeroFailures(0.05), minPositives: 18, labels: "single_human", criticalWithoutSecondHuman: 0, criticalFlips: 0, deliverabilityChangesUnexplained: 0 },
  maxSchemaFailureRate: 0.02,
  maxUnjudgedRate: 0.05,
  /** Extra cost per valid delivered adaptation that v2 may add over the measured baseline. */
  maxExtraUsdPerDelivered: 0.01,
} as const;

export interface GateInput {
  score: CorpusScore;
  criticalFlips: readonly string[];
  deliverability: ReturnType<typeof deliverabilityChanges> | null;
  /** Cases of `became_unusable` / `became_usable` that a person already examined and explained. */
  explainedChanges: number;
  schemaFailureRate: number | null;
  extraUsdPerDelivered: number | null;
}

export function readyFor(stage: "pilot" | "default", input: GateInput): { ready: boolean; missing: string[] } {
  const need = EVIDENCE[stage];
  const { score } = input;
  const missing: string[] = [];
  const rank = (l: LabelLevel) => LABEL_LEVELS.indexOf(l);
  if (rank(score.labels) < rank(need.labels)) missing.push(need.labels === "single_human" ? "etiquetas definitivas de una persona (no solo asistida por IA)" : "etiquetas definitivas de una persona (asistida por IA como mucho un revisor)");
  if (score.legitimate_n < need.zeroFailureCases) missing.push(`al menos ${need.zeroFailureCases} apoyos legítimos etiquetados, todos sin falso positivo (hay ${score.legitimate_n})`);
  if (score.confirmed.false_positive > 0) missing.push(`un apoyo legítimo confirmado (${score.false_positive_ids.join(", ")}): hay que explicarlo antes de seguir`);
  if (score.positives_n < need.minPositives) missing.push(`al menos ${need.minPositives} apoyos que hacen la competencia (hay ${score.positives_n})`);
  if (score.false_negative_ids.length > 0) missing.push(`apoyos que hacen la competencia sin ni siquiera sospecha (${score.false_negative_ids.join(", ")}): examinar uno a uno`);
  if (stage === "default" && score.critical_without_second_human > 0) missing.push(`${score.critical_without_second_human} casos críticos o ambiguos sin segunda persona`);
  if (input.criticalFlips.length > need.criticalFlips) missing.push(`juicios que pasan de confirmado a legítimo entre repeticiones (${input.criticalFlips.join(", ")})`);
  if (input.deliverability === null) missing.push("comparación de entregabilidad con v1 sobre documentos reales");
  else if (input.deliverability.became_unusable.length + input.deliverability.became_usable.length > input.explainedChanges) missing.push("cambios de entregabilidad respecto a v1 sin examinar");
  if (input.schemaFailureRate === null || input.schemaFailureRate > EVIDENCE.maxSchemaFailureRate) missing.push(`fallos de esquema ≤ ${EVIDENCE.maxSchemaFailureRate * 100} %`);
  if (score.n > 0 && score.unjudged / score.n > EVIDENCE.maxUnjudgedRate) missing.push("apoyos sin juzgar por debajo del 5 %");
  if (input.extraUsdPerDelivered === null || input.extraUsdPerDelivered > EVIDENCE.maxExtraUsdPerDelivered) missing.push(`sobrecoste por adaptación entregada ≤ ${EVIDENCE.maxExtraUsdPerDelivered} $`);
  return { ready: missing.length === 0, missing };
}
