import { validatePlan } from "@/lib/adaptation/invariants";
import { normalizePlanV3 } from "@/lib/adaptation/plan-v3";
import { PLANNER_TIMEOUT_MS, callPlanner, parsePlanResponse, plannerRequestParts, rulesUse } from "@/lib/adaptation/planner";
import { auditAdaptation } from "@/lib/adaptation/v22/audit";
import { buildRulesBlock } from "@/lib/agent-rules/prompt-block";
import type { AgentRules } from "@/lib/agent-rules/types";
import { estimateCostUsd } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import type { AnalyzerDefinition } from "@/lib/ai/prompts";
import { AnthropicProvider, type AnthropicClientLike } from "@/lib/ai/providers/anthropic";
import type { ModelSelection, StructuredRequest } from "@/lib/ai/types";
import { redactSecrets } from "@/lib/security/redact";
import { ADAPTATION_PLANNER_V3 } from "@prompts/adaptation-planner/v3";
import { analyzeCase } from "../material-analysis/harness";
import { meteredClient, usageOf, type MeteredCall } from "./metered-client";
import { PilotBudget, callCeilingUsd } from "./pilot-lib";
import { buildExperimentContext } from "./planner-lib";
import { V22_PROFILES } from "./v22-profiles";

/**
 * The network part of the V2.2 pilot (evals/adaptation/pilot-v22.ts), separated so its guarantees are tested with a fake client.
 * `client` must be created with `maxRetries: 0`. Every request goes through the meter; structured-output fallback is off and each
 * output's mode is fixed; each paid call is counted and reserved first, and anything uncertain stops the run (pilot-lib.ts).
 */
export interface PilotRunInput {
  client: AnthropicClientLike;
  budget: PilotBudget;
  analyzer: AnalyzerDefinition;
  analysisSelection: ModelSelection;
  plannerSelection: ModelSelection;
  pdf: Uint8Array;
  pages: number;
  profile: keyof typeof V22_PROFILES;
  rules: AgentRules;
  /** The rules block with every precedent: the planner's fixed part before the analysis exists. */
  allRules: string;
  analysisMax: number;
  plannerMax: number;
  /** false: count only (free). true: the paid calls too. */
  pay: boolean;
  log?: (line: string) => void;
}

export interface PilotRunResult {
  out: Record<string, unknown>;
  calls: MeteredCall[];
}

const usd = (n: number) => `$${n.toFixed(4)}`;
/** Material sent to the planner ≤ 1.5 × the analysis output, plus context and wrappers (pilot-lib.ts). */
const projectedMaterialTokens = (analysisMax: number) => Math.ceil(analysisMax * 1.5) + 4_000;

export async function runPilotCalls(input: PilotRunInput): Promise<PilotRunResult> {
  const { budget, analyzer } = input;
  const log = input.log ?? (() => undefined);
  const metered = meteredClient(input.client);
  const provider = new AnthropicProvider(metered.client, { promptedFallback: false, deliveries: { [analyzer.output.name]: "prompted", [ADAPTATION_PLANNER_V3.output.name]: "native" } });
  const out: Record<string, unknown> = {};
  const done = () => ({ out, calls: metered.calls });
  const failed = (error: unknown) => toAIError(error).code;

  // 1. The analysis request analyze.ts sends first (same prompt, file, context and cap).
  const analysisRequest: StructuredRequest = {
    selection: input.analysisSelection,
    system: analyzer.system,
    messages: [{ role: "user", content: analyzer.buildUserParts({ file: { kind: "pdf", data: input.pdf }, pageCount: input.pages, teacherContext: {} }) }],
    output: analyzer.output,
    maxOutputTokens: input.analysisMax,
    timeoutMs: 200_000,
  };
  let analysisCount: number;
  let fixedCount: number;
  try {
    analysisCount = (await provider.countInputTokens(analysisRequest)).inputTokens;
    fixedCount = (
      await provider.countInputTokens({ selection: input.plannerSelection, system: ADAPTATION_PLANNER_V3.system, messages: [{ role: "user", content: [{ type: "text", text: input.allRules }] }], output: ADAPTATION_PLANNER_V3.output, maxOutputTokens: input.plannerMax, timeoutMs: PLANNER_TIMEOUT_MS })
    ).inputTokens;
  } catch (error) {
    budget.stop(`recuento fallido (${failed(error)})`);
    return done();
  }
  const analysisCeiling = callCeilingUsd(input.analysisSelection, analysisCount, input.analysisMax);
  const plannerProjection = callCeilingUsd(input.plannerSelection, fixedCount + projectedMaterialTokens(input.analysisMax), input.plannerMax);
  out.counts = { analysisInput: analysisCount, plannerFixedInput: fixedCount };
  out.countedCeilingUsd = { analysis: analysisCeiling, plannerProjected: plannerProjection, total: analysisCeiling + plannerProjection };
  log(`1. análisis: entrada contada ${analysisCount} → cota ${usd(analysisCeiling)} · planificador: parte fija contada ${fixedCount} → cota proyectada ${usd(plannerProjection)} · total ${usd(analysisCeiling + plannerProjection)}`);
  if (analysisCeiling + plannerProjection > budget.cap) budget.stop("la cota con recuento supera el límite seguro");
  if (!input.pay || budget.stopReason) return done();

  if (!budget.reserve("análisis", analysisCeiling)) return done();
  const before = metered.calls.length;
  const analyzed = await analyzeCase({ analyzer, id: "pilot", title: "pilot", stage: null, file: { kind: "pdf", data: input.pdf }, pageCount: input.pages, selection: input.analysisSelection, provider, maxOutputTokens: input.analysisMax, singleCall: true });
  const analysisCalls = metered.calls.slice(before).filter((c) => c.kind === "message");
  if (analysisCalls.length !== 1) budget.keep("análisis", analysisCeiling, `${analysisCalls.length} peticiones de pago en lugar de 1`);
  else {
    const usage = usageOf(analysisCalls[0]);
    if (!usage) budget.keep("análisis", analysisCeiling, "error del proveedor o uso desconocido");
    else budget.settle("análisis", analysisCeiling, estimateCostUsd(input.analysisSelection.provider, input.analysisSelection.model, usage));
  }
  out.analysis = { report: analyzed.report, analysis: analyzed.analysis };
  log(`   ${analyzed.analysis ? "análisis válido" : "SIN análisis utilizable"} · comprometido ${usd(budget.committedUsd)}`);
  if (!analyzed.analysis) budget.stop("el análisis no es utilizable");
  if (budget.stopReason) return done();

  // 2. Planner v3: the request callPlanner sends, counted exactly once the analysis exists.
  const analysis = analyzed.analysis!;
  const context = buildExperimentContext(analysis, "accessibility", 2, V22_PROFILES[input.profile]);
  const block = await buildRulesBlock(input.rules, analysis, context);
  const { prompt, parts } = plannerRequestParts({ analysis, context, version: 3, rules: block });
  let plannerCount: number;
  try {
    plannerCount = (await provider.countInputTokens({ selection: input.plannerSelection, system: prompt.system, messages: [{ role: "user", content: parts }], output: prompt.output, maxOutputTokens: input.plannerMax, timeoutMs: PLANNER_TIMEOUT_MS })).inputTokens;
  } catch (error) {
    budget.stop(`recuento del planificador fallido (${failed(error)})`);
    return done();
  }
  const plannerCeiling = callCeilingUsd(input.plannerSelection, plannerCount, input.plannerMax);
  Object.assign(out, { context, rules: rulesUse(block) });
  (out.counts as Record<string, number>).plannerInput = plannerCount;
  log(`2. planificador: ${block.selection.included.length}/${input.rules.precedents.length} precedentes · entrada contada ${plannerCount} → cota ${usd(plannerCeiling)}`);
  if (!budget.reserve("planificador", plannerCeiling)) return done();

  const mark = metered.calls.length;
  try {
    const { response } = await callPlanner({ analysis, context, selection: input.plannerSelection, provider, maxOutputTokens: input.plannerMax, version: 3, rules: block });
    const calls = metered.calls.slice(mark).filter((c) => c.kind === "message");
    const usage = calls.length === 1 ? usageOf(calls[0]) : null;
    if (!usage) budget.keep("planificador", plannerCeiling, `${calls.length} peticiones de pago o uso desconocido`);
    else budget.settle("planificador", plannerCeiling, estimateCostUsd(input.plannerSelection.provider, input.plannerSelection.model, usage));
    const parsed = parsePlanResponse(response, 3);
    out.planner = { stopReason: response.stopReason, parse: parsed.outcome, issues: parsed.outcome === "ok" ? [] : parsed.issues, responseText: response.text };
    if (parsed.outcome === "ok") {
      const { plan, declarations } = normalizePlanV3(parsed.draft, analysis, context, rulesUse(block));
      const validation = validatePlan(plan, analysis, context);
      const audit = auditAdaptation({ plan, validation, context, analysis, declarations, profile: V22_PROFILES[input.profile] });
      Object.assign(out, { plan, declarations, validation, decisionLedger: audit.ledger, findings: audit.findings, not_checked: audit.not_checked });
      const withheld = Object.values(declarations.decisions).filter((d) => d.withheld).length;
      log(`   ${plan.decisions.length} decisiones (${withheld} retenidas para el docente) · ${declarations.teacher_questions.length} preguntas · ${declarations.residual_barriers.length} barreras declaradas`);
    } else log(`   respuesta no utilizable: ${parsed.outcome}`);
  } catch (error) {
    // Rejected schema, timeout, cut connection…: nothing is retried and the reservation stays whole.
    budget.keep("planificador", plannerCeiling, `error del proveedor (${failed(error)})`);
    out.planner = { error: { code: failed(error), message: redactSecrets(toAIError(error).message) } };
  }
  return done();
}
