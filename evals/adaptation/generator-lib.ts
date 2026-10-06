import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ADAPTATION_PLANNER_V1 } from "@prompts/adaptation-planner/v1";
import { ADAPTATION_PLANNER_V2 } from "@prompts/adaptation-planner/v2";
import { z } from "zod";
import { fingerprint, stableStringify } from "@/lib/adaptation/fingerprint";
import { buildGeneratorInput, buildGeneratorInputV2, generatorRequestParts } from "@/lib/adaptation/generator";
import type { ReviewedPlan } from "@/lib/adaptation/plan-review";
import { answersOf } from "@/lib/adaptation/facts";
import { estimateCostUsd } from "@/lib/ai/costs";
import { schemaInstructions } from "@/lib/ai/providers/anthropic";
import type { ModelSelection } from "@/lib/ai/types";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { AdaptationPlanSchema, DraftAdaptationPlanSchema, type AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { CHARS_PER_TOKEN, estimateTokens, scanForbidden } from "./planner-lib";

/** Pieces of the real-generator experiment that need no provider: the frozen planner evidence, the pre-flight and the cost ceiling. */

export interface FrozenEvidence {
  planner: { prompt: string; prompt_sha256: string; schema: { draft_schema_fingerprint: string } };
  run: { analysis_fingerprint: string; context_fingerprint: string; raw_plan_fingerprint: string };
  metrics: { cost_usd: number; latency_ms: number };
  classification: { counts: Record<string, number> };
}

export const readEvidence = (file: string): FrozenEvidence => JSON.parse(readFileSync(file, "utf8")) as FrozenEvidence;

/** The raw plan exactly as the planner experiment saved it. */
export function loadRawPlan(file: string): AdaptationPlan {
  const data = JSON.parse(readFileSync(file, "utf8")) as { plan?: unknown };
  return AdaptationPlanSchema.parse(data.plan);
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Whether the planner artefacts (prompt, schema, raw plan, analysis, context) are exactly the ones frozen as evidence. */
export function evidenceIntact(evidence: FrozenEvidence, plan: AdaptationPlan, analysis: MaterialAnalysis, context: AdaptationContext): string[] {
  const problems: string[] = [];
  if (sha(ADAPTATION_PLANNER_V1.system) !== evidence.planner.prompt_sha256) problems.push("el prompt del planificador ya no es el congelado");
  if (sha(stableStringify(z.toJSONSchema(DraftAdaptationPlanSchema, { io: "input" }))) !== evidence.planner.schema.draft_schema_fingerprint) problems.push("el esquema del plan ya no es el congelado");
  if (fingerprint(plan) !== evidence.run.raw_plan_fingerprint) problems.push("el plan bruto no es el congelado");
  if (fingerprint(analysis) !== evidence.run.analysis_fingerprint || plan.analysis.fingerprint !== evidence.run.analysis_fingerprint) problems.push("el análisis no es el del experimento");
  if (plan.context_fingerprint !== evidence.run.context_fingerprint) problems.push("el contexto no es el del experimento");
  void context;
  return problems;
}

/** Same check for the evidence of a planner v2 run (`planner-v2-*.json`): its own prompt, the real analysis/context/plan fingerprints. */
export interface FrozenEvidenceV2 {
  planner: { prompt: string; prompt_sha256: string };
  analysis: { fingerprint: string };
  run: { context_fingerprint: string; raw_plan_fingerprint: string; context_policy: number };
}

export const isEvidenceV2 = (evidence: { planner: { prompt: string } }): boolean => evidence.planner.prompt === "adaptation_planner@v2";

export function evidenceIntactV2(evidence: FrozenEvidenceV2, plan: AdaptationPlan, analysis: MaterialAnalysis, context: AdaptationContext): string[] {
  const problems: string[] = [];
  if (sha(ADAPTATION_PLANNER_V2.system) !== evidence.planner.prompt_sha256) problems.push("el prompt del planificador v2 ya no es el congelado");
  if (fingerprint(plan) !== evidence.run.raw_plan_fingerprint) problems.push("el plan bruto no es el congelado");
  if (fingerprint(analysis) !== evidence.analysis.fingerprint || plan.analysis.fingerprint !== evidence.analysis.fingerprint) problems.push("el análisis no es el del experimento");
  if (plan.context_fingerprint !== evidence.run.context_fingerprint || fingerprint(context) !== evidence.run.context_fingerprint) problems.push("el contexto no es el del experimento");
  if ((context.policy_version ?? 1) !== evidence.run.context_policy) problems.push("la política del contexto no es la del experimento");
  return problems;
}

export interface GeneratorPreflight {
  systemChars: number;
  schemaChars: number;
  userChars: number;
  cacheableTokens: number;
  uncachedInputTokens: number;
  worstCaseUsd: number | null;
  forbiddenFound: string[];
  inferredAnswersInRequest: string[];
  decisionsSent: string[];
  rejectedSent: string[];
}

export function preflightGenerator(analysis: MaterialAnalysis, context: AdaptationContext, reviewed: ReviewedPlan, selection: ModelSelection, maxOutputTokens: number, version = 1): GeneratorPreflight {
  const { prompt, parts } = generatorRequestParts({ analysis, context, reviewed, version });
  const schemaText = schemaInstructions(prompt.output.schema);
  const userText = parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const cacheableTokens = estimateTokens(prompt.system.length + schemaText.length);
  const uncachedInputTokens = estimateTokens(userText.length) + 50;
  const all = `${prompt.system}\n${schemaText}\n${userText}`;
  const sent = (version === 2 ? buildGeneratorInputV2(reviewed, analysis, context) : buildGeneratorInput(reviewed, analysis, context)).approved.decisions.map((d) => d.id);
  return {
    systemChars: prompt.system.length,
    schemaChars: schemaText.length,
    userChars: userText.length,
    cacheableTokens,
    uncachedInputTokens,
    worstCaseUsd: estimateCostUsd(selection.provider, selection.model, { inputTokens: uncachedInputTokens, cacheCreationInputTokens: cacheableTokens, cachedInputTokens: 0, outputTokens: maxOutputTokens }),
    forbiddenFound: scanForbidden(all),
    inferredAnswersInRequest: answersOf(analysis).filter((a) => a.basis === "inferred" && all.includes(a.value)).map((a) => a.activity),
    decisionsSent: sent,
    rejectedSent: reviewed.decisions.filter((d) => d.outcome !== "applied" && sent.includes(d.id)).map((d) => d.id),
  };
}

export { CHARS_PER_TOKEN };
