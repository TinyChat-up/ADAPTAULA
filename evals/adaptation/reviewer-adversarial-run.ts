/**
 * Adversarial eval of the pedagogical reviewer (docs/ADAPTATION.md § Revisor). ONE real call to `pedagogical_reviewer@v1` on a
 * deterministic adversarial COPY of the real Bachillerato MaterialDocument. Nothing upstream runs (no analysis, planner or
 * generator), nothing is repaired or regenerated, the historical document, plan, generation and review are never written.
 *
 *   --freeze                         build the base and the adversarial copy, write the manifest, the expectations and the lock (no call, no cost)
 *   (default)                        pre-flight only: verifies the lock, builds the real ReviewContext, prices the worst case
 *   --yes --budget 0.05              the single real call, scored with the frozen rules
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { reviewPlan } from "@/lib/adaptation/plan-review";
import { assembleReview, deterministicChecks } from "@/lib/adaptation/review";
import { buildPedagogicalReviewContext } from "@/lib/adaptation/review-context";
import { buildReviewScoped, callReviewer, findingsToDraft, parseReviewerResponse, reviewerRequestParts } from "@/lib/adaptation/reviewer";
import { estimateCostUsd } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { schemaInstructions } from "@/lib/ai/providers/anthropic";
import { createProvider } from "@/lib/ai/router";
import { redactSecrets } from "@/lib/security/redact";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";
import { PlanReviewSchema } from "@/lib/schemas/plan-review";
import { loadRawPlan } from "./generator-lib";
import { buildExperimentContext, estimateTokens, loadStoredAnalysis, scanForbidden } from "./planner-lib";
import { ADVERSARIAL_VERSION, MUTATIONS, buildAdversarialCopy, deterministicDetection, scoreMutations, type AdversarialSource } from "./reviewer-adversarial";

const HERE = import.meta.dirname;
const EVIDENCE = path.resolve(HERE, "evidence");
const PRIVATE = path.resolve(HERE, "private/adversarial");
const OUT_DIR = path.resolve(HERE, "private/results");
const FILES = {
  manifest: path.join(EVIDENCE, "reviewer-adversarial-bachillerato-manifest.json"),
  expectations: path.join(EVIDENCE, "reviewer-adversarial-bachillerato-expectations.json"),
  lock: path.join(EVIDENCE, "reviewer-adversarial-bachillerato-lock.json"),
};
// Historical sources: read only.
const SRC = {
  analysis: path.resolve(HERE, "../material-analysis/private/results/2026-10-05T10-25-33-707Z-anthropic-claude-sonnet-5-5.json"),
  plan: path.resolve(HERE, "private/results/2026-10-05T12-39-47-391Z-planner-v1-bachillerato-ejecutivas.json"),
  review: path.resolve(HERE, "evidence/review-bachillerato.json"),
  generation: path.resolve(HERE, "private/results/2026-10-05T13-11-57-217Z-generator-v2-bachillerato-revisado.json"),
  plannerEvidence: path.resolve(HERE, "evidence/planner-v1-bachillerato.json"),
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const fileSha = (file: string) => sha(readFileSync(file, "utf8"));
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

/** The real Bachillerato document, reconstructed from its own history and checked against it. Anything else stops the experiment. */
function loadBase(): { source: AdversarialSource; problems: string[] } {
  const { analysis, producedBy } = loadStoredAnalysis(SRC.analysis);
  const context = buildExperimentContext(analysis, "accessibility", 1);
  const rawPlan = loadRawPlan(SRC.plan);
  const review = PlanReviewSchema.parse(JSON.parse(readFileSync(SRC.review, "utf8")));
  const generation = JSON.parse(readFileSync(SRC.generation, "utf8")) as { generation: { segments: Parameters<typeof buildDocument>[0]["generated"] }; document: unknown; run: { promptVersion: number } };
  const document = MaterialDocumentSchema.parse(generation.document);
  const evidence = JSON.parse(readFileSync(SRC.plannerEvidence, "utf8")) as { run: { analysis_fingerprint: string; context_fingerprint: string; raw_plan_fingerprint: string } };
  const reviewed = reviewPlan(rawPlan, review, analysis, context);
  const rebuilt = buildDocument({ analysis, plan: reviewed.effective, context, generated: generation.generation.segments, newBlockId: sequentialIds() });

  const problems: string[] = [];
  if (producedBy.prompt !== "material_analyzer@v3") problems.push("el análisis no lo produjo material_analyzer@v3");
  if (generation.run.promptVersion !== 2) problems.push("el documento no lo generó material_generator@v2");
  if (fingerprint(analysis) !== evidence.run.analysis_fingerprint) problems.push("el análisis no es el congelado");
  if (fingerprint(context) !== evidence.run.context_fingerprint) problems.push("el contexto no es el congelado");
  if (fingerprint(rawPlan) !== evidence.run.raw_plan_fingerprint) problems.push("el plan bruto no es el congelado");
  if (fingerprint(rebuilt) !== fingerprint(document)) problems.push("el documento guardado no es el que reconstruye su propia generación");
  return { source: { analysis, context, rawPlan, review, document }, problems };
}

function freeze() {
  const { source, problems } = loadBase();
  if (problems.length > 0) throw new Error(`No hay una reconstrucción fiable del documento base: ${problems.join("; ")}`);
  const baseFingerprint = fingerprint(source.document);
  const copy = buildAdversarialCopy(source);
  const detection = deterministicDetection(source);
  const counts = (id: string) => (detection.find((d) => d.mutation_id === id)?.fails.length ?? 0) === 0;

  mkdirSync(PRIVATE, { recursive: true });
  writeFileSync(path.join(PRIVATE, "base-document.json"), JSON.stringify(source.document, null, 2));
  writeFileSync(path.join(PRIVATE, "adversarial-document.json"), JSON.stringify(copy.document, null, 2));
  writeFileSync(path.join(PRIVATE, "adversarial-plan.json"), JSON.stringify(copy.rawPlan, null, 2));
  writeFileSync(path.join(PRIVATE, "adversarial-plan-review.json"), JSON.stringify(copy.review, null, 2));

  const manifest = {
    version: ADVERSARIAL_VERSION,
    purpose: "Copia adversarial determinista del MaterialDocument real de Bachillerato (generator v2) para evaluar a pedagogical_reviewer@v1. Los históricos no se modifican.",
    source: { analysis_fingerprint: fingerprint(source.analysis), context_policy: 1, raw_plan_fingerprint: fingerprint(source.rawPlan), historical_review_fingerprint: source.review.plan_fingerprint, base_document_fingerprint: baseFingerprint },
    adversarial: { document_fingerprint: fingerprint(copy.document), plan_fingerprint: fingerprint(copy.rawPlan), added_blocks: copy.mutations.length, added_decisions: copy.mutations.map((m) => m.decision_id) },
    mutations: copy.mutations.map((m) => ({ mutation_id: m.mutation_id, risk: m.risk, target: m.target, block_id: m.block_id, decision_id: m.decision_id, support_kind: m.support_kind, block: m.block, intent: m.intent })),
    deterministic_detection: detection.map((d) => ({ ...d, counts_as_semantic_evidence: counts(d.mutation_id) })),
  };
  const expectations = {
    version: ADVERSARIAL_VERSION,
    note: "Congelado antes de la llamada. El scoring es estructural (check y objetivo del hallazgo), nunca por el texto del modelo.",
    expectations: copy.mutations.map((m) => ({ mutation_id: m.mutation_id, risk: m.risk, target: m.target, block_id: m.block_id, decision_id: m.decision_id, expected_checks: m.expected_checks, min_severity: m.min_severity, match: m.match })),
    scoring: {
      semantic_leak: "HIT = FAIL en answers_not_leaked sobre el bloque, la decisión o la actividad; PARTIAL = WARN; MISS = PASS o sin hallazgo",
      indirect_hint: "HIT = WARN o FAIL sobre el bloque/decisión en answers_not_leaked o functional_supports_applied; MISS = PASS o sin hallazgo",
      infantilization: "HIT = WARN o FAIL sobre el bloque/decisión en age_appropriate o no_infantilization; PARTIAL = hallazgo adverso sin objetivo; MISS = PASS en ambos",
      semantic_redundancy: "HIT = WARN en functional_supports_applied sobre el bloque/decisión; PARTIAL = FAIL (excesivo) o WARN sin objetivo; MISS = PASS",
      safe_control: "CORRECT = sin hallazgo adverso sobre el bloque/decisión; FALSE_POSITIVE = WARN; TOO_STRICT = FAIL",
    },
    material_failures: ["fuga semántica → PASS", "pista resolutiva → PASS sin observación", "infantilización → PASS en age y no_infantilization", "inventa un problema grave en el control seguro", "intenta cerrar un WARN estructural", "salida inválida"],
  };
  writeFileSync(FILES.manifest, JSON.stringify(manifest, null, 2));
  writeFileSync(FILES.expectations, JSON.stringify(expectations, null, 2));
  const lock = {
    frozen_at: new Date().toISOString(),
    manifest_sha256: fileSha(FILES.manifest),
    expectations_sha256: fileSha(FILES.expectations),
    base_document_fingerprint: baseFingerprint,
    adversarial_document_fingerprint: fingerprint(copy.document),
  };
  writeFileSync(FILES.lock, JSON.stringify(lock, null, 2));
  console.log("Congelado (sin llamadas).");
  console.log(`  documento base ${baseFingerprint.slice(0, 12)} · adversarial ${lock.adversarial_document_fingerprint.slice(0, 12)} · ${copy.mutations.length} bloques añadidos`);
  for (const d of manifest.deterministic_detection) console.log(`  ${d.mutation_id}: cambia ${d.changed.map((c) => `${c.check} ${c.from}→${c.to}`).join(", ") || "ningún check"} · FAIL determinista: ${d.fails.join(",") || "no"} · cuenta como evidencia semántica: ${d.counts_as_semantic_evidence ? "sí" : "NO"}`);
  console.log(`  lock: manifest ${lock.manifest_sha256.slice(0, 12)} · expectativas ${lock.expectations_sha256.slice(0, 12)}`);
}

async function main() {
  if (process.argv.includes("--freeze")) return freeze();
  const budget = Number(arg("--budget") ?? "0.05");
  const maxOutputTokens = Number(arg("--max-output-tokens") ?? "2500");
  const go = process.argv.includes("--yes");

  const lock = JSON.parse(readFileSync(FILES.lock, "utf8")) as { frozen_at: string; manifest_sha256: string; expectations_sha256: string; base_document_fingerprint: string; adversarial_document_fingerprint: string };
  const { source, problems } = loadBase();
  const copy = buildAdversarialCopy(source);
  const detection = deterministicDetection(source);
  const env = process.env as ModelEnv & { ANTHROPIC_API_KEY?: string };
  const selection = resolveModel("STANDARD", env);

  const input = { analysis: source.analysis, plan: copy.reviewed.effective, context: source.context, document: copy.document, validation: copy.reviewed.effectiveValidation };
  const reviewContext = buildPedagogicalReviewContext(input, copy.reviewed);
  const baseChecks = deterministicChecks(input);
  const { prompt, parts } = reviewerRequestParts({ reviewContext });
  const schemaText = schemaInstructions(prompt.output.schema);
  const userText = parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const cacheable = estimateTokens(prompt.system.length + schemaText.length);
  const uncached = estimateTokens(userText.length) + 50;
  const worstCaseUsd = estimateCostUsd(selection.provider, selection.model, { inputTokens: uncached, cacheCreationInputTokens: cacheable, cachedInputTokens: 0, outputTokens: maxOutputTokens });
  const forbidden = scanForbidden(`${prompt.system}\n${schemaText}\n${userText}`);
  const leakedExpectations = [...MUTATIONS.map((m) => m.mutation_id), "adversarial", "expected_checks", "min_severity", "safe_control", "semantic_leak"].filter((w) => userText.toLowerCase().includes(w.toLowerCase()));

  console.log("Pre-flight (sin llamadas)");
  console.log(`  base real reconstruida: ${problems.length === 0 ? "sí, idéntica a su historia" : `NO (${problems.join("; ")})`} · huella base ${fingerprint(source.document).slice(0, 12)} · adversarial ${fingerprint(copy.document).slice(0, 12)}`);
  console.log(`  congelado: ${lock.frozen_at} · manifest ${fileSha(FILES.manifest) === lock.manifest_sha256 ? "intacto" : "MODIFICADO"} · expectativas ${fileSha(FILES.expectations) === lock.expectations_sha256 ? "intactas" : "MODIFICADAS"}`);
  for (const d of detection) console.log(`  determinista · ${d.mutation_id}: ${d.changed.map((c) => `${c.check} ${c.from}→${c.to}`).join(", ") || "ningún check"}${d.fails.length ? ` · FAIL: ${d.fails.join(",")} (no cuenta)` : ""}`);
  console.log(`  checks deterministas del documento adversarial: ${baseChecks.filter((c) => c.status !== "PASS").map((c) => `${c.check}:${c.status}`).join(" ") || "todos PASS"}`);
  console.log(`  contexto de revisión: ${reviewContext.document.blocks.length} bloques · debe responder ${reviewContext.review_scope.must_answer.join(", ")} · objetivos semánticos ${JSON.stringify(reviewContext.review_scope.required_targets)} · referencias internas ${reviewContext.internal_reference_only.length} · huella ${fingerprint(reviewContext).slice(0, 12)}`);
  console.log(`  tamaños: prompt ${prompt.system.length} car. · esquema ${schemaText.length} car. · entrada ${userText.length} car. → ≈ ${cacheable} tokens de bloque en caché + ${uncached} de entrada`);
  console.log(`  diagnóstico/PII: ${forbidden.length === 0 ? "ninguno" : forbidden.join(", ")} · expectativas visibles al modelo: ${leakedExpectations.length === 0 ? "ninguna" : leakedExpectations.join(", ")}`);
  console.log(`  peor caso (caché fría, salida máxima ${maxOutputTokens}): $${worstCaseUsd?.toFixed(4) ?? "?"} · presupuesto $${budget.toFixed(2)}`);

  const blockers: string[] = [...problems];
  if (fileSha(FILES.manifest) !== lock.manifest_sha256) blockers.push("el manifest ya no es el congelado");
  if (fileSha(FILES.expectations) !== lock.expectations_sha256) blockers.push("las expectativas ya no son las congeladas");
  if (fingerprint(source.document) !== lock.base_document_fingerprint) blockers.push("el documento base cambió");
  if (fingerprint(copy.document) !== lock.adversarial_document_fingerprint) blockers.push("el documento adversarial no es el congelado");
  if (forbidden.length > 0) blockers.push("la entrada contiene diagnóstico o datos personales");
  if (leakedExpectations.length > 0) blockers.push("la entrada deja ver las expectativas");
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
      const merged = buildReviewScoped(input, draft, copy.reviewed.raw.decisions.map((d) => d.id));
      tail = { findings: parsed.findings, draft, finalReview: merged.review, rejected: merged.rejected, pending: merged.pending, scores: scoreMutations(copy.mutations, merged.review) };
    }
    result = { response: { text: response.text, stopReason: response.stopReason, model: response.model }, run, parse: parsed, ...tail };
  } catch (error) {
    const failure = toAIError(error);
    result = { error: { code: failure.code, message: redactSecrets(failure.message) } };
  }

  const startedAt = new Date().toISOString();
  const out = {
    version: 1,
    kind: "reviewer-adversarial-experiment",
    startedAt,
    lock,
    descriptor: { provider: selection.provider, alias: selection.alias, model: selection.model, effort: selection.effort, prompt: `${prompt.key}@v${prompt.version}`, schema: `${prompt.output.name}@${prompt.schemaVersion}`, maxOutputTokens, budget },
    mutations: copy.mutations,
    deterministicBefore: { checks: assembleReview(input, baseChecks).checks, detection },
    reviewContext,
    preflight: { cacheableTokens: cacheable, uncachedInputTokens: uncached, worstCaseUsd },
    ...result,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `${startedAt.replace(/[:.]/g, "-")}-reviewer-adversarial-bachillerato.json`);
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`Resultado guardado (privado): ${path.relative(process.cwd(), target)}`);
  const run = (result as { run?: { inputTokens: number; cacheCreationInputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedCostUsd: number | null; latencyMs: number } }).run;
  if (run) console.log(`  tokens: entrada ${run.inputTokens} · caché escrita ${run.cacheCreationInputTokens} · caché leída ${run.cachedInputTokens} · salida ${run.outputTokens} · coste $${run.estimatedCostUsd?.toFixed(6)} · ${(run.latencyMs / 1000).toFixed(1)} s`);
  const parseOutcome = (result as { parse?: { outcome: string } }).parse?.outcome;
  if (parseOutcome && parseOutcome !== "ok") console.log(`  parseo: ${parseOutcome}`);
  const scores = (result as { scores?: Array<{ mutation_id: string; detection: string; severity: string | null }> }).scores;
  if (scores) for (const s of scores) console.log(`  ${s.mutation_id}: ${s.detection}${s.severity ? ` (${s.severity})` : ""}`);
  if ("error" in result) console.log(`  error: ${(result as { error: { code: string } }).error.code}`);
}

void main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
