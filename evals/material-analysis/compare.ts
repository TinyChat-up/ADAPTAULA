/**
 * Side-by-side comparison of benchmark runs (different provider/model, same files, prompt, schema and checks).
 *
 *   pnpm eval:analysis:compare -- evals/results/<a>.json evals/results/<b>.json [--reviews evals/material-analysis/private/reviews]
 *
 * Reads result files written by `pnpm eval:analysis`; with --reviews it also averages the human evaluations
 * (human-review.template.json) that point at each run. It never calls a provider.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { aggregate, percent, seconds, usd, type Aggregate, type CaseReport, type RunDescriptor } from "./report";

interface ResultFile {
  version: number;
  kind: string;
  run: RunDescriptor;
  aggregate: Aggregate;
  results: CaseReport[];
}

interface Review {
  run: string;
  ratings: Record<string, number | null>;
  invented_information: boolean | null;
  omitted_essential_information: boolean | null;
  usable_as_adaptation_base: boolean | null;
}

const RATING_KEYS = ["overall_fidelity", "activity_detection", "pedagogical_goal", "protected_elements", "visual_understanding", "math_understanding"] as const;

const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const fmt = (value: number | null) => (value === null ? "—" : value.toFixed(1));

function loadReviews(dir: string): Review[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".review.json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Review)
    .filter((r) => r.run && Object.values(r.ratings ?? {}).some((v) => v !== null));
}

function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const reviewsIndex = argv.indexOf("--reviews");
  const reviewsDir = reviewsIndex >= 0 ? argv[reviewsIndex + 1] : undefined;
  const files = argv.filter((a, i) => a.endsWith(".json") && i !== reviewsIndex + 1);
  if (files.length < 2) {
    console.error("Indica al menos dos archivos de resultados (evals/results/*.json).");
    process.exit(2);
  }

  const runs = files.map((file) => ({ file, data: JSON.parse(readFileSync(file, "utf8")) as ResultFile }));
  const prompts = new Set(runs.map((r) => r.data.run.prompt));
  const schemas = new Set(runs.map((r) => r.data.run.schemaVersion));
  const caseSets = new Set(runs.map((r) => r.data.results.map((c) => c.id).sort().join("|")));
  if (prompts.size > 1 || schemas.size > 1) console.warn(`⚠ Prompt o esquema distintos entre ejecuciones (${[...prompts].join(", ")} · esquema ${[...schemas].join(", ")}): la comparación no es limpia.`);
  if (caseSets.size > 1) console.warn("⚠ Las ejecuciones no analizan los mismos casos: solo se comparan los comunes en la matriz.");

  const reviews = reviewsDir ? loadReviews(reviewsDir) : [];

  console.log("\nResumen por ejecución");
  for (const { file, data } of runs) {
    const a = aggregate(data.results);
    const mine = reviews.filter((r) => r.run === path.basename(file));
    console.log(`\n● ${data.run.provider}:${data.run.model}  (${data.run.label ?? "sin etiqueta"} · esfuerzo ${data.run.effort} · ${data.run.prompt})`);
    console.log(`  automática: puntuación ${percent(a.avgScore)} · errores graves ${a.seriousErrors}/${a.cases} · invenciones ${percent(a.hallucinationRate)}`);
    console.log(`  coste medio ${usd(a.avgCostUsd)} (total ${usd(a.totalCostUsd)}) · latencia media ${seconds(a.avgLatencyMs)}`);
    if (a.failurePatterns.length > 0) console.log(`  fallos: ${a.failurePatterns.map((p) => `${p.check} (${p.cases})`).join("; ")}`);
    if (mine.length > 0) {
      const ratings = RATING_KEYS.map((key) => `${key} ${fmt(mean(mine.map((r) => r.ratings[key]).filter((v): v is number => typeof v === "number")))}`).join(" · ");
      const count = (pick: (r: Review) => boolean | null) => mine.filter((r) => pick(r) === true).length;
      console.log(`  humana (${mine.length} valoraciones): ${ratings}`);
      console.log(`  humana: inventa ${count((r) => r.invented_information)} · omite ${count((r) => r.omitted_essential_information)} · sirve como base ${count((r) => r.usable_as_adaptation_base)}/${mine.length}`);
    } else if (reviewsDir) console.log("  humana: sin valoraciones para esta ejecución");
  }

  const ids = runs[0]!.data.results.map((c) => c.id).filter((id) => runs.every((r) => r.data.results.some((c) => c.id === id)));
  if (ids.length > 0) {
    console.log("\nMatriz por caso (puntuación · coste · latencia)");
    for (const id of ids) {
      const cells = runs.map(({ data }) => {
        const c = data.results.find((x) => x.id === id)!;
        return c.delivered ? `${c.score === null ? "—" : percent(c.score)} · ${usd(c.costUsd)} · ${seconds(c.latencyMs)}` : `fallo (${c.failure})`;
      });
      console.log(`  ${id}: ${cells.join("  |  ")}`);
    }
  }
}

main();
