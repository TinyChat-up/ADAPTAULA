/**
 * Real-generator experiment (docs/ADAPTATION.md): ONE call to `material_generator@v1` that executes the APPROVED decisions of a
 * human-reviewed plan. The planner is not called again, nothing is repaired or regenerated, and the raw answer is what gets
 * audited. Results go to the git-ignored `evals/adaptation/private/`; the database, the quota and the analysis are never touched.
 *
 *   pnpm eval:adaptation:generator -- --analysis <analysis results.json> --plan <planner results.json>     # pre-flight only
 *   pnpm eval:adaptation:generator -- --analysis … --plan … --budget 0.10 --max-output-tokens 6000 --yes
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { auditGeneration } from "@/lib/adaptation/generation-checks";
import { callGenerator, normalizeGeneration, parseGeneratorResponse } from "@/lib/adaptation/generator";
import { reviewPlan } from "@/lib/adaptation/plan-review";
import { planExecutability } from "@/lib/adaptation/execution";
import { PlanReviewSchema } from "@/lib/schemas/plan-review";
import { buildReview } from "@/lib/adaptation/review";
import { toAIError } from "@/lib/ai/errors";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { createProvider } from "@/lib/ai/router";
import { redactSecrets } from "@/lib/security/redact";
import { getMaterialGenerator } from "@/lib/ai/prompts";
import { evalReviewFor } from "./generator-fixtures";
import { evidenceIntact, evidenceIntactV2, isEvidenceV2, loadRawPlan, preflightGenerator, readEvidence, type FrozenEvidenceV2 } from "./generator-lib";
import { buildExperimentContext, loadStoredAnalysis } from "./planner-lib";

const OUT_DIR = path.resolve(import.meta.dirname, "private/results");
const DEFAULT_EVIDENCE = path.resolve(import.meta.dirname, "evidence/planner-v1-geografia.json");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const analysisFile = arg("--analysis");
  const planFile = arg("--plan");
  if (!analysisFile || !planFile) throw new Error("Faltan --analysis <resultados del análisis> y --plan <resultados del planificador>.");
  const budget = Number(arg("--budget") ?? "0.10");
  const maxOutputTokens = Number(arg("--max-output-tokens") ?? "6000");
  const label = arg("--label") ?? "generator-v1";
  const go = process.argv.includes("--yes");
  const version = Number(arg("--generator-version") ?? "1");

  const env = process.env as ModelEnv & { ANTHROPIC_API_KEY?: string };
  const selection = resolveModel("STANDARD", env);
  const { analysis, producedBy } = loadStoredAnalysis(path.resolve(analysisFile));
  const policy = Number(arg("--context-policy") ?? "1");
  if (policy !== 1 && policy !== 2) throw new Error("--context-policy debe ser 1 o 2.");
  const context = buildExperimentContext(analysis, "accessibility", policy);
  const rawPlan = loadRawPlan(path.resolve(planFile));
  // `--evidence` and `--review` let the same runner serve another material: its own frozen planner evidence and its own human review.
  const evidence = readEvidence(arg("--evidence") ? path.resolve(arg("--evidence")!) : DEFAULT_EVIDENCE);
  const reviewFile = arg("--review");
  const review = reviewFile ? PlanReviewSchema.parse(JSON.parse(readFileSync(path.resolve(reviewFile), "utf8"))) : evalReviewFor(rawPlan);
  const reviewed = reviewPlan(rawPlan, review, analysis, context);
  const pre = preflightGenerator(analysis, context, reviewed, selection, maxOutputTokens, version);
  const prompt = getMaterialGenerator(version);
  const execution = planExecutability(reviewed, analysis, context);

  console.log("Pre-flight (sin llamadas)");
  console.log(`  análisis: v${analysis.schema_version} producido por ${producedBy.prompt} · plan bruto ${rawPlan.decisions.length} decisiones (huella ${fingerprintShort(rawPlan)})`);
  console.log(`  revisión humana: ${reviewed.decisions.map((d) => `${d.id}:${d.outcome}${d.modifiedFields.length ? `[${d.modifiedFields.join(",")}]` : ""}`).join(" ")}`);
  console.log(`  plan efectivo: ${reviewed.effective.decisions.map((d) => d.id).join(", ")} · validación efectiva ${reviewed.effectiveValidation.valid ? "sin bloqueos" : "CON BLOQUEOS"}`);
  console.log(`  generador: ${prompt.key}@v${prompt.version} · esquema ${prompt.output.name} v${prompt.schemaVersion} · alias ${selection.alias} · ${selection.provider}:${selection.model} · esfuerzo ${selection.effort}`);
  console.log("  Ejecución de cada decisión (antes de cualquier llamada):");
  console.log("  | Decisión | Revisión | Ruta de ejecución | Petición al generador |");
  console.log("  |---|---|---|---|");
  for (const d of execution.decisions) {
    console.log(`  | ${d.id} (${d.target}) | ${d.outcome} | ${d.route ?? "—"} | ${pre.decisionsSent.includes(d.id) ? "sí" : "no"} |`);
  }
  if (execution.deferred.length > 0) console.log(`  pendientes del renderer (no ejecutadas, sin generar nada): ${execution.deferred.map((d) => `${d.id} → ${d.target}`).join(", ")}`);
  console.log(`  se envían ${pre.decisionsSent.length} decisiones (${pre.decisionsSent.join(", ")}) · rechazadas enviadas: ${pre.rejectedSent.length === 0 ? "ninguna" : pre.rejectedSent.join(", ")}`);
  console.log(`  tamaños: prompt ${pre.systemChars} car. · esquema ${pre.schemaChars} car. · entrada ${pre.userChars} car. → ≈ ${pre.cacheableTokens} tokens de bloque en caché + ${pre.uncachedInputTokens} de entrada`);
  console.log(`  diagnóstico/PII: ${pre.forbiddenFound.length === 0 ? "ninguno" : pre.forbiddenFound.join(", ")} · respuestas inferred en la petición: ${pre.inferredAnswersInRequest.length === 0 ? "ninguna" : pre.inferredAnswersInRequest.join(", ")}`);
  console.log(`  peor caso (caché fría, salida máxima ${maxOutputTokens}): $${pre.worstCaseUsd?.toFixed(4) ?? "?"} · presupuesto $${budget.toFixed(2)}`);

  const blockers: string[] = isEvidenceV2(evidence) ? evidenceIntactV2(evidence as unknown as FrozenEvidenceV2, rawPlan, analysis, context) : [...evidenceIntact(evidence, rawPlan, analysis, context)];
  if (analysis.schema_version !== 3 || producedBy.prompt !== "material_analyzer@v3") blockers.push("el análisis no es v3 producido por material_analyzer@v3");
  if (version === 2) {
    blockers.push(...execution.blockers);
    if (JSON.stringify([...pre.decisionsSent].sort()) !== JSON.stringify([...execution.ai].sort())) blockers.push("la petición no contiene exactamente las decisiones con ruta ai_generation");
  }
  if (reviewed.decisions.some((d) => d.outcome === "applied" && d.rawStatus === "blocked")) blockers.push("una decisión bloqueada quedó aplicada");
  if (!reviewed.effectiveValidation.valid) blockers.push("el plan efectivo tiene bloqueos");
  if (pre.rejectedSent.length > 0) blockers.push("se enviarían decisiones rechazadas");
  if (pre.forbiddenFound.length > 0) blockers.push("la entrada contiene diagnóstico o datos personales");
  if (pre.inferredAnswersInRequest.length > 0) blockers.push("la petición contiene respuestas inferidas");
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
    const { response, run } = await callGenerator({ analysis, context, reviewed, selection, provider, maxOutputTokens, version });
    const parsed = parseGeneratorResponse(response, version);
    let tail: Record<string, unknown> = {};
    if (parsed.outcome === "ok") {
      const generation = normalizeGeneration(version, parsed.draft, reviewed, analysis, context);
      try {
        const document = buildDocument({ analysis, plan: reviewed.effective, context, generated: generation.segments, newBlockId: sequentialIds() });
        const review = buildReview({ analysis, plan: reviewed.effective, context, document, validation: reviewed.effectiveValidation });
        const audit = auditGeneration({ analysis, context, reviewed, generation, document, review });
        tail = { generation, document, review, audit };
      } catch (error) {
        tail = { generation, assemblyError: error instanceof Error ? error.message.slice(0, 1500) : "error de ensamblado" };
      }
    }
    result = { response: { text: response.text, stopReason: response.stopReason, model: response.model }, run, parse: parsed, ...tail };
  } catch (error) {
    const failure = toAIError(error);
    result = { error: { code: failure.code, message: redactSecrets(failure.message) } };
  }

  const startedAt = new Date().toISOString();
  const out = {
    version: 1,
    kind: "generator-experiment",
    startedAt,
    label,
    descriptor: { provider: selection.provider, alias: selection.alias, model: selection.model, effort: selection.effort, prompt: `${prompt.key}@v${prompt.version}`, schema: `${prompt.output.name}@${prompt.schemaVersion}`, contextPolicy: context.policy_version ?? 1, maxOutputTokens, budget },
    chain: reviewed.decisions.map((d) => ({ id: d.id, raw: d.raw, validator: { status: d.rawStatus, issues: d.rawIssues }, review: d.review, outcome: d.outcome, effective: d.effective, origin: d.origin, modifiedFields: d.modifiedFields, restrictions: d.restrictions })),
    review: reviewed.review,
    execution,
    preflight: pre,
    ...result,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `${startedAt.replace(/[:.]/g, "-")}-${label}.json`);
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`Resultado guardado (privado): ${path.relative(process.cwd(), target)}`);
  const run = (result as { run?: { inputTokens: number; cacheCreationInputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedCostUsd: number | null; latencyMs: number } }).run;
  if (run) console.log(`  tokens: entrada ${run.inputTokens} · caché escrita ${run.cacheCreationInputTokens} · caché leída ${run.cachedInputTokens} · salida ${run.outputTokens} · coste $${run.estimatedCostUsd?.toFixed(6)} · ${(run.latencyMs / 1000).toFixed(1)} s`);
  const audit = (result as { audit?: { ok: boolean; checks: Array<{ ok: boolean; name: string; detail: string }> } }).audit;
  if (audit) for (const c of audit.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}`);
  const parseOutcome = (result as { parse?: { outcome: string } }).parse?.outcome;
  if (parseOutcome && parseOutcome !== "ok") console.log(`  parseo: ${parseOutcome}`);
  if ("error" in result) console.log(`  error: ${(result as { error: { code: string } }).error.code}`);
}

const fingerprintShort = (value: unknown) => fingerprint(value).slice(0, 12);

void main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
