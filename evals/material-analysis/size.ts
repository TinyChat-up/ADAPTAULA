/**
 * Offline benchmark of the size of MaterialAnalysis v2 vs v3 and the theoretical saving. It never calls an API.
 *
 *   pnpm eval:analysis:size                       built-in synthetic worksheet + prompt/schema blocks
 *   pnpm eval:analysis:size -- --cases cases.json real runs to price (kept outside git, see below)
 *   pnpm eval:analysis:size -- --chars-per-token 3.2
 *
 * cases.json: [{ "label": "…", "file": "path/to/stored-analysis.json", "model": "claude-sonnet-5-5",
 *                "input": 3369, "cacheWrite": 6345, "cacheRead": 0, "output": 4928 }]   (tokens as recorded in ai_runs)
 *
 * Tokens are ESTIMATED from characters with reproducible ratios: good to compare two contracts, not a bill.
 *  - the cached system + schema block uses the ratio MEASURED on the real run (JSON schema text is token-dense);
 *  - the JSON a model emits uses DEFAULT_CHARS_PER_TOKEN (3.5), overridable with --chars-per-token.
 */
import { readFileSync } from "node:fs";
import { getMaterialAnalyzer } from "@/lib/ai/prompts";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { normalizeAnalysisV2 } from "@/lib/analysis/normalize-v2";
import { upgradeAnalysisV2 } from "@/lib/analysis/upgrade";
import { MaterialAnalysisDraftSchema } from "@/lib/schemas/material-analysis";
import { MaterialAnalysisSchema as MaterialAnalysisSchemaV2 } from "@/lib/schemas/material-analysis-v2";
import { usd } from "./report";
import { DEFAULT_CHARS_PER_TOKEN, calibrateCharsPerToken, estimateOptimizedCost, projectDraftV2, projectDraftV3, reduction, schemaBlockChars, sizeOf } from "./size-lib";
import { worksheetDraftV2, worksheetDraftV3 } from "./synthetic-analyses";

/** Tokens the real run cached for v1's system + schema block (ai_runs.cache_creation_input_tokens, 2026-10-04). */
const MEASURED_V1_BLOCK_TOKENS = 6345;

interface Case { label: string; file: string; model: string; input: number; cacheWrite: number; cacheRead: number; output: number }

const pct = (value: number) => `${(value * 100).toFixed(1)} %`;
const num = (value: number) => value.toLocaleString("es-ES");

function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

  const v1 = getMaterialAnalyzer(1);
  const v2 = getMaterialAnalyzer(2);
  const v3 = getMaterialAnalyzer(3);
  const blocks = { v1: schemaBlockChars(v1), v2: schemaBlockChars(v2), v3: schemaBlockChars(v3) };
  const blockRatio = calibrateCharsPerToken(blocks.v1.total, MEASURED_V1_BLOCK_TOKENS);
  const ratio = flag("--chars-per-token") ? Number(flag("--chars-per-token")) : DEFAULT_CHARS_PER_TOKEN;

  console.log("Calibración");
  console.log(`  bloque system + esquema de v1: ${num(blocks.v1.total)} caracteres = ${num(MEASURED_V1_BLOCK_TOKENS)} tokens escritos en caché (medido) → ${blockRatio.toFixed(2)} caracteres/token (se usa para los bloques)`);
  console.log(`  JSON de salida: ${ratio.toFixed(2)} caracteres/token${flag("--chars-per-token") ? " (forzado)" : " (estimación por defecto)"}\n`);

  const blockV1 = Math.round(blocks.v1.total / blockRatio);
  const blockV2 = Math.round(blocks.v2.total / blockRatio);
  const blockReduction = reduction(blocks.v1.total, blocks.v2.total);
  console.log("Bloque cacheado por llamada (system + esquema JSON que recibe el modelo)");
  console.log("| | system | esquema | total caracteres | tokens estimados |\n|---|---:|---:|---:|---:|");
  console.log(`| prompt v1 / esquema v2 | ${num(blocks.v1.system)} | ${num(blocks.v1.schema)} | ${num(blocks.v1.total)} | ${num(blockV1)} |`);
  console.log(`| prompt v2 / esquema v3 | ${num(blocks.v2.system)} | ${num(blocks.v2.schema)} | ${num(blocks.v2.total)} | ${num(blockV2)} |`);
  console.log(`| prompt v3 / esquema v3 | ${num(blocks.v3.system)} | ${num(blocks.v3.schema)} | ${num(blocks.v3.total)} | ${num(Math.round(blocks.v3.total / blockRatio))} |`);
  console.log(`  prompt v2 frente a v1: ${pct(blockReduction)} · prompt v3 frente a v2: ${blocks.v3.total >= blocks.v2.total ? "+" : ""}${pct(blocks.v3.total / blocks.v2.total - 1)} (${blocks.v3.total - blocks.v2.total >= 0 ? "+" : ""}${num(blocks.v3.total - blocks.v2.total)} caracteres)\n`);

  // Synthetic worksheet: authored twice, so v3 includes the information v2 could not hold (answer areas, chart data, constraints).
  const storedV2 = normalizeAnalysisV2(worksheetDraftV2(), { pageCount: 2 }).analysis;
  const authoredV2 = sizeOf(projectDraftV2(storedV2), ratio);
  const authoredV3 = sizeOf(MaterialAnalysisDraftSchema.parse(worksheetDraftV3()), ratio);
  const equivalent = sizeOf(projectDraftV3(upgradeAnalysisV2(storedV2).analysis), ratio);
  const authoredReduction = reduction(authoredV2.chars, authoredV3.chars);
  console.log("Salida que debe producir el modelo (JSON compacto): hoja sintética de 2 páginas");
  console.log("| Contrato | caracteres | tokens estimados | reducción |\n|---|---:|---:|---:|");
  console.log(`| v2 (prompt v1) | ${num(authoredV2.chars)} | ${num(authoredV2.tokens)} | — |`);
  console.log(`| v3 con la información nueva (prompt v2) | ${num(authoredV3.chars)} | ${num(authoredV3.tokens)} | ${pct(authoredReduction)} |`);
  console.log(`| v3 con el contenido equivalente al de v2 | ${num(equivalent.chars)} | ${num(equivalent.tokens)} | ${pct(reduction(authoredV2.chars, equivalent.chars))} |`);
  // Sanity: the authored v3 draft must normalize cleanly, or the comparison would be of an invalid answer.
  normalizeAnalysis(MaterialAnalysisDraftSchema.parse(worksheetDraftV3()), { pageCount: 2 });

  const casesFile = flag("--cases");
  if (!casesFile) return;
  const cases = JSON.parse(readFileSync(casesFile, "utf8")) as Case[];

  console.log("\nCasos reales (análisis v2 ya guardados): salida v2 vs v3 y coste teórico");
  console.log("| Caso | v2 tokens JSON | v3 mismo contenido (conservador) | v3 como la hoja redactada a mano* (optimista) | razonamiento (resto de la salida) |\n|---|---:|---:|---:|---:|");
  const rows: string[] = [];
  for (const c of cases) {
    const stored = MaterialAnalysisSchemaV2.parse(JSON.parse(readFileSync(c.file, "utf8")));
    const v2Size = sizeOf(projectDraftV2(stored), ratio);
    const v3Equivalent = sizeOf(projectDraftV3(upgradeAnalysisV2(stored).analysis), ratio);
    const run = { model: c.model, input: c.input, cacheWrite: c.cacheWrite, cacheRead: c.cacheRead, output: c.output };
    // Conservative: the reduction measured on THIS analysis re-expressed in v3 (the same information). Optimistic: the reduction of
    // the hand-authored v3 worksheet, which also carries the new information but is deliberately minimal.
    const conservative = estimateOptimizedCost(run, v2Size.tokens, reduction(v2Size.chars, v3Equivalent.chars), blockReduction);
    const optimistic = estimateOptimizedCost(run, v2Size.tokens, authoredReduction, blockReduction);
    console.log(`| ${c.label} | ${num(v2Size.tokens)} | ${num(v3Equivalent.tokens)} (${pct(reduction(v2Size.chars, v3Equivalent.chars))}) | ${num(Math.round(v2Size.tokens * (1 - authoredReduction)))} (${pct(authoredReduction)}) | ${num(conservative.reasoningTokens)} |`);
    rows.push(
      `| ${c.label} | ${usd(conservative.current)} | ${usd(conservative.outputOnly)} (${pct(reduction(conservative.current!, conservative.outputOnly!))}) – ${usd(optimistic.outputOnly)} (${pct(reduction(optimistic.current!, optimistic.outputOnly!))}) | ${usd(conservative.outputAndBlock)} (${pct(reduction(conservative.current!, conservative.outputAndBlock!))}) – ${usd(optimistic.outputAndBlock)} (${pct(reduction(optimistic.current!, optimistic.outputAndBlock!))}) |`,
    );
  }
  console.log("  * reducción de la hoja sintética redactada a mano en v3: incluye la información nueva pero es deliberadamente mínima (tope optimista).\n");
  console.log("Coste teórico por análisis (mismos tokens de entrada, escritura en caché y modelo; el razonamiento se mantiene)");
  console.log("| Caso | coste real v2 | v3 solo salida (conservador – optimista) | v3 salida + bloque de esquema más pequeño (conservador – optimista) |\n|---|---:|---:|---:|");
  for (const row of rows) console.log(row);
  console.log("\nEXTRAPOLACIÓN TEÓRICA: no hay ninguna llamada nueva detrás de estas cifras. El razonamiento del modelo se supone constante y los tokens se estiman por caracteres.");
}

main();
