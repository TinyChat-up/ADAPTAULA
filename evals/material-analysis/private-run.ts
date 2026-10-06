import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AnalyzeFile } from "@/lib/ai/pipeline/analyze";
import type { AnalyzerDefinition } from "@/lib/ai/prompts";
import type { AIProvider, ImageMediaType, ModelSelection } from "@/lib/ai/types";
import { effectiveLimits, FILE_TYPES } from "@/lib/materials/config";
import { formatFromExtension, validateFileContent } from "@/lib/materials/file-validation";
import { inspectPdf } from "@/lib/materials/pdf";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { analyzeCase, describeRun, worstCaseCostUsd } from "./harness";
import { PROJECTION_NOTE, printAggregate, printCaseLine } from "./print";
import { aggregate, projectCosts, usd, type CaseReport } from "./report";

const TEMPLATE = path.join(import.meta.dirname, "human-review.template.json");
const EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);

interface PrivateFile {
  /** Opaque label for logs: the real name never reaches the terminal. */
  label: string;
  name: string;
  bytes: Uint8Array;
  file: AnalyzeFile;
  pages: number;
}

/**
 * Your own anonymized worksheets. Hard rules: the files and every output stay inside `dir` (git-ignored); the terminal
 * shows only an opaque label and metrics, never names or content; the bytes are validated like an upload.
 */
export async function runPrivate(options: {
  dir: string;
  selection: ModelSelection;
  analyzer: AnalyzerDefinition;
  provider: () => AIProvider;
  budgetUsd: number;
  label: string | null;
  yes: boolean;
  maxOutputTokens?: number | null;
  singleCall?: boolean;
}) {
  const { dir, selection, analyzer } = options;
  if (!existsSync(dir)) {
    console.error(`No existe ${dir}. Créalo y copia ahí 3–5 fichas anonimizadas (PDF, JPG, PNG o WEBP). Instrucciones: evals/material-analysis/README.md`);
    process.exit(2);
  }

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();
  if (names.length === 0) {
    console.error(`No hay fichas en ${dir}.`);
    process.exit(2);
  }

  const limits = effectiveLimits({ max_file_mb: 20, max_pages_per_material: 30 });
  const files: PrivateFile[] = [];
  for (const [index, name] of names.entries()) {
    const bytes = new Uint8Array(readFileSync(path.join(dir, name)));
    const label = `ficha-${String(index + 1).padStart(2, "0")} (${createHash("sha256").update(bytes).digest("hex").slice(0, 8)})`;
    const format = formatFromExtension(name);
    const content = format ? validateFileContent(bytes, format, limits) : null;
    if (!content?.ok) {
      console.error(`✗ ${label}: el archivo no es válido (${content ? content.code : "extensión no admitida"}). Se omite.`);
      continue;
    }
    if (content.kind === "pdf") {
      const inspection = await inspectPdf(bytes);
      if (!inspection.ok || inspection.pages > limits.maxPages) {
        console.error(`✗ ${label}: PDF ${inspection.ok ? "con demasiadas páginas" : "ilegible o cifrado"}. Se omite.`);
        continue;
      }
      files.push({ label, name, bytes, file: { kind: "pdf", data: bytes }, pages: inspection.pages });
    } else {
      files.push({ label, name, bytes, file: { kind: "image", mediaType: FILE_TYPES[content.format].mime as ImageMediaType, data: bytes }, pages: 1 });
    }
  }
  if (files.length === 0) process.exit(2);

  const totalPages = files.reduce((n, f) => n + f.pages, 0);
  const cap = options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {};
  const worstCase = worstCaseCostUsd(selection, { files: files.length, pages: totalPages, ...cap });
  const descriptor = describeRun(selection, null, options.label, analyzer);
  console.log(`Fichas privadas: ${files.length} (${totalPages} páginas)\n  proveedor: ${selection.provider} · modelo: ${selection.model} · prompt: ${descriptor.prompt}\n  coste máximo estimado: ${usd(worstCase)} (presupuesto: $${options.budgetUsd})\n`);

  if (selection.provider !== "mock") {
    if (worstCase === null || worstCase > options.budgetUsd) {
      console.error(`${worstCase === null ? "No hay precio para este modelo" : `El coste máximo estimado (${usd(worstCase)}) supera el presupuesto`}. No se ejecuta nada.`);
      process.exit(2);
    }
    if (!options.yes) {
      console.error("Esto llamará al proveedor real y cuesta dinero. Repite con --yes para confirmarlo.");
      process.exit(2);
    }
  }
  const provider = options.provider();

  const reports: CaseReport[] = [];
  const analyses: Array<{ label: string; name: string; analysis: MaterialAnalysis | null }> = [];
  let spent = 0;
  let realModel: string | null = null;
  for (const f of files) {
    const nextWorst = worstCaseCostUsd(selection, { files: 1, pages: f.pages, ...cap }) ?? 0;
    if (selection.provider !== "mock" && spent + nextWorst > options.budgetUsd) {
      console.error(`\nDetenido antes de ${f.label}: se superaría el presupuesto ($${options.budgetUsd}).`);
      break;
    }
    const { report, analysis, realModel: model } = await analyzeCase({ analyzer, id: f.label, title: f.label, stage: null, file: f.file, pageCount: f.pages, selection, provider, ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}), ...(options.singleCall ? { singleCall: true } : {}) });
    realModel ??= model;
    spent += report.costUsd ?? 0;
    printCaseLine(report);
    reports.push(report);
    analyses.push({ label: f.label, name: f.name, analysis });
  }

  const agg = aggregate(reports);
  printAggregate(agg);

  const run = { ...describeRun(selection, realModel, options.label, analyzer), startedAt: descriptor.startedAt };
  const resultsDir = path.join(dir, "results");
  const reviewsDir = path.join(dir, "reviews");
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(reviewsDir, { recursive: true });
  const stamp = run.startedAt.replace(/[:.]/g, "-");
  const resultsFile = path.join(resultsDir, `${stamp}-${selection.provider}-${run.model}.json`);
  // The full analyses live here, inside the git-ignored directory, so a human can review them.
  writeFileSync(resultsFile, JSON.stringify({ version: 1, kind: "private", run, aggregate: agg, projections: projectCosts(agg.avgCostUsd), projectionNote: PROJECTION_NOTE, results: reports, analyses }, null, 2));

  const template = JSON.parse(readFileSync(TEMPLATE, "utf8")) as Record<string, unknown>;
  for (const { label, name } of analyses) {
    const reviewFile = path.join(reviewsDir, `${path.basename(name, path.extname(name))}.${selection.provider}-${run.model}.review.json`);
    if (!existsSync(reviewFile)) writeFileSync(reviewFile, JSON.stringify({ ...template, case_id: label, run: path.basename(resultsFile) }, null, 2));
  }
  console.log(`\nResultados (privados): ${resultsFile}\nPlantillas de evaluación humana: ${reviewsDir}`);
  process.exit(agg.seriousErrors === 0 ? 0 : 1);
}
