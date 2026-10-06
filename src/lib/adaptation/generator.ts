import { estimateCostUsd } from "@/lib/ai/costs";
import { AIError, toAIError } from "@/lib/ai/errors";
import { ACTIVE_ADAPTATION_PROMPT_VERSIONS, getMaterialGenerator } from "@/lib/ai/prompts";
import { parseStructured } from "@/lib/ai/structured";
import type { AIProvider, ModelSelection, StructuredResponse } from "@/lib/ai/types";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { DraftGeneratedSegmentsSchema, type DraftGeneratedSegments } from "@/lib/schemas/ai-contracts";
import { DraftGeneratedSegmentsV2Schema, type DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { decisionsToGenerate, normalizeGenerated, type NormalizedGeneration } from "./generated";
import { authorizedKinds, decisionsToGenerateV2, normalizeGeneratedV2 } from "./generated-v2";
import { instructionNeedsRewrite, instructionWords, supportBudgetWords } from "./proportion";
import { appliedDecisions, type ReviewedPlan } from "./plan-review";
import { statedAnswer } from "@/lib/analysis/answers";
import type { MaterialGenerator, StageRunRecord } from "./services";

/**
 * The real generator: one model call that turns the APPROVED decisions into the fragments they change or add (never the whole
 * sheet). It sees only the effective decisions, the original content of their targets and the protected elements they must
 * keep: not the rest of the material, not the rejected decisions, not the profile, not the inferred answers.
 */

export interface GeneratorPromptInput {
  approved: {
    language: string;
    audience: AdaptationContext["audience"];
    stage: AdaptationContext["education"]["stage"];
    max_instruction_words: number | null;
    decisions: Array<{
      id: string;
      target: string;
      action: string;
      strategies: string[];
      dimensions: string[];
      intensity: string;
      supports: Array<{ kind: string; uses_task_data: boolean }>;
      response_target: string | null;
      restrictions: string[];
      guidance: string | null;
    }>;
  };
  material: Array<{ decision_id: string; source: unknown; preserves: Array<{ id: string; type: string; importance: string; value: string }> }>;
}

function sourceOf(analysis: MaterialAnalysis, target: string): unknown {
  const activity = analysis.activities.find((a) => a.id === target);
  if (activity) {
    return {
      id: activity.id,
      kind: "activity",
      label: activity.label,
      type: activity.type,
      instruction: activity.instruction,
      context: activity.context,
      response_format: activity.response_format,
      answer_area: activity.answer_area,
      resources: activity.resource_ids,
      // Only an answer the sheet itself states; an inferred one never leaves the server towards a generating model.
      stated_answer: statedAnswer(activity),
    };
  }
  const text = analysis.texts.find((t) => t.id === target);
  if (text) return { id: text.id, kind: "text", text_kind: text.kind, text: text.text };
  const visual = analysis.visuals.find((v) => v.id === target);
  if (visual) return { id: visual.id, kind: "visual", visual_kind: visual.kind, role: visual.role, title: visual.title };
  return {
    kind: "document",
    outline: {
      activities: analysis.activities.map((a) => ({ id: a.id, label: a.label, type: a.type, resources: a.resource_ids })),
      visuals: analysis.visuals.filter((v) => v.role !== "decorative").map((v) => ({ id: v.id, kind: v.kind, title: v.title })),
    },
  };
}

/** What the generator receives, built from the effective plan only. Exposed so the evals and tests inspect it. */
export function buildGeneratorInput(reviewed: ReviewedPlan, analysis: MaterialAnalysis, context: AdaptationContext): GeneratorPromptInput {
  const writing = new Set(decisionsToGenerate(reviewed.effective.decisions, analysis).map((d) => d.id));
  const applied = appliedDecisions(reviewed).filter((rd) => writing.has(rd.id));
  return {
    approved: {
      language: context.education.language,
      audience: context.audience,
      stage: context.education.stage,
      max_instruction_words: context.limits.max_instruction_words,
      decisions: applied.map((rd) => {
        const d = rd.effective!;
        return {
          id: d.id,
          target: d.target,
          action: d.action,
          strategies: d.strategies,
          dimensions: d.dimensions,
          intensity: d.intensity,
          supports: d.supports,
          response_target: d.response_target ?? null,
          restrictions: rd.restrictions,
          guidance: d.note ?? null,
        };
      }),
    },
    material: applied.map((rd) => {
      const d = rd.effective!;
      return {
        decision_id: d.id,
        source: sourceOf(analysis, d.target),
        preserves: d.preserves.flatMap((id) => {
          const p = analysis.protected_elements.find((x) => x.id === id);
          return p ? [{ id: p.id, type: p.type, importance: p.importance, value: p.value }] : [];
        }),
      };
    }),
  };
}

/** v2 input: no strategies, dimensions or answer areas (the generator does not need them); the policy and budget come from the server. */
export interface GeneratorPromptInputV2 {
  approved: {
    language: string;
    audience: AdaptationContext["audience"];
    stage: AdaptationContext["education"]["stage"];
    decisions: Array<{
      id: string;
      target: string;
      action: string;
      intensity: string;
      supports: string[];
      response_target: string | null;
      restrictions: string[];
      guidance: string | null;
      instruction_policy: "keep" | "rewrite" | null;
      original_words: number | null;
      support_budget_words: number;
    }>;
  };
  material: Array<{ decision_id: string; source: unknown; preserves: Array<{ id: string; type: string; importance: string; value: string }> }>;
}

export function buildGeneratorInputV2(reviewed: ReviewedPlan, analysis: MaterialAnalysis, context: AdaptationContext): GeneratorPromptInputV2 {
  const writing = new Set(decisionsToGenerateV2(reviewed.effective.decisions, analysis, context).map((d) => d.id));
  const applied = appliedDecisions(reviewed).filter((rd) => writing.has(rd.id));
  const activityOf = (target: string) => analysis.activities.find((a) => a.id === target);
  return {
    approved: {
      language: context.education.language,
      audience: context.audience,
      stage: context.education.stage,
      decisions: applied.map((rd) => {
        const d = rd.effective!;
        const activity = activityOf(d.target);
        return {
          id: d.id,
          target: d.target,
          action: d.action,
          intensity: d.intensity,
          supports: [...authorizedKinds(d)],
          response_target: d.response_target ?? null,
          restrictions: rd.restrictions,
          guidance: d.note ?? null,
          instruction_policy: activity ? (instructionNeedsRewrite(activity, context.limits.max_instruction_words) ? "rewrite" : "keep") : null,
          original_words: activity ? instructionWords(activity) : null,
          support_budget_words: supportBudgetWords(activity),
        };
      }),
    },
    material: applied.map((rd) => {
      const d = rd.effective!;
      const activity = activityOf(d.target);
      return {
        decision_id: d.id,
        source: activity
          ? { id: activity.id, kind: "activity", label: activity.label, instruction: activity.instruction, context: activity.context }
          : { kind: "document", outline: { activities: analysis.activities.map((a) => ({ id: a.id, label: a.label, type: a.type })) } },
        preserves: d.preserves.flatMap((id) => {
          const p = analysis.protected_elements.find((x) => x.id === id);
          return p ? [{ id: p.id, type: p.type, importance: p.importance, value: p.value }] : [];
        }),
      };
    }),
  };
}

export interface GeneratorCallParams {
  analysis: MaterialAnalysis;
  context: AdaptationContext;
  reviewed: ReviewedPlan;
  selection: ModelSelection;
  provider: AIProvider;
  maxOutputTokens: number;
  /** Prompt + contract version. Defaults to the active one (v1 until v2 is validated). */
  version?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const GENERATOR_TIMEOUT_MS = 150_000;

/** The messages of a generator request, for the version asked for. Exposed so the evals and tests inspect exactly what a model would receive. */
export function generatorRequestParts(params: Pick<GeneratorCallParams, "analysis" | "context" | "reviewed" | "version">) {
  const version = params.version ?? ACTIVE_ADAPTATION_PROMPT_VERSIONS.material_generator;
  if (version === 2) {
    const prompt = getMaterialGenerator(2);
    const input = buildGeneratorInputV2(params.reviewed, params.analysis, params.context);
    return { prompt, input, parts: (prompt as typeof import("@prompts/material-generator/v2").MATERIAL_GENERATOR_V2).buildUserParts(input) };
  }
  const prompt = getMaterialGenerator(1);
  const input = buildGeneratorInput(params.reviewed, params.analysis, params.context);
  return { prompt, input, parts: (prompt as typeof import("@prompts/material-generator/v1").MATERIAL_GENERATOR_V1).buildUserParts(input) };
}

export interface GeneratorCall {
  response: StructuredResponse;
  run: StageRunRecord;
}

/** One model call. Provider errors are thrown (categorised); everything else is returned for the caller to judge. */
export async function callGenerator(params: GeneratorCallParams): Promise<GeneratorCall> {
  const { prompt, parts } = generatorRequestParts(params);
  const started = Date.now();
  let response: StructuredResponse;
  try {
    response = await params.provider.generateStructured({
      selection: params.selection,
      system: prompt.system,
      messages: [{ role: "user", content: parts }],
      output: prompt.output,
      maxOutputTokens: params.maxOutputTokens,
      timeoutMs: params.timeoutMs ?? GENERATOR_TIMEOUT_MS,
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (error) {
    throw toAIError(error);
  }
  const run: StageRunRecord = {
    purpose: "generate",
    attempt: 1,
    alias: params.selection.alias,
    provider: params.selection.provider,
    model: response.model,
    effort: params.selection.effort,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cachedInputTokens: response.usage.cachedInputTokens,
    cacheCreationInputTokens: response.usage.cacheCreationInputTokens,
    estimatedCostUsd: estimateCostUsd(params.selection.provider, response.model, response.usage),
    latencyMs: response.latencyMs || Date.now() - started,
    status: response.stopReason === "refusal" ? "refused" : "success",
    errorCode: response.stopReason === "refusal" ? "refusal" : null,
    schemaKey: prompt.output.name,
    schemaVersion: prompt.schemaVersion,
    callKind: "initial",
    reasoningTokens: null,
  };
  return { response, run };
}

export type GeneratorDraft = DraftGeneratedSegments | DraftGeneratedSegmentsV2;
export type GeneratorParse = { outcome: "ok"; draft: GeneratorDraft } | { outcome: "truncated" | "refused" | "not_json" | "schema"; issues: string[] };

export function parseGeneratorResponse(response: StructuredResponse, version: number = 1): GeneratorParse {
  if (response.stopReason === "refusal") return { outcome: "refused", issues: ["El modelo rechazó la petición."] };
  if (response.stopReason === "max_tokens") return { outcome: "truncated", issues: ["La salida alcanzó el límite de tokens."] };
  const parsed = version === 2 ? parseStructured(response.text, DraftGeneratedSegmentsV2Schema) : parseStructured(response.text, DraftGeneratedSegmentsSchema);
  return parsed.ok ? { outcome: "ok", draft: parsed.data } : { outcome: parsed.kind, issues: parsed.issues };
}

/** Draft → `GeneratedSegments` with the normaliser of the draft's version: a v1 draft is never read with v2's rules, or the other way round. */
export function normalizeGeneration(version: number, draft: unknown, reviewed: ReviewedPlan, analysis: MaterialAnalysis, context: Pick<AdaptationContext, "limits">): NormalizedGeneration {
  return version === 2
    ? normalizeGeneratedV2(DraftGeneratedSegmentsV2Schema.parse(draft), reviewed, analysis, context)
    : normalizeGenerated(DraftGeneratedSegmentsSchema.parse(draft), reviewed, analysis);
}

/** `MaterialGenerator` backed by a real model, for the pipeline. A rejected answer throws; there is no repair here. */
export function createModelGenerator(deps: { selection: ModelSelection; provider: AIProvider; maxOutputTokens: number; version?: number }): MaterialGenerator {
  return {
    generate: async ({ context, analysis, reviewed }) => {
      const { response, run } = await callGenerator({ ...deps, analysis, context, reviewed });
      const parsed = parseGeneratorResponse(response, deps.version ?? 1);
      if (parsed.outcome !== "ok") {
        throw new AIError(parsed.outcome === "refused" ? "refusal" : parsed.outcome === "truncated" ? "truncated" : "invalid_output", `generator output rejected: ${parsed.outcome}`);
      }
      return { draft: parsed.draft, runs: [run] };
    },
  };
}
