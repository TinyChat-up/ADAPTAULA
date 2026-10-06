import type { AIRunRecord } from "@/lib/ai/types";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { Check } from "./score";

/**
 * Everything the benchmark records about one run (one file × one provider/model/prompt/schema), in a shape that two
 * providers can be compared on: same file, same prompt, same schema, same expectations; only `run` differs.
 */
export interface RunDescriptor {
  provider: string;
  /** The model that actually answered (as reported by the provider), not just the configured one. */
  model: string;
  alias: string;
  effort: string;
  prompt: string;
  schemaVersion: number;
  startedAt: string;
  /** Free text, e.g. "baseline", "openai-comparison". */
  label: string | null;
}

/** `input` is only the uncached input; the whole input is input + cached (reads) + cacheWrite (creation, billed at 1.25×). */
export interface Tokens {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
}

/** What a reviewer needs to judge the understanding without opening the model's raw JSON. Never holds more than short excerpts. */
export interface AnalysisDigest {
  title: string | null;
  identification: Record<"stage" | "grade" | "subject" | "topic", { value: string | null; confidence: number }>;
  purpose: string;
  objectives: string[];
  counts: MaterialAnalysis["structure"]["counts"];
  activities: Array<{ label: string | null; page: number; type: string; instruction: string; answerBasis: string; answerArea: string; resources: number; confidence: number }>;
  protectedElements: Array<{ type: string; importance: string; value: string }>;
  /** How the protected elements are spread over the importance levels: `essential` is only useful if it does not cover almost everything. */
  protectedImportance: { essential: number; important: number; optional: number };
  visuals: Array<{ kind: string; role: string; title: string | null; description: string; data: string | null }>;
  administrativeFields: string[];
  uncertainties: Array<{ kind: string; note: string; confidence: number }>;
  quality: MaterialAnalysis["quality"];
}

const excerpt = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function digestAnalysis(a: MaterialAnalysis): AnalysisDigest {
  const id = a.identification;
  return {
    title: id.title,
    identification: {
      stage: { value: id.stage.value, confidence: id.stage.confidence },
      grade: { value: id.grade.value, confidence: id.grade.confidence },
      subject: { value: id.subject.value, confidence: id.subject.confidence },
      topic: { value: id.topic.value, confidence: id.topic.confidence },
    },
    purpose: excerpt(a.pedagogical_intent.purpose, 300),
    objectives: a.pedagogical_intent.objectives.map((o) => excerpt(o.text, 160)),
    counts: a.structure.counts,
    activities: a.activities.map((x) => ({
      label: x.label,
      page: x.page,
      type: x.type,
      instruction: excerpt(x.instruction),
      answerBasis: x.expected_answer.basis,
      answerArea: x.answer_area.type,
      resources: x.resource_ids.length,
      confidence: x.confidence,
    })),
    protectedElements: a.protected_elements.map((p) => ({ type: p.type, importance: p.importance, value: excerpt(p.value, 160) })),
    protectedImportance: {
      essential: a.protected_elements.filter((p) => p.importance === "essential").length,
      important: a.protected_elements.filter((p) => p.importance === "important").length,
      optional: a.protected_elements.filter((p) => p.importance === "optional").length,
    },
    visuals: a.visuals.map((v) => ({
      kind: v.kind,
      role: v.role,
      title: v.title,
      description: excerpt(v.description, 160),
      data: v.table ? `tabla ${v.table.rows.length}×${v.table.headers.length}` : v.chart ? `gráfico ${v.chart.categories.length} categorías × ${v.chart.series.length} serie(s)` : null,
    })),
    administrativeFields: a.administrative_fields.map((f) => f.type),
    uncertainties: a.uncertainties.map((u) => ({ kind: u.kind, note: excerpt(u.note, 160), confidence: u.confidence })),
    quality: a.quality,
  };
}

export function sumTokens(runs: readonly AIRunRecord[]): Tokens {
  return runs.reduce(
    (t, r) => ({ input: t.input + r.inputTokens, output: t.output + r.outputTokens, cached: t.cached + r.cachedInputTokens, cacheWrite: t.cacheWrite + r.cacheCreationInputTokens }),
    { input: 0, output: 0, cached: 0, cacheWrite: 0 },
  );
}

export interface CaseReport {
  id: string;
  title: string;
  stage: string | null;
  subject: string | null;
  /** The analysis was delivered (valid, normalized). `failure` is set otherwise. */
  delivered: boolean;
  failure: string | null;
  /** Automatic checks passed with no hard failure. Null when there were no expectations (private files). */
  passed: boolean | null;
  /** 0..1, null without expectations. */
  score: number | null;
  hardFailures: number;
  softFailures: number;
  hallucinations: number;
  failedChecks: Array<Pick<Check, "name" | "severity" | "detail">>;
  tokens: Tokens;
  costUsd: number | null;
  /** Sum of the model calls' latency. */
  latencyMs: number;
  calls: number;
  /** One entry per model call: what each attempt returned and, for a rejected answer, which schema paths failed (no values). */
  attempts: Array<{ attempt: number; status: string; errorCode: string | null; issues: string[]; outputTokens: number }>;
  warnings: string[];
  digest: AnalysisDigest | null;
}

export interface Aggregate {
  cases: number;
  delivered: number;
  /** Cases the automatic checks could judge. */
  evaluated: number;
  avgScore: number | null;
  avgCostUsd: number | null;
  avgLatencyMs: number | null;
  totalCostUsd: number | null;
  /** Technical failures + cases with a hard-check failure. */
  seriousErrors: number;
  hardFailures: number;
  /** Cases where the model invented an answer or obeyed an embedded instruction, over evaluated cases. */
  hallucinationRate: number | null;
  failurePatterns: Array<{ check: string; cases: number }>;
}

const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

export function aggregate(reports: readonly CaseReport[]): Aggregate {
  const delivered = reports.filter((r) => r.delivered);
  const evaluated = delivered.filter((r) => r.score !== null);
  const knownCosts = reports.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const patterns = new Map<string, number>();
  for (const report of reports) for (const check of new Set(report.failedChecks.map((c) => c.name))) patterns.set(check, (patterns.get(check) ?? 0) + 1);
  return {
    cases: reports.length,
    delivered: delivered.length,
    evaluated: evaluated.length,
    avgScore: mean(evaluated.map((r) => r.score as number)),
    // An unknown price must not look cheap: with any unpriced case there is no average (nor total).
    avgCostUsd: knownCosts.length === reports.length ? mean(knownCosts) : null,
    avgLatencyMs: mean(reports.filter((r) => r.calls > 0).map((r) => r.latencyMs)),
    totalCostUsd: knownCosts.length === reports.length ? knownCosts.reduce((a, b) => a + b, 0) : null,
    seriousErrors: reports.filter((r) => !r.delivered || r.hardFailures > 0).length,
    hardFailures: reports.reduce((n, r) => n + r.hardFailures, 0),
    hallucinationRate: evaluated.length === 0 ? null : evaluated.filter((r) => r.hallucinations > 0).length / evaluated.length,
    failurePatterns: [...patterns.entries()].map(([check, cases]) => ({ check, cases })).sort((a, b) => b.cases - a.cases || a.check.localeCompare(b.check)),
  };
}

export const PROJECTION_VOLUMES = [100, 1_000, 10_000] as const;

/** Linear extrapolation of the observed average cost. A small sample says little: callers must label it as such. */
export function projectCosts(avgCostUsd: number | null): Array<{ analyses: number; costUsd: number | null }> {
  return PROJECTION_VOLUMES.map((analyses) => ({ analyses, costUsd: avgCostUsd === null ? null : Math.round(avgCostUsd * analyses * 100) / 100 }));
}

export const usd = (value: number | null, digits = 4) => (value === null ? "desconocido" : `$${value.toFixed(digits)}`);
export const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);
export const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)} %`);
