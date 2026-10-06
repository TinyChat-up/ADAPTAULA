/**
 * Real-reviewer experiment (docs/ADAPTATION.md): ONE call to `pedagogical_reviewer@v1` on a MaterialDocument that an earlier
 * run already produced. Nothing upstream runs again (no analysis, planner or generator), nothing is repaired or regenerated, and
 * the raw answer is what gets audited. Results go to the git-ignored `evals/adaptation/private/`.
 *
 *   pnpm eval:adaptation:reviewer -- --analysis <analysis.json> --plan <planner.json> --review <PlanReview.json> --generation <generator.json> --evidence <planner evidence>   # pre-flight only
 *   … --budget 0.05 --max-output-tokens 2000 --yes
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { planExecutability } from "@/lib/adaptation/execution";
import { reviewPlan } from "@/lib/adaptation/plan-review";
import { assembleReview, deterministicChecks } from "@/lib/adaptation/review";
import { buildPedagogicalReviewContext } from "@/lib/adaptation/review-context";
import { buildReviewScoped, callReviewer, findingsToDraft, parseReviewerResponse, reviewerRequestParts } from "@/lib/adaptation/reviewer";
import { estimateCostUsd } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { createProvider } from "@/lib/ai/router";
import { schemaInstructions } from "@/lib/ai/providers/anthropic";
import { redactSecrets } from "@/lib/security/redact";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";
import { PlanReviewSchema } from "@/lib/schemas/plan-review";
import { evidenceIntactV2, isEvidenceV2, loadRawPlan, readEvidence, type FrozenEvidenceV2 } from "./generator-lib";
import { buildExperimentContext, estimateTokens, loadStoredAnalysis, scanForbidden } from "./planner-lib";

const OUT_DIR = path.resolve(import.meta.dirname, "private/results");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const need = (name: string) => {
  const value = arg(name);
  if (!value) throw new Error(`Falta ${name}.`);
  return path.resolve(value);
};

async function main() {
  const budget = Number(arg("--budget") ?? "0.05");
  const maxOutputTokens = Number(arg("--max-output-tokens") ?? "2000");
  const label = arg("--label") ?? "reviewer-v1";
  const go = process.argv.includes("--yes");
  const policy = Number(arg("--context-policy") ?? "2");
  if (policy !== 1 && policy !== 2) throw new Error("--context-policy debe ser 1 o 2.");

  const env = process.env as ModelEnv & { ANTHROPIC_API_KEY?: string };
  const selection = resolveModel("STANDARD", env);
  const { analysis, producedBy } = loadStoredAnalysis(need("--analysis"));
  const context = buildExperimentContext(analysis, "accessibility", policy);
  const rawPlan = loadRawPlan(need("--plan"));
  const evidence = readEvidence(need("--evidence"));
  const review = PlanReviewSchema.parse(JSON.parse(readFileSync(need("--review"), "utf8")));
  const reviewed = reviewPlan(rawPlan, review, analysis, context);
  const generationFile = JSON.parse(readFileSync(need("--generation"), "utf8")) as { generation?: { segments: Parameters<typeof buildDocument>[0]["generated"] }; document?: unknown; review?: { verdict: string }; run?: { promptVersion: number } };

  // The document under review must be exactly what that chain produced: parsed, and rebuilt deterministically from its own generation.
  const stored = MaterialDocumentSchema.parse(generationFile.document);
  const rebuilt = buildDocument({ analysis, plan: reviewed.effective, context, generated: generationFile.generation?.segments ?? null, newBlockId: sequentialIds() });
  const input = { analysis, plan: reviewed.effective, context, document: stored, validation: reviewed.effectiveValidation };
  const base = deterministicChecks(input);
  const deterministicReview = assembleReview(input, base);
  const reviewContext = buildPedagogicalReviewContext(input, reviewed);
  const execution = planExecutability(reviewed, analysis, context);
  const { prompt, parts } = reviewerRequestParts({ reviewContext });
  const schemaText = schemaInstructions(prompt.output.schema);
  const userText = parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const cacheable = estimateTokens(prompt.system.length + schemaText.length);
  const uncached = estimateTokens(userText.length) + 50;
  const worstCaseUsd = estimateCostUsd(selection.provider, selection.model, { inputTokens: uncached, cacheCreationInputTokens: cacheable, cachedInputTokens: 0, outputTokens: maxOutputTokens });
  const forbidden = scanForbidden(`${prompt.system}\n${schemaText}\n${userText}`);

  console.log("Pre-flight (sin llamadas)");
  console.log(`  análisis: v${analysis.schema_version} producido por ${producedBy.prompt} · documento ${stored.pages.length} páginas, huella ${fingerprint(stored).slice(0, 12)} · reconstruido idéntico: ${fingerprint(rebuilt) === fingerprint(stored) ? "sí" : "NO"}`);
  console.log(`  revisión determinista previa: ${deterministicReview.verdict} (guardada: ${generationFile.review?.verdict ?? "?"}) · ${base.filter((c) => c.status === "WARN").map((c) => c.check).join(", ") || "sin WARN"}`);
  console.log(`  decisiones: ${execution.decisions.map((d) => `${d.id}:${d.outcome}/${d.route ?? "—"}`).join(" ")}`);
  console.log(`  revisor: ${prompt.key}@v${prompt.version} · esquema ${prompt.output.name} v${prompt.schemaVersion} · alias ${selection.alias} · ${selection.provider}:${selection.model} · esfuerzo ${selection.effort}`);
  console.log(`  contexto de revisión: ${reviewContext.document.blocks.length} bloques · debe responder ${reviewContext.review_scope.must_answer.join(", ")} · objetivos semánticos ${JSON.stringify(reviewContext.review_scope.required_targets)} · referencias internas ${reviewContext.internal_reference_only.length} · huella ${fingerprint(reviewContext).slice(0, 12)}`);
  console.log(`  tamaños: prompt ${prompt.system.length} car. · esquema ${schemaText.length} car. · entrada ${userText.length} car. → ≈ ${cacheable} tokens de bloque en caché + ${uncached} de entrada`);
  console.log(`  diagnóstico/PII: ${forbidden.length === 0 ? "ninguno" : forbidden.join(", ")}`);
  console.log(`  peor caso (caché fría, salida máxima ${maxOutputTokens}): $${worstCaseUsd?.toFixed(4) ?? "?"} · presupuesto $${budget.toFixed(2)}`);

  const blockers: string[] = [];
  if (!isEvidenceV2(evidence)) blockers.push("la evidencia del planner no es la de planner v2");
  else blockers.push(...evidenceIntactV2(evidence as unknown as FrozenEvidenceV2, rawPlan, analysis, context));
  if (analysis.schema_version !== 3 || producedBy.prompt !== "material_analyzer@v3") blockers.push("el análisis no es v3 producido por material_analyzer@v3");
  if (generationFile.run?.promptVersion !== 2) blockers.push("el documento no lo generó material_generator@v2");
  if (fingerprint(rebuilt) !== fingerprint(stored)) blockers.push("el documento guardado no es el que reconstruye su propia generación");
  if (execution.blockers.length > 0) blockers.push(...execution.blockers);
  if (forbidden.length > 0) blockers.push("la entrada contiene diagnóstico o datos personales");
  if (!reviewContext.internal_reference_only.every((r) => r.use === "internal_reference_only")) blockers.push("una respuesta inferida no está marcada como referencia interna");
  if (worstCaseUsd === null) blockers.push("el modelo no tiene precio conocido");
  else if (worstCaseUsd > budget) blockers.push(`el peor caso ($${worstCaseUsd.toFixed(4)}) supera el presupuesto ($${budget.toFixed(2)})`);
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
    const { response, run } = await callReviewer({ reviewContext, selection, provider, maxOutputTokens });
    const parsed = parseReviewerResponse(response);
    let tail: Record<string, unknown> = {};
    if (parsed.outcome === "ok") {
      const draft = findingsToDraft(parsed.findings);
      const merged = buildReviewScoped(input, draft, reviewed.raw.decisions.map((d) => d.id));
      tail = { findings: parsed.findings, draft, finalReview: merged.review, rejected: merged.rejected, pending: merged.pending };
    }
    result = { response: { text: response.text, stopReason: response.stopReason, model: response.model }, run, parse: parsed, ...tail };
  } catch (error) {
    const failure = toAIError(error);
    result = { error: { code: failure.code, message: redactSecrets(failure.message) } };
  }

  const startedAt = new Date().toISOString();
  const out = {
    version: 1,
    kind: "reviewer-experiment",
    startedAt,
    label,
    descriptor: { provider: selection.provider, alias: selection.alias, model: selection.model, effort: selection.effort, prompt: `${prompt.key}@v${prompt.version}`, schema: `${prompt.output.name}@${prompt.schemaVersion}`, contextPolicy: policy, maxOutputTokens, budget },
    documentFingerprint: fingerprint(stored),
    deterministicReview,
    execution,
    reviewContext,
    preflight: { cacheableTokens: cacheable, uncachedInputTokens: uncached, worstCaseUsd, systemChars: prompt.system.length, schemaChars: schemaText.length, userChars: userText.length },
    ...result,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `${startedAt.replace(/[:.]/g, "-")}-${label}.json`);
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`Resultado guardado (privado): ${path.relative(process.cwd(), target)}`);
  const run = (result as { run?: { inputTokens: number; cacheCreationInputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedCostUsd: number | null; latencyMs: number } }).run;
  if (run) console.log(`  tokens: entrada ${run.inputTokens} · caché escrita ${run.cacheCreationInputTokens} · caché leída ${run.cachedInputTokens} · salida ${run.outputTokens} · coste $${run.estimatedCostUsd?.toFixed(6)} · ${(run.latencyMs / 1000).toFixed(1)} s`);
  const parseOutcome = (result as { parse?: { outcome: string } }).parse?.outcome;
  if (parseOutcome && parseOutcome !== "ok") console.log(`  parseo: ${parseOutcome}`);
  const final = (result as { finalReview?: { verdict: string; checks: Array<{ check: string; status: string; method: string }> } }).finalReview;
  if (final) console.log(`  veredicto: ${final.verdict} · ${final.checks.map((c) => `${c.check}:${c.status}(${c.method})`).join(" ")}`);
  if ("error" in result) console.log(`  error: ${(result as { error: { code: string } }).error.code}`);
}

void main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
