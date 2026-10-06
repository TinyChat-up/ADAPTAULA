/**
 * ONE real call with a tiny worksheet, to prove the whole integration before spending on a benchmark:
 * credentials, request shape, document input, structured output, Zod validation, the `ai_runs` row (real migrations on an
 * in-memory PGlite) and the cost estimate. Costs a few cents.
 *
 *   pnpm eval:analysis:sanity -- --yes     real call
 *   pnpm eval:analysis:sanity -- --mock    free: checks the script itself with the offline provider
 *   add `--prompt-version 2` to exercise material_analyzer@v2 (MaterialAnalysis v3)
 */
import { ANALYSIS_DEFAULTS } from "@/lib/ai/config";
import { estimateCostUsd } from "@/lib/ai/costs";
import { analyzeMaterialFile } from "@/lib/ai/pipeline/analyze";
import { toAiRunRow } from "@/lib/ai/run-record";
import type { AIRunRecord } from "@/lib/ai/types";
import { redactSecrets } from "@/lib/security/redact";
import { as, createTestDb, createUser } from "../../tests/db/harness";
import { buildPdf } from "./fixtures";
import { makeProvider, resolveAnalyzer, resolveSelection, worstCaseCostUsd, type Env } from "./harness";
import { usd } from "./report";

const BUDGET_USD = 0.2;

async function main() {
  const argv = process.argv.slice(2);
  const mock = argv.includes("--mock");
  const env = process.env as Env & { AI_ANALYSIS_PROMPT_VERSION?: string };
  const selection = resolveSelection({ mock, model: null, effort: null }, env);
  const versionFlag = argv.indexOf("--prompt-version");
  const analyzer = resolveAnalyzer(versionFlag >= 0 ? Number(argv[versionFlag + 1]) : null, env);

  const pdf = await buildPdf([
    [
      { t: "title", text: "Ficha de prueba. Las fracciones" },
      { t: "exercise", n: "1", text: "Calcula 1/2 + 1/4." },
      { t: "answer-lines", count: 1 },
      { t: "exercise", n: "2", text: "Colorea 3/4 del triangulo." },
      { t: "figure", kind: "triangle" },
    ],
  ]);

  const worst = worstCaseCostUsd(selection, { files: 1, pages: 1 });
  console.log(`Comprobación de integración · proveedor: ${selection.provider} · modelo: ${selection.model} · esfuerzo: ${selection.effort}\n  coste máximo estimado: ${usd(worst)} (tope: $${BUDGET_USD})\n`);
  if (!mock) {
    if (worst === null || worst > BUDGET_USD) {
      console.error("No se puede garantizar el tope de coste con este modelo. No se llama al proveedor.");
      process.exit(2);
    }
    if (!argv.includes("--yes")) {
      console.error("Esto hace UNA llamada real y cuesta unos céntimos. Repite con --yes.");
      process.exit(2);
    }
  }

  const runs: AIRunRecord[] = [];
  const outcome = await analyzeMaterialFile({
    analyzer,
    file: { kind: "pdf", data: pdf },
    pageCount: 1,
    teacherContext: {},
    selection,
    provider: makeProvider(selection, env),
    maxRepairAttempts: 0, // the single call under test: no repair, no regeneration
    maxOutputTokens: ANALYSIS_DEFAULTS.maxOutputTokens,
    deadlineAt: Date.now() + ANALYSIS_DEFAULTS.jobDeadlineMs,
    onRun: (run) => void runs.push(run),
  });

  const run = runs[0]!;
  const db = await createTestDb();
  const user = await createUser(db, "sanity@example.com");
  const material = await db.query<{ id: string }>(
    "insert into public.materials (workspace_id, created_by, title, source_type, status) values ($1, $2, 'Sanity', 'pdf', 'analyzed') returning id",
    [user.workspaceId, user.id],
  );
  const row = toAiRunRow(run, { workspaceId: user.workspaceId, jobId: null, materialId: material.rows[0]!.id });
  const columns = Object.keys(row);
  await as(db, "service_role", null, () =>
    db.query(`insert into public.ai_runs (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row)),
  );
  const stored = await db.query<{ status: string; input_tokens: number; output_tokens: number; estimated_cost_usd: string | null; model: string; latency_ms: number; prompt_version: number }>(
    "select status, input_tokens, output_tokens, estimated_cost_usd, model, latency_ms, prompt_version from public.ai_runs where material_id = $1",
    [material.rows[0]!.id],
  );
  const saved = stored.rows[0];

  const expectedCost = estimateCostUsd(selection.provider, run.model, { inputTokens: run.inputTokens, outputTokens: run.outputTokens, cachedInputTokens: run.cachedInputTokens, cacheCreationInputTokens: run.cacheCreationInputTokens });
  const checks: Array<[string, boolean, string]> = [
    ["autenticación y petición aceptadas por el proveedor", runs.length === 1, `${runs.length} llamada(s)`],
    ["entrada multimodal (PDF) procesada", run.inputTokens > 0, `${run.inputTokens} tokens de entrada`],
    ["salida estructurada válida (Zod borrador + almacenado)", outcome.meta.schema_version === analyzer.schemaVersion && outcome.canonical.schema_version === 3, `${outcome.canonical.activities.length} actividades, ${outcome.canonical.visuals.length} elementos visuales`],
    ["la llamada terminó completa (sin truncar ni rechazar)", run.status === "success", run.status],
    ["modelo que respondió", run.model.length > 0, run.model],
    ["fila de ai_runs insertada con los permisos de service_role", saved?.status === "success" && saved.input_tokens === run.inputTokens && saved.output_tokens === run.outputTokens, saved ? `estado ${saved.status}, ${saved.input_tokens}/${saved.output_tokens} tokens` : "no encontrada"],
    ["coste estimado conocido y coherente con la tabla de precios", selection.provider === "mock" ? run.estimatedCostUsd === 0 : run.estimatedCostUsd !== null && run.estimatedCostUsd === expectedCost && Number(saved?.estimated_cost_usd) === run.estimatedCostUsd, usd(run.estimatedCostUsd, 6)],
    ["latencia registrada", run.latencyMs > 0 || selection.provider === "mock", `${(run.latencyMs / 1000).toFixed(1)} s`],
    ["procedencia en analysis_meta", outcome.meta.provider === selection.provider && outcome.meta.cache_hit === false && outcome.meta.forced_reanalysis === false, `${outcome.meta.provider}:${outcome.meta.model} · prompt v${outcome.meta.prompt_version} · esquema v${outcome.meta.schema_version}`],
  ];
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "✓" : "✗"} ${name} — ${detail}`);
    if (!ok) failed += 1;
  }
  console.log(`\nTokens: entrada ${run.inputTokens} · escritos en caché ${run.cacheCreationInputTokens} · leídos de caché ${run.cachedInputTokens} · salida ${run.outputTokens} · coste ${usd(run.estimatedCostUsd, 6)} · latencia ${(run.latencyMs / 1000).toFixed(1)} s`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? `${error.name}: ${error.message}` : "error desconocido"));
  // The provider's own explanation (status and message, never credentials) is what tells a bad request from a bad setup.
  const cause = error instanceof Error ? (error.cause as { status?: number; message?: string } | undefined) : undefined;
  if (cause?.message) console.error(redactSecrets(`  causa del proveedor${cause.status ? ` (HTTP ${cause.status})` : ""}: ${cause.message}`.slice(0, 1200)));
  process.exit(2);
});
