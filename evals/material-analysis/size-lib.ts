import { schemaInstructions } from "@/lib/ai/providers/anthropic";
import { estimateCostUsd } from "@/lib/ai/costs";
import type { AnalyzerDefinition } from "@/lib/ai/prompts";
import type { MaterialAnalysis, MaterialAnalysisDraftInput } from "@/lib/schemas/material-analysis";
import type { MaterialAnalysisV2 } from "@/lib/schemas/material-analysis-v2";

/**
 * Size and cost estimation WITHOUT calling any API. Tokens are estimated from characters with a reproducible ratio
 * (`CHARS_PER_TOKEN`, see `calibrateCharsPerToken`): it is an estimate for comparing two contracts, never a bill.
 */
export const DEFAULT_CHARS_PER_TOKEN = 3.5;

export interface Size {
  chars: number;
  tokens: number;
}

/** Compact JSON, as a model would emit it (no pretty-printing). */
export const sizeOf = (value: unknown, charsPerToken = DEFAULT_CHARS_PER_TOKEN): Size => {
  const chars = JSON.stringify(value).length;
  return { chars, tokens: Math.round(chars / charsPerToken) };
};

export const reduction = (before: number, after: number) => (before === 0 ? 0 : 1 - after / before);

const local = (id: string) => id.replace(/^obj_/, "o").replace(/^sec_/, "s").replace(/^ctt_/, "c").replace(/^act_/, "a").replace(/^vis_/, "v").replace(/^prt_/, "p").replace(/^unc_/, "u");

/** What `material_analyzer@v1` had to emit for a stored v2 analysis (the model-facing draft, local ids and sentinels). */
export function projectDraftV2(a: MaterialAnalysisV2): unknown {
  const i = a.identification;
  const detected = (d: { value: string | null; confidence: number }, fallback = "") => ({ value: d.value ?? fallback, confidence: d.confidence });
  return {
    identification: {
      title: detected(i.title),
      stage: detected(i.stage, "unknown"),
      grade: detected(i.grade, "unknown"),
      subject: { value: i.subject.value ?? "", confidence: i.subject.confidence },
      topic: detected(i.topic),
      language: detected(i.language),
    },
    pedagogical_intent: {
      ...a.pedagogical_intent,
      learning_objectives: a.pedagogical_intent.learning_objectives.map((o) => ({ ...o, id: local(o.id) })),
    },
    sections: a.sections.map((s) => ({ id: local(s.id), title: s.title ?? "", page_start: s.page_start, page_end: s.page_end, summary: s.summary })),
    contents: a.contents.map((c) => ({
      id: local(c.id), section_id: c.section_id ? local(c.section_id) : "", page: c.page, kind: c.kind, text: c.text,
      table_headers: c.table?.headers ?? [], table_rows: c.table?.rows ?? [], legible: c.legible,
    })),
    activities: a.activities.map((x) => ({
      id: local(x.id), section_id: x.section_id ? local(x.section_id) : "", page: x.page, label: x.label ?? "", type: x.type, instruction: x.instruction, content: x.content,
      response_format: x.response_format, has_answer_space: x.has_answer_space,
      expected_answer: { value: x.expected_answer.value ?? "", basis: x.expected_answer.basis, confidence: x.expected_answer.confidence },
      difficulty: x.difficulty, knowledge_required: x.knowledge_required, objective_ids: x.objective_ids.map(local), visual_ids: x.visual_ids.map(local), confidence: x.confidence,
    })),
    visual_elements: a.visual_elements.map((v) => ({
      id: local(v.id), page: v.page, kind: v.kind, description: v.description, pedagogical_function: v.pedagogical_function, necessary_to_solve: v.necessary_to_solve,
      activity_ids: v.activity_ids.map(local), text_in_image: v.text_in_image ?? "", confidence: v.confidence,
    })),
    protected_elements: a.protected_elements.map((p) => ({
      id: local(p.id), kind: p.kind, description: p.description, rationale: p.rationale, activity_ids: p.activity_ids.map(local), visual_ids: p.visual_ids.map(local), importance: p.importance,
    })),
    uncertainties: a.uncertainties.map((u) => ({ id: local(u.id), kind: u.kind, page: u.page ?? 0, description: u.description, activity_ids: u.activity_ids.map(local), confidence: u.confidence })),
    quality: a.quality,
  };
}

/**
 * What `material_analyzer@v2` has to emit for a v3 analysis: only the model's side of every relation, local ids, nothing the
 * server derives and nothing at its default. It is the INFORMATION the model must produce, not a prediction of any model's output.
 */
export function projectDraftV3(a: MaterialAnalysis): MaterialAnalysisDraftInput {
  const i = a.identification;
  const manySections = a.sections.length > 1;
  const section = (id: string | null) => (manySections && id ? { section: local(id) } : {});
  const omitEmpty = <K extends string>(key: K, list: readonly string[]) => (list.length > 0 ? ({ [key]: list.map(local) } as Record<K, string[]>) : ({} as Record<K, string[]>));
  return {
    identification: {
      title: i.title ?? "", language: i.language ?? "", stage: i.stage.value ?? "unknown", grade: i.grade.value ?? "unknown", subject: i.subject.value ?? "", topic: i.topic.value ?? "",
      confidence: { stage: i.stage.confidence, grade: i.grade.confidence, subject: i.subject.confidence, topic: i.topic.confidence },
    },
    intent: {
      purpose: a.pedagogical_intent.purpose,
      objectives: a.pedagogical_intent.objectives.map((o) => ({ id: local(o.id), text: o.text })),
      knowledge: a.pedagogical_intent.knowledge,
      prerequisites: a.pedagogical_intent.prerequisites,
      difficulty: a.pedagogical_intent.difficulty,
    },
    sections: a.sections.map((s) => ({ id: local(s.id), title: s.title ?? "", page_start: s.page_start, page_end: s.page_end })),
    texts: a.texts.map((t) => ({ id: local(t.id), kind: t.kind, page: t.page, text: t.text, ...section(t.section_id) })),
    visuals: a.visuals.map((v) => ({
      id: local(v.id), kind: v.kind, page: v.page, role: v.role,
      ...(v.title ? { title: v.title } : {}),
      description: v.description,
      ...(v.text ? { text: v.text } : {}),
      ...(v.table ? { table: { headers: v.table.headers, rows: v.table.rows, ...(v.table.unit ? { unit: v.table.unit } : {}) } } : {}),
      ...(v.chart ? { chart: { type: v.chart.type, categories: v.chart.categories, series: v.chart.series, ...(v.chart.x_label ? { x_label: v.chart.x_label } : {}), ...(v.chart.y_label ? { y_label: v.chart.y_label } : {}), ...(v.chart.unit ? { unit: v.chart.unit } : {}) } } : {}),
      ...section(v.section_id),
    })),
    admin: a.administrative_fields,
    activities: a.activities.map((x) => ({
      id: local(x.id), label: x.label ?? "", page: x.page, ...section(x.section_id), type: x.type, instruction: x.instruction,
      ...(x.context ? { context: x.context } : {}),
      ...omitEmpty("resources", x.resource_ids),
      ...omitEmpty("objectives", x.objective_ids),
      response: x.response_format, answer_area: x.answer_area.type,
      ...(x.answer_area.lines ? { answer_lines: x.answer_area.lines } : {}),
      ...(x.expected_answer.basis !== "not_inferable" ? { answer: { basis: x.expected_answer.basis as "source" | "inferred", value: x.expected_answer.value! } } : {}),
      difficulty: x.difficulty, confidence: x.confidence,
    })),
    protected: a.protected_elements.map((p) => ({ type: p.type, importance: p.importance, value: p.value, ...omitEmpty("activities", p.activity_ids), ...omitEmpty("resources", p.resource_ids) })),
    uncertainties: a.uncertainties
      .filter((u) => u.kind !== "answer_not_inferable")
      .map((u) => ({ kind: u.kind as Exclude<typeof u.kind, "answer_not_inferable">, ...omitEmpty("targets", u.target_ids), note: u.note, confidence: u.confidence })),
    quality: a.quality,
  } as MaterialAnalysisDraftInput;
}

/** Size of what the provider must be told for a prompt version in prompted mode: the system prompt plus the schema block. */
export function schemaBlockChars(analyzer: AnalyzerDefinition): { system: number; schema: number; total: number } {
  const system = analyzer.system.length;
  const schema = schemaInstructions(analyzer.output.schema).length;
  return { system, schema, total: system + schema };
}

/** Characters per token implied by a real run: the cached block of v1 measured 6.345 tokens for `schemaBlockChars(v1)` characters. */
export function calibrateCharsPerToken(blockChars: number, blockTokens: number): number {
  return blockChars / blockTokens;
}

export interface RunUsage {
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export const costOf = (run: RunUsage): number | null =>
  estimateCostUsd("anthropic", run.model, { inputTokens: run.input, cachedInputTokens: run.cacheRead, cacheCreationInputTokens: run.cacheWrite, outputTokens: run.output });

export interface CostEstimate {
  /** The real run, recomputed from its tokens. */
  current: number | null;
  /** Output JSON tokens estimated for v2 (the rest of `output` is reasoning, assumed unchanged). */
  jsonTokensV2: number;
  reasoningTokens: number;
  /** v3: smaller output only; input, cache writes and model unchanged (the assumption asked for). */
  outputOnly: number | null;
  /** v3: smaller output AND a smaller schema block (fewer cache-write tokens). */
  outputAndBlock: number | null;
}

/**
 * THEORETICAL cost of the same run with the v3 contract. The model's reasoning tokens are kept constant (it is not known how they
 * would change); only the JSON it emits shrinks by `outputReduction`, and optionally the cached schema block by `blockReduction`.
 */
export function estimateOptimizedCost(run: RunUsage, jsonTokensV2: number, outputReduction: number, blockReduction: number): CostEstimate {
  const json = Math.min(jsonTokensV2, run.output);
  const reasoning = run.output - json;
  const output = Math.round(reasoning + json * (1 - outputReduction));
  return {
    current: costOf(run),
    jsonTokensV2: json,
    reasoningTokens: reasoning,
    outputOnly: costOf({ ...run, output }),
    outputAndBlock: costOf({ ...run, output, cacheWrite: Math.round(run.cacheWrite * (1 - blockReduction)) }),
  };
}
