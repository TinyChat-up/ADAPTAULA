import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus, type Case } from "./cases";
import { FIXTURE_CASES } from "./fixtures";
import { runCase, summarize, type CaseResult, type Summary } from "./metrics";

/**
 * Phase III runner (`pnpm eval:pedagogy`). No model, no network, no database.
 *
 *   pnpm eval:pedagogy                                   own synthetic fixtures → evals/pedagogical-quality/results-fixtures/
 *   pnpm eval:pedagogy -- --corpus <dir> --split development   external sheets (outside Git) → <dir>/results-development/
 *   pnpm eval:pedagogy -- --corpus <dir> --split holdout       measure only; refuses to re-run once the rules have changed
 *
 * The holdout run records the hash of the rules it ran with; a later run with different rules needs `--rerun-holdout` and is
 * reported as contaminated.
 */

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const RULE_FILES = [join(here, "evaluate.ts"), join(here, "contract.ts"), join(here, "../../src/lib/adaptation/text.ts")];
const rulesHash = () => createHash("sha256").update(RULE_FILES.map((f) => readFileSync(f)).join("\n")).digest("hex");

const corpus = arg("--corpus");
const split = (arg("--split") ?? (corpus ? "development" : "all")) as "development" | "holdout" | "all";
let cases: Case[] = corpus ? loadCorpus(resolve(corpus)) : FIXTURE_CASES;
if (split !== "all") cases = cases.filter((c) => c.reference.split === split);
if (!cases.length) throw new Error("no hay casos para ese conjunto");
const out = resolve(arg("--out") ?? (corpus ? join(corpus, `results-${split}`) : join(here, "results-fixtures")));
mkdirSync(out, { recursive: true });

let contaminated = false;
if (split === "holdout") {
  const lock = join(out, "rules.sha256");
  if (existsSync(lock) && readFileSync(lock, "utf8").trim() !== rulesHash()) {
    if (!process.argv.includes("--rerun-holdout")) throw new Error("las reglas han cambiado desde la ejecución de reserva: no se vuelve a ejecutar sin --rerun-holdout");
    contaminated = true;
  }
  if (!existsSync(lock)) writeFileSync(lock, rulesHash() + "\n");
}

const results = cases.map(runCase);
const summary = summarize(results);
writeFileSync(join(out, "report.json"), JSON.stringify({ split, rulesSha256: rulesHash(), contaminated, summary, results }, null, 2) + "\n");
writeFileSync(join(out, "report.md"), markdown(split, summary, results, contaminated));
console.log(`${results.length} fichas (${split}) → ${out}`);
console.log(`errores verificables detectados ${summary.verifiableErrors.detected}/${summary.verifiableErrors.total} · falsos bloqueos ${summary.falseBlocks.length}/${summary.correctCandidates} · referencias validadas por docente ${summary.teacherValidatedReferences}`);

function markdown(splitName: string, s: Summary, rs: readonly CaseResult[], dirty: boolean): string {
  const pct = (a: number, b: number) => (b ? `${a}/${b}` : "—");
  const lines = [
    `# Calidad pedagógica · conjunto «${splitName}»`, "",
    dirty ? "> **Ejecución contaminada:** las reglas cambiaron después de la primera ejecución de reserva.\n" : "",
    "Todas las referencias son **propuestas sintéticas provisionales**; ninguna está revisada por un docente. Un veredicto nunca es «aprobado»: lo mejor es «pendiente de revisión docente».", "",
    "| Medida | Valor |", "| --- | --- |",
    `| Fichas | ${s.cases} |`,
    `| Referencias validadas por docente | ${s.teacherValidatedReferences} |`,
    `| Datos críticos conservados en adaptaciones correctas (comprobaciones A) | ${pct(s.criticalPreservation.pass, s.criticalPreservation.total)} |`,
    `| Errores verificables detectados | ${pct(s.verifiableErrors.detected, s.verifiableErrors.total)} |`,
    `| Errores no verificables que igualmente fallan | ${pct(s.nonVerifiableErrors.caughtAnyway, s.nonVerifiableErrors.total)} |`,
    `| Errores no verificables que llegan al docente como pendientes | ${pct(s.nonVerifiableErrors.reachedTeacher, s.nonVerifiableErrors.total)} |`,
    `| Falsos bloqueos (adaptaciones correctas y controles con FAIL) | ${pct(s.falseBlocks.length, s.correctCandidates)} |`,
    `| Adaptaciones correctas pendientes de revisión docente | ${pct(s.needsTeacherReview.correctCandidates, s.correctCandidates)} |`,
    `| Comprobaciones pendientes de docente por adaptación (media) | ${s.needsTeacherReview.findingsPerCandidate} |`,
    `| Fugas de respuesta detectadas | ${pct(s.leaks.detected, s.leaks.mutations)} |`,
    `| Fugas en adaptaciones correctas | ${s.leaks.inCorrectCandidates} |`,
    `| Errores de figura detectados | ${pct(s.figures.detected, s.figures.mutations)} |`,
    `| Figuras íntegras en adaptaciones correctas | ${pct(s.figures.correctCandidatePass, s.figures.correctCandidateTotal)} |`, "",
    "## Cobertura", "", "| Ficha | Área | Tipo | Errores detectados | Falsos bloqueos |", "| --- | --- | --- | --- | --- |",
    ...s.coverage.map((c) => `| ${c.caseId} | ${c.subject} | ${c.activityType} | ${pct(c.detected, c.mutations)} | ${c.falseBlocks} |`), "",
    "## Errores introducidos", "", "| Ficha | Error | Tipo | ¿Verificable? | Veredicto | Detectado | Otras comprobaciones en FAIL |", "| --- | --- | --- | --- | --- | --- | --- |",
    ...rs.flatMap((r) => r.mutations.map((m) => `| ${r.caseId} | ${m.mutation.id} | ${m.mutation.errorType} | ${m.mutation.verifiable ? "sí" : "no"} | ${m.evaluation.verdict} | ${m.detected ? "sí" : "**no**"} | ${m.otherFails.join(", ") || "—"} |`)), "",
    "## Adaptaciones correctas", "", "| Ficha | Plan | Veredicto | A | B | C | D | E |", "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rs.flatMap((r) => r.candidates.map((c) => `| ${r.caseId} | ${c.plan} | ${c.evaluation.verdict} | ${Object.values(c.evaluation.byCriterion).join(" | ")} |`)), "",
  ];
  if (s.falseBlocks.length) lines.push("## Falsos bloqueos", "", ...s.falseBlocks.map((f) => `- ${f.caseId} · ${f.plan}: ${f.fails.join("; ")}`), "");
  if (s.verifiableErrors.missed.length) lines.push("## Errores verificables no detectados", "", ...s.verifiableErrors.missed.map((m) => `- ${m.caseId} · ${m.id} (otras: ${m.got.join(", ") || "ninguna"})`), "");
  const refs = rs.filter((r) => r.referenceAdaptation);
  if (refs.length) lines.push("## Consistencia de las adaptaciones de referencia (no es un resultado)", "", ...refs.map((r) => `- ${r.caseId}: ${r.referenceAdaptation!.verdict}${r.referenceAdaptation!.verdict === "FAIL" ? " — " + r.referenceAdaptation!.findings.filter((f) => f.status === "FAIL").map((f) => f.check).join(", ") : ""}`), "");
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";
}
