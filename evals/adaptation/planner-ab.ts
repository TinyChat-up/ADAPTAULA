/**
 * Offline planner A/B (no provider, no cost): planner v1 (context policy 1) against planner v2 (policy 2) on the three
 * synthetic fixtures, with the deterministic mocks. It measures the SYSTEM around the planner (request size, decisions the
 * mock emits, validator outcome); it says nothing about the quality of a real model's output.
 *
 *   pnpm eval:adaptation:planner:ab:mock
 */
import { classifyPlan, validatePlan } from "@/lib/adaptation/invariants";
import { modelFacingAnalysis } from "@/lib/adaptation/model-input";
import { createMockPlanner } from "@/lib/adaptation/mock";
import { normalizePlanFor } from "@/lib/adaptation/plan-v2";
import { plannerRequestParts } from "@/lib/adaptation/planner";
import { resolveModel } from "@/lib/ai/registry";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "./fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE, buildExperimentContext, preflightPlanner } from "./planner-lib";

const MATERIALS: Array<[string, () => MaterialAnalysis]> = [
  ["Geografía", geographyAnalysis],
  ["Bachillerato", argumentationAnalysis],
  ["Primaria", fractionsAnalysis],
];

export interface PlannerArm {
  version: 1 | 2;
  policy: 1 | 2;
  needs: number;
  inputChars: number;
  inputTokens: number;
  worstCaseUsd: number | null;
  decisions: number;
  decisionsOnPresentationDuplicate: number;
  issues: Record<string, number>;
  counts: Record<string, number>;
}

export async function planArm(analysis: MaterialAnalysis, version: 1 | 2): Promise<PlannerArm> {
  const policy = version;
  const context = buildExperimentContext(analysis, "accessibility", policy);
  const selection = resolveModel("STANDARD", {});
  const pre = preflightPlanner(analysis, context, selection, 6000, version);
  const { draft } = await createMockPlanner(analysis, version).plan({ context, material: modelFacingAnalysis(analysis) });
  const plan = normalizePlanFor(version, draft, analysis, context);
  const validation = validatePlan(plan, analysis, context);
  const classification = classifyPlan(plan, validation);
  const issues: Record<string, number> = {};
  for (const i of validation.issues) issues[`${i.severity}:${i.flag}`] = (issues[`${i.severity}:${i.flag}`] ?? 0) + 1;
  return {
    version,
    policy,
    needs: context.needs.length,
    inputChars: pre.userChars,
    inputTokens: pre.cacheableTokens + pre.uncachedInputTokens,
    worstCaseUsd: pre.worstCaseUsd,
    decisions: plan.decisions.length,
    decisionsOnPresentationDuplicate: plan.decisions.filter((d) => d.dimensions.includes("number_of_visible_tasks")).length,
    issues,
    counts: classification.counts,
  };
}

async function main() {
  console.log(`Perfil del experimento: ${Object.keys(EXECUTIVE_EXPERIMENT_PROFILE.supports).join(", ")}\n`);
  let failed = false;
  for (const [name, build] of MATERIALS) {
    const analysis = build();
    const v1 = await planArm(analysis, 1);
    const v2 = await planArm(analysis, 2);
    const request = plannerRequestParts({ analysis, context: buildExperimentContext(analysis, "accessibility", 2), version: 2 });
    console.log(`${name}`);
    for (const arm of [v1, v2]) {
      console.log(
        `  planner v${arm.version} (política ${arm.policy}): ${arm.needs} necesidades · entrada ${arm.inputChars} car. ≈ ${arm.inputTokens} tok · peor caso $${arm.worstCaseUsd?.toFixed(4)} · ${arm.decisions} decisiones (duplican presentación: ${arm.decisionsOnPresentationDuplicate}) · ${JSON.stringify(arm.counts)} · avisos ${JSON.stringify(arm.issues)}`,
      );
    }
    console.log(`  v2 frente a v1: entrada ${v2.inputChars - v1.inputChars >= 0 ? "+" : ""}${v2.inputChars - v1.inputChars} car. · decisiones ${v2.decisions - v1.decisions >= 0 ? "+" : ""}${v2.decisions - v1.decisions} · mensajes ${request.parts.length}`);
    if (v2.decisionsOnPresentationDuplicate > 0) {
      failed = true;
      console.log("  FALLO: v2 duplica la presentación");
    }
    if ((v2.counts["blocked"] ?? 0) > 0) {
      failed = true;
      console.log("  FALLO: v2 emite decisiones bloqueadas");
    }
  }
  if (failed) process.exitCode = 1;
}

void main();
