/**
 * Offline A/B of generator v1 vs v2 with the deterministic mocks (no provider, no cost): Geografía with its reviewed plan,
 * Bachillerato with its reviewed plan and Primaria with the mock planner, all with the same executive-function profile.
 * The mocks follow each version's contract, so this compares the PIPELINE (contract, normalisation, assembly, audit), not a
 * model: the real model is compared only in the paid A/B (docs/ADAPTATION.md).
 *
 *   pnpm eval:adaptation:ab:mock
 */
import { sequentialIds } from "@/lib/adaptation/document";
import { auditGeneration } from "@/lib/adaptation/generation-checks";
import { createMockGenerator, createMockPlanner, createMockReviewer } from "@/lib/adaptation/mock";
import { runAdaptation, type PipelineResult } from "@/lib/adaptation/pipeline";
import { checkOf } from "@/lib/adaptation/review";
import type { AdaptationPlanner } from "@/lib/adaptation/services";
import { activityExpansion } from "@/lib/adaptation/redundancy";
import type { AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { PlanReview } from "@/lib/schemas/plan-review";
import { allBlocks } from "@/lib/schemas/material-document";
import { BACH_PLAN_DRAFT, MOBILITY_PLAN_DRAFT, bachReviewFor, bachilleratoMirrorAnalysis, evalReviewFor, mobilityAnalysis } from "./generator-fixtures";
import { fractionsAnalysis } from "./fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "./planner-lib";

export interface AbMaterial {
  id: string;
  title: string;
  analysis: () => MaterialAnalysis;
  planner: (analysis: MaterialAnalysis) => AdaptationPlanner;
  review?: (plan: AdaptationPlan) => PlanReview;
}

export const AB_MATERIALS: AbMaterial[] = [
  { id: "geografia", title: "ESO · Geografía (plan revisado)", analysis: mobilityAnalysis, planner: () => ({ plan: async () => ({ draft: MOBILITY_PLAN_DRAFT, runs: [] }) }), review: (p) => evalReviewFor(p) },
  { id: "bachillerato", title: "Bachillerato · argumentación (plan revisado)", analysis: bachilleratoMirrorAnalysis, planner: () => ({ plan: async () => ({ draft: BACH_PLAN_DRAFT, runs: [] }) }), review: bachReviewFor },
  { id: "primaria", title: "Primaria · fracciones (planificador simulado)", analysis: fractionsAnalysis, planner: (a) => createMockPlanner(a) },
];

export interface AbRow {
  version: 1 | 2;
  result: PipelineResult;
  words: { original: number; final: number; multiplier: number };
  blocks: number;
  transformed: number;
  exactRepeats: number;
  nearRepeats: number;
  protectedOk: boolean;
  leakFails: number;
  unauthorized: number;
  nonEffective: number;
  auditOk: boolean;
}

export async function runAb(material: AbMaterial, version: 1 | 2): Promise<AbRow> {
  const analysis = material.analysis();
  const result = await runAdaptation(
    { profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" },
    { planner: material.planner(analysis), generator: createMockGenerator(version), reviewer: createMockReviewer(), newBlockId: sequentialIds(), generatorVersion: version, ...(material.review ? { humanReview: material.review } : {}) },
  );
  const audit = auditGeneration({ analysis, context: result.context, reviewed: result.reviewed, generation: result.generation, document: result.document, review: result.review });
  const t = audit.expansion.filter((e) => e.transformed);
  const original = t.reduce((n, e) => n + e.originalWords, 0);
  const final = t.reduce((n, e) => n + e.finalWords, 0);
  return {
    version,
    result,
    words: { original, final, multiplier: original === 0 ? 1 : Math.round((final / original) * 100) / 100 },
    blocks: allBlocks(result.document).length,
    transformed: t.length,
    exactRepeats: audit.expansion.reduce((n, e) => n + e.exactRepeats, 0),
    nearRepeats: audit.expansion.reduce((n, e) => n + e.nearRepeats, 0),
    protectedOk: ["protected_elements_preserved", "constraints_preserved", "required_data_preserved"].every((c) => checkOf(result.review, c as never).status !== "FAIL"),
    leakFails: result.review.checks.filter((c) => c.check === "answers_not_leaked" && c.status === "FAIL").length,
    unauthorized: audit.proposedUnauthorized,
    nonEffective: audit.appliedFromNonEffective.length,
    auditOk: audit.ok,
  };
}

async function main() {
  console.log("A/B de generator v1 frente a v2 con mocks (sin proveedor, coste 0)\n");
  console.log("| material | versión | actividades transformadas | palabras originales → visibles (×) | bloques | repeticiones literales / casi literales | protegidos | fugas | fuera de destino | auditoría |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  let failed = 0;
  for (const m of AB_MATERIALS) {
    for (const version of [1, 2] as const) {
      const r = await runAb(m, version);
      if (!r.auditOk || !r.protectedOk || r.leakFails > 0 || r.nonEffective > 0) failed += 1;
      console.log(`| ${m.title} | v${version} | ${r.transformed} | ${r.words.original} → ${r.words.final} (×${r.words.multiplier}) | ${r.blocks} | ${r.exactRepeats} / ${r.nearRepeats} | ${r.protectedOk ? "conservados" : "PÉRDIDA"} | ${r.leakFails} | ${r.unauthorized + r.nonEffective} | ${r.auditOk ? "ok" : "FALLA"} |`);
    }
  }
  void activityExpansion;
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("generator-ab.ts")) void main();
