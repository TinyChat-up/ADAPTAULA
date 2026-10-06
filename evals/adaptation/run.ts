/**
 * Offline adaptation eval: every scenario through the full pipeline with the deterministic mocks (no provider, no cost).
 * It checks the system itself (context, invariants, document assembly, review), not a model.
 *
 *   pnpm eval:adaptation:mock
 */
import { sequentialIds } from "@/lib/adaptation/document";
import { auditGeneration } from "@/lib/adaptation/generation-checks";
import { createMockGenerator, createMockPlanner, createMockReviewer } from "@/lib/adaptation/mock";
import { runAdaptation, type PipelineResult } from "@/lib/adaptation/pipeline";
import { checkOf } from "@/lib/adaptation/review";
import type { AdaptationPlanner } from "@/lib/adaptation/services";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { MOBILITY_PLAN_DRAFT, evalReviewFor, mobilityAnalysis } from "./generator-fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "./planner-lib";
import { SCENARIOS, type AdaptationScenario } from "./scenarios";

const auditOf = (analysis: MaterialAnalysis, result: PipelineResult) =>
  auditGeneration({ analysis, context: result.context, reviewed: result.reviewed, generation: result.generation, document: result.document, review: result.review });

export async function evaluateScenario(s: AdaptationScenario) {
  const analysis = s.analysis();
  const result = await runAdaptation(
    { profile: s.profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: s.adaptationType },
    { planner: createMockPlanner(analysis), generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds() },
  );
  const failures: string[] = auditOf(analysis, result).checks.filter((c) => !c.ok).map((c) => `auditoría: ${c.name} (${c.detail})`);
  const conflicts = new Set(result.context.conflicts.map((c) => c.key));
  for (const key of s.expect.conflicts ?? []) if (!conflicts.has(key)) failures.push(`falta el conflicto ${key}`);
  const flags = new Set(result.validation.issues.map((i) => i.flag));
  for (const flag of s.expect.planFlags ?? []) if (!flags.has(flag)) failures.push(`falta el aviso ${flag}`);
  for (const check of s.expect.mustNotFail) {
    const c = checkOf(result.review, check);
    if (c.status === "FAIL") failures.push(`${check}: ${c.detail}`);
  }
  return { scenario: s, result, failures };
}

/**
 * Geografía with the human-reviewed plan of the generator experiment: the planner's eight decisions, the human review
 * (approve, reject, edit) and the mock generator executing only what is approved.
 */
export async function evaluateReviewedGeography() {
  const analysis = mobilityAnalysis();
  const planner: AdaptationPlanner = { plan: async () => ({ draft: MOBILITY_PLAN_DRAFT, runs: [] }) };
  const result = await runAdaptation(
    { profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" },
    { planner, generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds(), humanReview: (plan) => evalReviewFor(plan) },
  );
  const audit = auditOf(analysis, result);
  const failures = audit.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`);
  const applied = result.reviewed.effective.decisions.map((d) => d.id).join(",");
  if (applied !== "dec_1,dec_4,dec_6,dec_7,dec_8") failures.push(`el plan efectivo es ${applied}`);
  return { result, audit, failures };
}

async function main() {
  let failed = 0;
  const reviewedRun = await evaluateReviewedGeography();
  console.log(`${reviewedRun.failures.length === 0 ? "✓" : "✗"} ESO · geografía · plan revisado por una persona (ejecutivas)`);
  console.log(`    plan bruto ${reviewedRun.result.reviewed.raw.decisions.length} decisiones (${JSON.stringify(reviewedRun.result.reviewed.classification.counts)}) → efectivo ${reviewedRun.result.plan.decisions.length} · bloques ${reviewedRun.result.document.pages.flatMap((p) => p.blocks).length} · veredicto ${reviewedRun.result.review.verdict}`);
  for (const f of reviewedRun.failures) console.log(`    - ${f}`);
  if (reviewedRun.failures.length > 0) failed += 1;
  for (const s of SCENARIOS) {
    const { result, failures } = await evaluateScenario(s);
    const blocks = result.document.pages.flatMap((p) => p.blocks).length;
    const summary = `${result.plan.decisions.length} decisiones · ${result.validation.issues.length} avisos del plan · ${blocks} bloques · veredicto ${result.review.verdict}`;
    console.log(`${failures.length === 0 ? "✓" : "✗"} ${s.title}\n    ${summary}`);
    for (const f of failures) console.log(`    - ${f}`);
    for (const c of result.review.checks.filter((x) => x.status === "WARN" || x.status === "FAIL")) console.log(`    · ${c.status} ${c.check}: ${c.detail}`);
    if (failures.length > 0) failed += 1;
  }
  console.log(`\n${SCENARIOS.length + 1 - failed}/${SCENARIOS.length + 1} escenarios sin fallos (proveedor simulado, coste 0).`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("run.ts")) void main();
