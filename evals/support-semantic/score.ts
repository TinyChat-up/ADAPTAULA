import type { SemanticStatus } from "@/lib/adaptation/support-semantic";
import type { CorpusEntry, CorpusLabel } from "./corpus";

/**
 * How the semantic review is measured BEFORE it is allowed to act (`REVIEWER_V2_MODE=on`). Pure: it scores a list of results against the
 * labels of the corpus; running the real reviewer (which costs money and needs a person's authorization) only produces the `results`.
 *
 * The reference label is the one a person wrote (`review.final_label`); until there is one, the provisional label is used and the report SAYS
 * it is provisional: nothing measured against AI-assisted labels is a measurement of the truth.
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

export interface CorpusScore {
  labels: "human" | "provisional";
  n: number;
  /** Entries a person has not labelled yet AND that are ambiguous: left out of the rates, counted here. */
  excluded: number;
  confirmed: { total: number; true_positive: number; false_positive: number; precision: number | null; precision_wilson_lower: number | null };
  /** Legitimate supports (access, criterion card, method example) confirmed: must be ZERO before anything acts. */
  false_positive_ids: string[];
  /** Legitimate supports merely suspected: not blocking, but noise in the record. */
  suspected_legitimate_ids: string[];
  /** Supports that perform the competence and were not even suspected. */
  false_negative_ids: string[];
  recall_confirmed: number | null;
  recall_at_least_suspected: number | null;
  unjudged: number;
}

export const referenceLabel = (e: CorpusEntry): CorpusLabel => e.review.final_label ?? e.provisional.label;

/** Lower bound of the 95 % Wilson interval: what a small sample really supports. */
export function wilsonLower(successes: number, n: number, z = 1.96): number | null {
  if (n === 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
}

export function scoreCorpus(entries: readonly CorpusEntry[], results: readonly ScoredResult[]): CorpusScore {
  const byId = new Map(results.map((r) => [r.id, r.status] as const));
  const human = entries.every((e) => e.review.final_label !== null);
  const rated = entries.filter((e) => referenceLabel(e) !== "ambiguous");
  const statusOf = (e: CorpusEntry): SemanticStatus => byId.get(e.id) ?? "unjudged";

  const confirmed = rated.filter((e) => statusOf(e) === "confirmed");
  const truePositive = confirmed.filter((e) => POSITIVE.has(referenceLabel(e))).length;
  const falsePositive = confirmed.filter((e) => LEGITIMATE.has(referenceLabel(e)));
  const positives = rated.filter((e) => POSITIVE.has(referenceLabel(e)));
  const suspectable = rated.filter((e) => SUSPECT.has(referenceLabel(e)));
  return {
    labels: human ? "human" : "provisional",
    n: rated.length,
    excluded: entries.length - rated.length,
    confirmed: { total: confirmed.length, true_positive: truePositive, false_positive: falsePositive.length, precision: confirmed.length ? truePositive / confirmed.length : null, precision_wilson_lower: wilsonLower(truePositive, confirmed.length) },
    false_positive_ids: falsePositive.map((e) => e.id),
    suspected_legitimate_ids: rated.filter((e) => LEGITIMATE.has(referenceLabel(e)) && statusOf(e) === "suspected").map((e) => e.id),
    false_negative_ids: suspectable.filter((e) => POSITIVE.has(referenceLabel(e)) && (statusOf(e) === "legitimate" || statusOf(e) === "unjudged")).map((e) => e.id),
    recall_confirmed: positives.length ? positives.filter((e) => statusOf(e) === "confirmed").length / positives.length : null,
    recall_at_least_suspected: suspectable.length ? suspectable.filter((e) => statusOf(e) === "confirmed" || statusOf(e) === "suspected").length / suspectable.length : null,
    unjudged: rated.filter((e) => statusOf(e) === "unjudged").length,
  };
}

/** Agreement between repeated runs of the SAME frozen corpus: the share of supports that got the same status every time. */
export function consistency(runs: ReadonlyArray<readonly ScoredResult[]>): number | null {
  if (runs.length < 2) return null;
  const ids = [...new Set(runs.flatMap((r) => r.map((x) => x.id)))];
  if (ids.length === 0) return null;
  const same = ids.filter((id) => new Set(runs.map((r) => r.find((x) => x.id === id)?.status ?? "unjudged")).size === 1).length;
  return same / ids.length;
}

/**
 * The conditions to move from `shadow` to `on`, all of them. They are PROPOSED for the person who owns the decision; none is evidence yet.
 * `labels` must be `human`: a measurement against provisional labels never authorizes anything.
 */
export const ACTIVATION_THRESHOLDS = {
  labels: "human",
  minUnitsJudged: 40,
  minTruePositives: 10,
  precisionWilsonLower: 0.85,
  falsePositivesOnLegitimate: 0,
  minConsistency: 0.9,
  maxSchemaFailureRate: 0.02,
  /** A judgment of the same support must not be missing: the share of supports left unjudged. */
  maxUnjudgedRate: 0.05,
} as const;

export function readyToActivate(score: CorpusScore, extra: { consistency: number | null; schemaFailureRate: number | null }): { ready: boolean; missing: string[] } {
  const t = ACTIVATION_THRESHOLDS;
  const missing: string[] = [];
  if (score.labels !== t.labels) missing.push("etiquetas definitivas de una persona con criterio pedagógico y de PT");
  if (score.n < t.minUnitsJudged) missing.push(`al menos ${t.minUnitsJudged} apoyos etiquetados (hay ${score.n})`);
  if (score.confirmed.true_positive < t.minTruePositives) missing.push(`al menos ${t.minTruePositives} verdaderos positivos (hay ${score.confirmed.true_positive})`);
  if ((score.confirmed.precision_wilson_lower ?? 0) < t.precisionWilsonLower) missing.push(`precisión de lo confirmado ≥ ${t.precisionWilsonLower} (límite inferior de Wilson)`);
  if (score.confirmed.false_positive > t.falsePositivesOnLegitimate) missing.push("cero confirmados sobre apoyos legítimos");
  if ((extra.consistency ?? 0) < t.minConsistency) missing.push(`concordancia entre repeticiones ≥ ${t.minConsistency}`);
  if (extra.schemaFailureRate === null || extra.schemaFailureRate > t.maxSchemaFailureRate) missing.push(`fallos de esquema ≤ ${t.maxSchemaFailureRate * 100} %`);
  if (score.n > 0 && score.unjudged / score.n > t.maxUnjudgedRate) missing.push("apoyos sin juzgar por debajo del 5 %");
  return { ready: missing.length === 0, missing };
}
