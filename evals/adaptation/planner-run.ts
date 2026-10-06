/**
 * Real-planner experiment (docs/ADAPTATION.md): ONE call to the planner on a stored MaterialAnalysis v3, with the executive-
 * function profile of the experiment. Nothing is repaired, regenerated or dropped: the raw answer is what gets evaluated.
 * Results go to the git-ignored `evals/adaptation/private/`. It never touches the database, the quota or the analysis.
 *
 *   pnpm eval:adaptation:planner -- --analysis <results.json>                       # pre-flight only (no call, no cost)
 *   pnpm eval:adaptation:planner -- --analysis <results.json> --budget 0.10 --max-output-tokens 6000 --yes
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyPlan } from "@/lib/adaptation/invariants";
import { applicablePlan } from "@/lib/adaptation/plan";
import { PlanDraftError, normalizePlanFor } from "@/lib/adaptation/plan-v2";
import { callPlanner, parsePlanResponse, plannerRequestParts } from "@/lib/adaptation/planner";
import { STRATEGY_KEYS } from "@/lib/schemas/adaptation-plan";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { createProvider } from "@/lib/ai/router";
import { toAIError } from "@/lib/ai/errors";
import { redactSecrets } from "@/lib/security/redact";
import { EXECUTIVE_EXPERIMENT_PROFILE, buildExperimentContext, loadStoredAnalysis, preflightPlanner } from "./planner-lib";

const OUT_DIR = path.resolve(import.meta.dirname, "private/results");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const file = arg("--analysis");
  if (!file) throw new Error("Falta --analysis <archivo de resultados privados del análisis>.");
  const budget = Number(arg("--budget") ?? "0.10");
  const maxOutputTokens = Number(arg("--max-output-tokens") ?? "6000");
  const version = Number(arg("--planner-version") ?? "1");
  const policy = Number(arg("--context-policy") ?? "1");
  if (version !== 1 && version !== 2) throw new Error("--planner-version debe ser 1 o 2.");
  if (policy !== 1 && policy !== 2) throw new Error("--context-policy debe ser 1 o 2.");
  const label = arg("--label") ?? `planner-v${version}`;
  const go = process.argv.includes("--yes");

  const env = process.env as ModelEnv & { ANTHROPIC_API_KEY?: string };
  const selection = resolveModel("STANDARD", env);
  const source = loadStoredAnalysis(path.resolve(file));
  const { analysis } = source;
  const context = buildExperimentContext(analysis, "accessibility", policy);
  const pre = preflightPlanner(analysis, context, selection, maxOutputTokens, version);
  const { prompt } = plannerRequestParts({ analysis, context, version });

  console.log("Pre-flight (sin llamadas)");
  console.log(`  análisis: schema_version ${analysis.schema_version} · producido por ${source.producedBy.prompt} (${source.producedBy.alias}) · avisos de lectura: ${source.warnings.length}`);
  console.log(`  planificador: ${prompt.key}@v${prompt.version} · esquema del plan v${prompt.schemaVersion} · alias ${selection.alias} · ${selection.provider}:${selection.model} · esfuerzo ${selection.effort}`);
  console.log(`  contexto (política ${policy}): ${context.needs.length} necesidades (${context.needs.map((n) => n.dimension).join(", ")}) · huella ${pre.contextFingerprint.slice(0, 12)} · determinista: ${pre.deterministic ? "sí" : "NO"}`);
  console.log(`  tamaños: prompt ${pre.systemChars} car. · esquema ${pre.schemaChars} car. · entrada ${pre.userChars} car. → ≈ ${pre.cacheableTokens} tokens de bloque en caché + ${pre.uncachedInputTokens} de entrada`);
  console.log(`  diagnóstico/PII en lo que se enviaría: ${pre.forbiddenFound.length === 0 ? "ninguno" : pre.forbiddenFound.join(", ")}`);
  console.log(`  peor caso (caché fría, salida máxima ${maxOutputTokens}): $${pre.worstCaseUsd?.toFixed(4) ?? "?"} · presupuesto $${budget.toFixed(2)}`);

  const blockers: string[] = [];
  if (analysis.schema_version !== 3) blockers.push("el análisis no es MaterialAnalysis v3");
  if (source.producedBy.prompt !== "material_analyzer@v3") blockers.push(`el análisis no lo produjo material_analyzer@v3 (${source.producedBy.prompt})`);
  if (!pre.deterministic) blockers.push("el contexto no es determinista");
  if (pre.forbiddenFound.length > 0) blockers.push("la entrada contiene diagnóstico o datos personales");
  if (pre.worstCaseUsd === null) blockers.push("el modelo no tiene precio conocido");
  else if (pre.worstCaseUsd > budget) blockers.push(`el peor caso ($${pre.worstCaseUsd.toFixed(4)}) supera el presupuesto ($${budget.toFixed(2)})`);
  if (blockers.length > 0) {
    console.log(`\nNO se ejecuta: ${blockers.join("; ")}.`);
    process.exitCode = 2;
    return;
  }
  if (!go) {
    console.log("\nSolo pre-flight. Añade --yes para hacer la única llamada real.");
    return;
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY (se lee de .env.local).");

  const provider = createProvider(selection, { anthropicApiKey: env.ANTHROPIC_API_KEY, isProduction: false });
  console.log("\nLlamada real (una sola, sin reparación ni regeneración)…");
  let result: Record<string, unknown>;
  try {
    const { response, run } = await callPlanner({ analysis, context, selection, provider, maxOutputTokens, version });
    const parsed = parsePlanResponse(response, version);
    let plan = null;
    let validation = null;
    let classification = null;
    let effective = null;
    let normalizeError: string | null = null;
    if (parsed.outcome === "ok") {
      try {
        plan = normalizePlanFor(version, parsed.draft, analysis, context);
        const checked = applicablePlan(plan, analysis, context);
        validation = checked.validation;
        classification = classifyPlan(plan, validation);
        effective = checked.plan;
      } catch (error) {
        normalizeError = error instanceof PlanDraftError ? `${error.code}: ${error.message}`.slice(0, 500) : error instanceof Error ? error.message.slice(0, 500) : "error de normalización";
      }
    }
    result = { response: { text: response.text, stopReason: response.stopReason, model: response.model }, run, parse: parsed, normalizeError, plan, validation, classification, effectivePlan: effective };
  } catch (error) {
    const failure = toAIError(error);
    result = { error: { code: failure.code, message: redactSecrets(failure.message) } };
  }

  const startedAt = new Date().toISOString();
  const out = {
    version: 1,
    kind: "planner-experiment",
    startedAt,
    label,
    descriptor: { provider: selection.provider, alias: selection.alias, model: selection.model, effort: selection.effort, prompt: `${prompt.key}@v${prompt.version}`, schemaVersion: prompt.schemaVersion, contextPolicy: policy, maxOutputTokens, budget },
    analysisSource: { file: path.basename(file), producedBy: source.producedBy, fingerprint: pre.analysisFingerprint },
    profile: EXECUTIVE_EXPERIMENT_PROFILE,
    context,
    preflight: pre,
    strategies: STRATEGY_KEYS,
    ...result,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `${startedAt.replace(/[:.]/g, "-")}-${label}.json`);
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`Resultado guardado (privado): ${path.relative(process.cwd(), target)}`);
  const run = (result as { run?: { inputTokens: number; cacheCreationInputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedCostUsd: number | null; latencyMs: number } }).run;
  if (run) console.log(`  tokens: entrada ${run.inputTokens} · caché escrita ${run.cacheCreationInputTokens} · caché leída ${run.cachedInputTokens} · salida ${run.outputTokens} · coste $${run.estimatedCostUsd?.toFixed(6)} · ${(run.latencyMs / 1000).toFixed(1)} s`);
  const cls = (result as { classification?: { counts: Record<string, number> } }).classification;
  if (cls) console.log(`  decisiones: ${JSON.stringify(cls.counts)}`);
  if ("error" in result) console.log(`  error: ${(result as { error: { code: string } }).error.code}`);
}

void main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
