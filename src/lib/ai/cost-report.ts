/**
 * The pilot's cost report (ADR-046), from the rows of `ai_cost_report` (migration 035): one row per recorded AI call. Pure, for the
 * export script and its tests. Costs are the recorded estimates (real tokens × the price table); a call whose price is unknown is
 * counted apart and makes its totals a lower bound (`incomplete`), never a 0. The material's analysis is shared by every adaptation
 * of it: it is reported per material, never added to an adaptation. Nothing here identifies a learner (a profile is only its id).
 */
export const COST_PHASES = ["analysis", "planning", "generation", "review", "visual_supports", "images"] as const;
export type CostPhase = (typeof COST_PHASES)[number];

export interface CostRow {
  created_at: string;
  workspace_id: string | null;
  material_id: string | null;
  material_title: string | null;
  adaptation_id: string | null;
  learner_profile_id: string | null;
  planner_version: number | null;
  rules_package: string | null;
  phase: CostPhase;
  purpose: string;
  call_kind: string | null;
  attempt: number | null;
  job_attempt: number | null;
  status: string;
  error_code: string | null;
  provider: string;
  model: string;
  model_alias: string;
  prompt_key: string | null;
  prompt_version: number | null;
  effort: string | null;
  input_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  estimated_cost_usd: number | string | null;
  latency_ms: number | null;
  rules_sha256: string | null;
}

export interface PhaseLine {
  calls: number;
  failed: number;
  repairs: number;
  unknownCost: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  usd: number;
  models: string[];
}

export interface AdaptationCost {
  adaptationId: string;
  materialId: string | null;
  materialTitle: string | null;
  learnerProfileId: string | null;
  plannerVersion: number | null;
  rulesPackage: string | null;
  phases: Record<Exclude<CostPhase, "analysis">, PhaseLine>;
  usd: number;
  incomplete: boolean;
}

export interface CostReport {
  adaptations: AdaptationCost[];
  materials: Array<{ materialId: string; materialTitle: string | null; analysis: PhaseLine }>;
  totals: Record<CostPhase, PhaseLine>;
  usd: number;
  incomplete: boolean;
}

const line = (): PhaseLine => ({ calls: 0, failed: 0, repairs: 0, unknownCost: 0, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, usd: 0, models: [] });
const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
const costOf = (r: CostRow): number | null => (r.estimated_cost_usd === null ? null : Number(r.estimated_cost_usd));

function add(target: PhaseLine, r: CostRow) {
  target.calls += 1;
  if (r.status !== "success") target.failed += 1;
  if (r.call_kind === "repair" || r.call_kind === "regeneration") target.repairs += 1;
  target.inputTokens += r.input_tokens;
  target.cacheWriteTokens += r.cache_creation_input_tokens;
  target.cacheReadTokens += r.cached_input_tokens;
  target.outputTokens += r.output_tokens;
  const usd = costOf(r);
  if (usd === null || Number.isNaN(usd)) target.unknownCost += 1;
  else target.usd = round(target.usd + usd);
  const model = `${r.provider}:${r.model}`;
  if (!target.models.includes(model)) target.models.push(model);
}

export function summarizeCost(rows: readonly CostRow[]): CostReport {
  const totals = Object.fromEntries(COST_PHASES.map((p) => [p, line()])) as Record<CostPhase, PhaseLine>;
  const adaptations = new Map<string, AdaptationCost>();
  const materials = new Map<string, { materialId: string; materialTitle: string | null; analysis: PhaseLine }>();
  for (const r of rows) {
    add(totals[r.phase], r);
    if (r.phase === "analysis" || !r.adaptation_id) {
      if (r.material_id) {
        const m = materials.get(r.material_id) ?? { materialId: r.material_id, materialTitle: r.material_title, analysis: line() };
        add(m.analysis, r);
        materials.set(r.material_id, m);
      }
      continue;
    }
    const a =
      adaptations.get(r.adaptation_id) ??
      ({
        adaptationId: r.adaptation_id,
        materialId: r.material_id,
        materialTitle: r.material_title,
        learnerProfileId: r.learner_profile_id,
        plannerVersion: r.planner_version,
        rulesPackage: r.rules_package,
        phases: { planning: line(), generation: line(), review: line(), visual_supports: line(), images: line() },
        usd: 0,
        incomplete: false,
      } satisfies AdaptationCost);
    add(a.phases[r.phase as Exclude<CostPhase, "analysis">], r);
    adaptations.set(r.adaptation_id, a);
  }
  for (const a of adaptations.values()) {
    const phases = Object.values(a.phases);
    a.usd = round(phases.reduce((t, p) => t + p.usd, 0));
    a.incomplete = phases.some((p) => p.unknownCost > 0);
  }
  const all = Object.values(totals);
  return { adaptations: [...adaptations.values()], materials: [...materials.values()], totals, usd: round(all.reduce((t, p) => t + p.usd, 0)), incomplete: all.some((p) => p.unknownCost > 0) };
}

const CSV_COLUMNS: ReadonlyArray<keyof CostRow> = [
  "created_at", "workspace_id", "material_id", "material_title", "adaptation_id", "learner_profile_id", "planner_version", "rules_package", "phase", "purpose", "call_kind", "attempt", "job_attempt", "status", "error_code", "provider", "model", "model_alias", "prompt_key", "prompt_version", "effort", "input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_tokens", "estimated_cost_usd", "latency_ms", "rules_sha256",
];

/** RFC 4180; a value that starts like a formula is prefixed so a spreadsheet never evaluates it. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function costRowsCsv(rows: readonly CostRow[]): string {
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}
