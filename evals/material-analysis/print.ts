import { aggregate, percent, projectCosts, seconds, usd, type Aggregate, type CaseReport } from "./report";

/** Per-case line: metrics only, never any material content. */
export function printCaseLine(report: CaseReport, label = report.id) {
  const mark = report.passed === null ? (report.delivered ? "·" : "✗") : report.passed ? "✓" : "✗";
  const score = report.score === null ? "" : `  puntuación ${Math.round(report.score * 100)} %`;
  const detail = report.delivered
    ? `in ${report.tokens.input}${report.tokens.cacheWrite ? ` (+${report.tokens.cacheWrite} escritos en caché)` : ""}${report.tokens.cached ? ` (+${report.tokens.cached} leídos de caché)` : ""} out ${report.tokens.output}  ${usd(report.costUsd)}  ${seconds(report.latencyMs)}${score}${report.digest ? `  protegidos E${report.digest.protectedImportance.essential}/I${report.digest.protectedImportance.important}/O${report.digest.protectedImportance.optional}` : ""}${report.hallucinations ? `  ⚠ ${report.hallucinations} posible(s) invención(es)` : ""}`
    : `fallo del análisis: ${report.failure}  ${usd(report.costUsd)}`;
  console.log(`${mark} ${label}  ${detail}`);
  for (const attempt of report.attempts.filter((a) => a.status !== "success")) {
    console.log(`    ↻ intento ${attempt.attempt}: ${attempt.errorCode ?? attempt.status}${attempt.issues.length ? ` — ${attempt.issues.slice(0, 4).join(" | ")}` : ""}`);
  }
  for (const check of report.failedChecks) console.log(`    ${check.severity === "hard" ? "✗" : "·"} ${check.name}: ${check.detail ?? ""}`);
}

export const PROJECTION_NOTE = "Extrapolación lineal de una muestra pequeña: orienta el orden de magnitud, no es una previsión.";

export function printAggregate(agg: Aggregate) {
  console.log("\nResultado agregado");
  console.log(`  casos: ${agg.cases} · entregados: ${agg.delivered} · evaluados automáticamente: ${agg.evaluated}`);
  console.log(`  puntuación media: ${percent(agg.avgScore)} · errores graves: ${agg.seriousErrors} (${agg.hardFailures} comprobaciones duras falladas)`);
  console.log(`  tasa de invención observada: ${percent(agg.hallucinationRate)}`);
  console.log(`  coste total: ${usd(agg.totalCostUsd)} · coste medio por análisis: ${usd(agg.avgCostUsd)} · latencia media: ${seconds(agg.avgLatencyMs)}`);
  if (agg.failurePatterns.length > 0) console.log(`  patrones de fallo: ${agg.failurePatterns.map((p) => `${p.check} (${p.cases})`).join("; ")}`);
  const projection = projectCosts(agg.avgCostUsd);
  console.log(`  proyección del coste: ${projection.map((p) => `${p.analyses.toLocaleString("es-ES")} análisis ≈ ${usd(p.costUsd, 2)}`).join(" · ")}`);
  console.log(`  (${PROJECTION_NOTE})`);
}

export { aggregate };
