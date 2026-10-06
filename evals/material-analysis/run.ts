/**
 * Material-analysis evals: run the REAL analysis pipeline over synthetic worksheets and score the output.
 *
 *   pnpm eval:analysis -- --yes                              all cases with the configured model (spends API money)
 *   pnpm eval:analysis -- --case prim-mates-fracciones --case eso-bio-celula --budget 0.5 --yes
 *   pnpm eval:analysis -- --tag prompt-injection --yes
 *   pnpm eval:analysis -- --model openai:<id> --label comparison --yes   same file, prompt, schema and checks; another model
 *   pnpm eval:analysis -- --alias ECONOMY --yes              same file, prompt and schema; the model of another alias
 *   pnpm eval:analysis -- --prompt-version 2 --yes           material_analyzer@v2 (MaterialAnalysis v3) instead of the default
 *   pnpm eval:analysis -- --private --single-call --max-output-tokens 6900 --budget 0.10 --yes
 *                                                            ONE call per file with a hard output cap: the budget becomes a guarantee
 *   pnpm eval:analysis -- --private --yes                    your own anonymized worksheets in evals/material-analysis/private/
 *   pnpm eval:analysis:mock                                  harness check with the offline provider (free; expect failures)
 *   pnpm eval:analysis -- --dump-fixtures out/               write the PDFs to look at them (free)
 *
 * It is never part of `pnpm check`. See evals/material-analysis/README.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toAIError } from "@/lib/ai/errors";
import { redactSecrets } from "@/lib/security/redact";
import { CASES } from "./cases";
import { buildPdf } from "./fixtures";
import { analyzeCase, describeRun, makeProvider, resolveAnalyzer, resolveSelection, worstCaseCostUsd, type Env } from "./harness";
import { PROJECTION_NOTE, printAggregate, printCaseLine } from "./print";
import { runPrivate } from "./private-run";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { aggregate, projectCosts, usd, type CaseReport } from "./report";

interface Args {
  yes: boolean;
  mock: boolean;
  caseIds: string[];
  tags: string[];
  limit: number | null;
  budgetUsd: number;
  dumpFixtures: string | null;
  model: string | null;
  alias: string | null;
  promptVersion: number | null;
  effort: string | null;
  label: string | null;
  privateDir: string | null;
  /** Hard output cap per call (tokens). With the budget, it turns the worst-case estimate into a real ceiling. */
  maxOutputTokens: number | null;
  /** No repair and no regeneration: exactly one model call per file. */
  singleCall: boolean;
}

export const DEFAULT_PRIVATE_DIR = "evals/material-analysis/private";

function parseArgs(argv: string[]): Args {
  const args: Args = { yes: false, mock: false, caseIds: [], tags: [], limit: null, budgetUsd: 2, dumpFixtures: null, model: null, alias: null, promptVersion: null, effort: null, label: null, privateDir: null, maxOutputTokens: null, singleCall: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--yes") args.yes = true;
    else if (a === "--mock") args.mock = true;
    else if (a === "--case") args.caseIds.push(argv[++i] ?? "");
    else if (a === "--tag") args.tags.push(argv[++i] ?? "");
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--budget") args.budgetUsd = Number(argv[++i]);
    else if (a === "--model") args.model = argv[++i] ?? null;
    else if (a === "--alias") args.alias = argv[++i] ?? null;
    else if (a === "--prompt-version") args.promptVersion = Number(argv[++i]);
    else if (a === "--max-output-tokens") args.maxOutputTokens = Number(argv[++i]);
    else if (a === "--single-call") args.singleCall = true;
    else if (a === "--effort") args.effort = argv[++i] ?? null;
    else if (a === "--label") args.label = argv[++i] ?? null;
    else if (a === "--private") args.privateDir = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : DEFAULT_PRIVATE_DIR;
    else if (a === "--dump-fixtures") args.dumpFixtures = argv[++i] ?? "evals/results/fixtures";
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2).filter((a) => a !== "--"));
  const env = process.env as Env & { AI_ANALYSIS_PROMPT_VERSION?: string };
  const selection = resolveSelection({ mock: args.mock, model: args.model, alias: args.alias, effort: args.effort }, env);
  const analyzer = resolveAnalyzer(args.promptVersion, env);

  if (args.privateDir) {
    await runPrivate({ dir: args.privateDir, selection, analyzer, provider: () => makeProvider(selection, env), budgetUsd: args.budgetUsd, label: args.label, yes: args.yes, maxOutputTokens: args.maxOutputTokens, singleCall: args.singleCall });
    return;
  }

  let cases = CASES.filter((c) => (args.caseIds.length === 0 || args.caseIds.includes(c.id)) && (args.tags.length === 0 || args.tags.some((t) => c.tags.includes(t))));
  if (args.limit) cases = cases.slice(0, args.limit);
  if (cases.length === 0) {
    console.error("Ningún caso coincide con los filtros.");
    process.exit(2);
  }

  if (args.dumpFixtures) {
    mkdirSync(args.dumpFixtures, { recursive: true });
    for (const c of cases) writeFileSync(path.join(args.dumpFixtures, `${c.id}.pdf`), await buildPdf(c.pages));
    console.log(`${cases.length} PDF escritos en ${args.dumpFixtures}`);
    return;
  }

  const totalPages = cases.reduce((n, c) => n + c.pages.length, 0);
  const worstCase = worstCaseCostUsd(selection, { files: cases.length, pages: totalPages, ...(args.maxOutputTokens ? { maxOutputTokens: args.maxOutputTokens } : {}) });
  const descriptor = describeRun(selection, null, args.label, analyzer);
  console.log(
    `Evals de análisis de materiales\n  casos: ${cases.length} (${totalPages} páginas)\n  alias: ${selection.alias} · proveedor: ${selection.provider} · modelo: ${selection.model} · esfuerzo: ${selection.effort}\n  prompt: ${descriptor.prompt} · esquema v${descriptor.schemaVersion}\n  coste máximo estimado: ${usd(worstCase)} (presupuesto: $${args.budgetUsd})\n`,
  );

  if (selection.provider !== "mock") {
    if (worstCase === null) {
      console.error("No hay precio para este modelo: no se puede garantizar el presupuesto. Añádelo a src/lib/ai/costs.ts o usa otro modelo.");
      process.exit(2);
    }
    if (worstCase > args.budgetUsd) {
      console.error(`El coste máximo estimado (${usd(worstCase)}) supera el presupuesto ($${args.budgetUsd}). No se ejecuta nada: reduce los casos o sube --budget a conciencia.`);
      process.exit(2);
    }
    if (!args.yes) {
      console.error("Esto llamará al proveedor real y cuesta dinero. Revisa el coste estimado y repite con --yes para confirmarlo.");
      process.exit(2);
    }
  }
  const provider = makeProvider(selection, env);

  const reports: CaseReport[] = [];
  // The fixtures are synthetic, so the full analyses can be kept for a human to read next to the PDFs.
  const analyses: Array<{ id: string; analysis: MaterialAnalysis | null }> = [];
  let spent = 0;
  let realModel: string | null = null;
  for (const c of cases) {
    // Even the worst case of the NEXT file must fit in what is left.
    const nextWorst = worstCaseCostUsd(selection, { files: 1, pages: c.pages.length, ...(args.maxOutputTokens ? { maxOutputTokens: args.maxOutputTokens } : {}) }) ?? 0;
    if (selection.provider !== "mock" && spent + nextWorst > args.budgetUsd) {
      console.error(`\nDetenido antes de ${c.id}: lo gastado ($${spent.toFixed(4)}) más su peor caso (${usd(nextWorst)}) superaría el presupuesto ($${args.budgetUsd}).`);
      break;
    }
    const { report, analysis, realModel: model } = await analyzeCase({
      analyzer,
      id: c.id,
      title: c.title,
      stage: c.stage,
      file: { kind: "pdf", data: await buildPdf(c.pages) },
      pageCount: c.pages.length,
      selection,
      provider,
      expect: c.expect,
      ...(args.maxOutputTokens ? { maxOutputTokens: args.maxOutputTokens } : {}),
      ...(args.singleCall ? { singleCall: true } : {}),
    });
    realModel ??= model;
    spent += report.costUsd ?? 0;
    printCaseLine(report);
    reports.push(report);
    analyses.push({ id: c.id, analysis });
  }

  const agg = aggregate(reports);
  printAggregate(agg);

  const run = { ...describeRun(selection, realModel, args.label, analyzer), startedAt: descriptor.startedAt };
  const dir = "evals/results";
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${run.startedAt.replace(/[:.]/g, "-")}-${selection.provider}-${run.model}.json`);
  writeFileSync(file, JSON.stringify({ version: 1, kind: "synthetic", run, budgetUsd: args.budgetUsd, estimatedWorstCaseUsd: worstCase, aggregate: agg, projections: projectCosts(agg.avgCostUsd), projectionNote: PROJECTION_NOTE, results: reports, analyses }, null, 2));
  console.log(`\nDetalle: ${file}`);
  process.exit(agg.seriousErrors === 0 ? 0 : 1);
}

main().catch((error) => {
  const failure = toAIError(error);
  console.error(redactSecrets(error instanceof Error ? error.message : failure.code));
  process.exit(2);
});
