/**
 * Local OCR pilot (NOT production): real Tesseract on the scan's pixels, scored against a reference transcription.
 *
 *   pnpm eval:ocr                          synthetic fixtures × 4 scan conditions → evals/ocr-pilot/results/
 *   pnpm eval:ocr -- --corpus /ruta/corpus authorised real corpus (manifest.json, outside git) → /ruta/corpus/results/
 *
 * No network call while recognising and no paid API. The report never contains page text of a real corpus: only counts,
 * label characters and confusions.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TextBox } from "@/lib/materials/visuals/auto/page-model";
import { CACHE_DIR, LANG_FILE, createOcr, rotateBox, type OcrWord } from "./engine";
import { ocrLines } from "./recognition";
import { candidateSummary, candidateTrials, instructionOutcomes, labelOutcomes, textErrors, type CandidateTrial, type InstructionOutcome, type LabelOutcome, type PilotPage } from "./metrics";
import { adversarialPages } from "./adversarial";
import { CONDITIONS, corpusPages, corpusRoot, fixturePages } from "./pages";

const ENGINES = ["pagina", "pagina+etiquetas"] as const;
type Engine = (typeof ENGINES)[number];

export interface PageResult {
  id: string;
  docType: string;
  condition: string;
  dpi: number;
  pageMs: number;
  labelMs: number;
  labelCalls: number;
  /** Skew estimated and corrected by Tesseract (degrees). */
  skewDeg: number;
  engines: Record<Engine, {
    text: ReturnType<typeof textErrors>;
    labels: LabelOutcome[];
    spurious: string[];
    labelDetections: number;
    instructions: InstructionOutcome[];
    candidates: CandidateTrial[];
    meanConfidence: number;
  }>;
  /** Same prefilter fed with the reference text layer (the #31 "perfect OCR"): what real OCR loses against it. */
  referenceCandidates: CandidateTrial[];
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : entry.isFile() ? statSync(p).size : 0;
  }
  return total;
}

function dependencySize() {
  const pkg = (name: string, from?: string) => path.dirname(realpathSync(createRequire(from ?? import.meta.url).resolve(`${name}/package.json`)));
  const main = pkg("tesseract.js");
  const core = pkg("tesseract.js-core", path.join(main, "package.json"));
  const mb = (n: number) => Math.round((n / 1e6) * 10) / 10;
  return { tesseractJsMb: mb(dirSize(main)), coreMb: mb(dirSize(core)), coreWasmVariants: readdirSync(core).filter((f) => f.endsWith(".wasm")).length, spaModelGzMb: mb(statSync(path.join(CACHE_DIR, LANG_FILE)).size) };
}

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]! * 100) / 100;
};

function aggregate(results: readonly PageResult[], engine: Engine) {
  const e = results.map((r) => r.engines[engine]);
  const sum = (f: (x: (typeof e)[number]) => number) => e.reduce((n, x) => n + f(x), 0);
  const labels = e.flatMap((x) => x.labels);
  const instructions = e.flatMap((x) => x.instructions);
  const cands = candidateSummary(e.flatMap((x) => x.candidates));
  const ref = candidateSummary(results.flatMap((r) => r.referenceCandidates));
  const anchors = (key: "anchor" | "tolerant") => ({
    found: instructions.filter((i) => key === "anchor" ? i.found : i.tolerantFound).length,
    correct: instructions.filter((i) => i[key] === "correct").length,
    wrong: instructions.filter((i) => i[key] === "wrong").length,
    unverifiable: instructions.filter((i) => i[key] === "unverifiable").length,
    missed: instructions.filter((i) => i[key] === "missed").length,
    of: instructions.length,
  });
  return {
    pages: results.length,
    wordReference: sum((x) => x.text.words),
    wordErrors: sum((x) => x.text.wordErrors),
    WER: pct(sum((x) => x.text.wordErrors), sum((x) => x.text.words)),
    charReference: sum((x) => x.text.chars),
    charErrors: sum((x) => x.text.charErrors),
    CER: pct(sum((x) => x.text.charErrors), sum((x) => x.text.chars)),
    wordAccuracy: pct(sum((x) => x.text.words) - sum((x) => x.text.wordErrors), sum((x) => x.text.words)),
    charAccuracy: pct(sum((x) => x.text.chars) - sum((x) => x.text.charErrors), sum((x) => x.text.chars)),
    instructionsDetected: pct(instructions.filter((i) => i.found).length, instructions.length),
    instructionsAssociated: pct(instructions.filter((i) => i.anchor === "correct").length, instructions.length),
    instructionsReadAndAssociated: pct(instructions.filter((i) => i.anchor === "correct" && i.recall >= 0.9).length, instructions.length),
    instructionWordRecall: pct(instructions.reduce((n, i) => n + i.recall, 0), instructions.length),
    anchors: anchors("anchor"),
    tolerantAnchors: anchors("tolerant"),
    anchorOffsetMmP90: quantile(instructions.flatMap((i) => (i.offsetMm === null ? [] : [i.offsetMm])), 0.9),
    labels: {
      of: labels.length,
      detected: pct(labels.filter((l) => l.status === "ok").length, labels.length),
      correct: labels.filter((l) => l.status === "ok").length,
      detections: sum((x) => x.labelDetections),
      precision: pct(labels.filter((l) => l.status === "ok").length, sum((x) => x.labelDetections)),
      confused: labels.filter((l) => l.status === "confused").length,
      lost: labels.filter((l) => l.status === "lost").length,
      duplicates: labels.reduce((n, l) => n + l.duplicates, 0),
      spurious: sum((x) => x.spurious.length),
      offsetMmMedian: quantile(labels.flatMap((l) => (l.status === "ok" && l.offsetMm !== null ? [l.offsetMm] : [])), 0.5),
      offsetMmP90: quantile(labels.flatMap((l) => (l.status === "ok" && l.offsetMm !== null ? [l.offsetMm] : [])), 0.9),
      iouMedian: quantile(labels.flatMap((l) => (l.status === "ok" && l.iou !== null ? [l.iou] : [])), 0.5),
    },
    candidates: { ...cands, coverage: pct(cands.covered, cands.eligible), referenceCoverage: pct(ref.covered, ref.eligible), referenceWrongCandidates: ref.wrongCandidates },
    pageMsMedian: quantile(results.map((r) => r.pageMs + (engine === "pagina+etiquetas" ? r.labelMs : 0)), 0.5),
    pageMsMax: quantile(results.map((r) => r.pageMs + (engine === "pagina+etiquetas" ? r.labelMs : 0)), 1),
  };
}

const groupBy = <T>(xs: readonly T[], key: (x: T) => string) => xs.reduce<Record<string, T[]>>((m, x) => ((m[key(x)] ??= []).push(x), m), {});

function markdown(report: ReturnType<typeof buildReport>, real: boolean) {
  const row = (name: string, a: ReturnType<typeof aggregate>) =>
    `| ${name} | ${a.pages} | ${a.wordAccuracy ?? "—"} | ${a.charAccuracy ?? "—"} | ${a.instructionsDetected ?? "—"} | ${a.anchors.found}; ${a.anchors.correct}/${a.anchors.wrong}/${a.anchors.unverifiable}/${a.anchors.missed} | ${a.tolerantAnchors.found}; ${a.tolerantAnchors.correct}/${a.tolerantAnchors.wrong}/${a.tolerantAnchors.unverifiable}/${a.tolerantAnchors.missed} | ${a.labels.detected ?? "—"} (${a.labels.of}) | ${a.labels.lost} | ${a.labels.confused} | ${a.labels.spurious} | ${a.labels.offsetMmP90 ?? "—"} | ${a.candidates.covered}/${a.candidates.eligible} (ref ${a.candidates.referenceCoverage ?? "—"} %) | ${a.candidates.wrongCandidates} | ${a.pageMsMedian} |`;
  const head = "| grupo | págs | palabras % | caracteres % | consignas encontradas % | anclas halladas; bien/mal/sin verificar/omitidas | tolerantes halladas; bien/mal/sin verificar/omitidas | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const out = [
    `# Piloto OCR local — ${real ? "corpus real autorizado" : "fixtures SINTÉTICOS"}`,
    "",
    real ? "Corpus real autorizado (fuera del repositorio)." : "**55 condiciones-página de 11 documentos base: no son 55 observaciones independientes ni validan documentos reales.** Las cajas de referencia se usan solo para puntuar.",
    "",
    `Motor: ${report.engine}. Generado con \`pnpm eval:ocr\`. Memoria (RSS de todo el proceso, con pdf.js y canvas): ${report.memory.beforeEngineRssMb} MB antes de cargar el motor, ${report.memory.withEngineRssMb} MB con los dos workers cargados, pico ${report.memory.peakRssMb} MB. Dependencia: tesseract.js ${report.dependency.tesseractJsMb} MB + núcleo WASM ${report.dependency.coreMb} MB (${report.dependency.coreWasmVariants} variantes) + modelo spa ${report.dependency.spaModelGzMb} MB (gzip).`,
    "",
  ];
  out.push("WER/CER y denominadores, precisión de etiquetas y detecciones están en report.json. Palabras/caracteres % = 100 menos tasa de edición: puede ser negativo por inserciones. Ancla hallada no implica asociación verificada. Se comprueba el soporte del mismo prefijo de consigna en su región anotada, sin comparar centros de líneas con numeración diferente; vertical ≤3 mm, X dentro de referencia. Prefijos insuficientes, referencias incoherentes y líneas entre actividades quedan sin verificar. Orden de lectura: altura y luego izquierda a derecha; no valida columnas.", "");
  for (const engine of ENGINES) {
    out.push(`## Motor «${engine}»`, "", "### Por condición de escaneo", "", head);
    for (const [k, a] of Object.entries(report.byCondition[engine])) out.push(row(k, a));
    out.push("", "### Por tipo de documento (todas las condiciones)", "", head);
    for (const [k, a] of Object.entries(report.byDocType[engine])) out.push(row(k, a));
    out.push("");
  }
  out.push("Candidatos: prefiltro geométrico de #31 con la caja humana como propuesta; «ref» = mismo prefiltro con la capa de texto de referencia. Ninguna propuesta se acepta: identidad semántica, contenido completo y respuesta visual siguen sin verificar.");
  return out.join("\n") + "\n";
}

export function buildReport(results: PageResult[], memory: { beforeEngineRssMb: number; withEngineRssMb: number; peakRssMb: number }, dependency: ReturnType<typeof dependencySize>, real = false) {
  if (real) {
    const types = new Map<string, string>();
    results = results.map((r) => {
      if (!types.has(r.docType)) types.set(r.docType, `type_${types.size + 1}`);
      return { ...r, docType: types.get(r.docType)! };
    });
  }
  const by = (key: (r: PageResult) => string) => Object.fromEntries(ENGINES.map((e) => [e, Object.fromEntries(Object.entries(groupBy(results, key)).map(([k, rs]) => [k, aggregate(rs, e)]))])) as Record<Engine, Record<string, ReturnType<typeof aggregate>>>;
  return {
    metricsVersion: "ocr_pilot@audit3",
    complete: true,
    corpus: { kind: real ? "authorized_real" : "synthetic", baseDocuments: real ? null : 11, pageConditions: results.length },
    engine: "ocr_pilot@phase1 · tesseract.js 7.0.0 (Tesseract 5, WASM) · spa 4.0.0_best_int · PSM 3 + enderezado; etiquetas PSM 8 con respaldo PSM 10 (reglas de recognition.ts)",
    conditions: CONDITIONS.map(({ id, description, dpi }) => ({ id, description, dpi })),
    memory,
    labelCalls: { total: results.reduce((n, r) => n + r.labelCalls, 0), maxPerPage: Math.max(0, ...results.map((r) => r.labelCalls)) },
    /** Tesseract calls: one page pass plus the label reads of each page. */
    ocrCalls: { total: results.reduce((n, r) => n + 1 + r.labelCalls, 0), maxPerPage: Math.max(0, ...results.map((r) => 1 + r.labelCalls)) },
    dependency,
    overall: Object.fromEntries(ENGINES.map((e) => [e, aggregate(results, e)])),
    byCondition: by((r) => r.condition),
    byDocType: by((r) => r.docType),
    pages: results.map((r, i) => ({ ...r, id: real ? `page_${i + 1}` : r.id, docType: real ? "redacted" : r.docType,
      engines: Object.fromEntries(ENGINES.map((e) => [e, { ...r.engines[e], labels: r.engines[e].labels.map(({ status, duplicates, offsetMm, iou }) => ({ status, duplicates, offsetMm, iou })), spurious: r.engines[e].spurious.length }])) })),
  };
}

export function prepareOutput(root: string, name = "results"): string {
  const out = path.join(root, name);
  if (existsSync(out) && (lstatSync(out).isSymbolicLink() || !lstatSync(out).isDirectory())) throw new Error("report_path_invalid");
  mkdirSync(out, { recursive: true });
  for (const name of ["report.json", "report.md", "run-status.json", ".report.json.tmp", ".report.md.tmp"]) rmSync(path.join(out, name), { force: true });
  writeFileSync(path.join(out, "run-status.json"), JSON.stringify({ status: "running" }) + "\n", { flag: "wx" });
  return out;
}

export function finishOutput(out: string, report: ReturnType<typeof buildReport> | null, real: boolean) {
  const temp = [".report.json.tmp", ".report.md.tmp"];
  try {
    if (!report) throw new Error("pilot_failed");
    writeFileSync(path.join(out, temp[0]!), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    writeFileSync(path.join(out, temp[1]!), markdown(report, real), { flag: "wx" });
    renameSync(path.join(out, temp[0]!), path.join(out, "report.json"));
    renameSync(path.join(out, temp[1]!), path.join(out, "report.md"));
    writeFileSync(path.join(out, "run-status.json"), JSON.stringify({ status: "complete", pages: report.pages.length }) + "\n");
  } catch {
    for (const name of [...temp, "report.json", "report.md"]) rmSync(path.join(out, name), { force: true });
    writeFileSync(path.join(out, "run-status.json"), JSON.stringify({ status: "failed" }) + "\n");
    if (report) throw new Error("report_write_failed");
  }
}

async function main() {
  const corpusFlag = process.argv.indexOf("--corpus");
  const corpus = corpusFlag >= 0 ? process.argv[corpusFlag + 1] : undefined;
  if (corpusFlag >= 0 && (!corpus || corpus.startsWith("--"))) throw new Error("corpus_argument_missing");
  const adversarialFlag = process.argv.indexOf("--adversarial");
  const requested = adversarialFlag >= 0 ? process.argv[adversarialFlag + 1] : undefined;
  if (adversarialFlag >= 0 && requested !== "dev" && requested !== "holdout") throw new Error("adversarial_split_invalid");
  const split = requested as "dev" | "holdout" | undefined;
  const root = corpus ? corpusRoot(corpus) : import.meta.dirname;
  const out = prepareOutput(root, split ? `results-adversarial-${split}` : "results");
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 25);
  const pages: AsyncGenerator<PilotPage> = corpus ? corpusPages(corpus) : split ? adversarialPages(split) : fixturePages();
  const beforeEngine = process.memoryUsage().rss;
  let ocr: Awaited<ReturnType<typeof createOcr>> | undefined;
  const results: PageResult[] = [];
  const started = performance.now();
  try {
    ocr = await createOcr();
    const withEngine = process.memoryUsage().rss;
    for await (const page of pages) {
      if (performance.now() - started > 600_000) throw new Error("pilot_time_limit");
      const t0 = performance.now();
      const read = await ocr.page(page.model, page.dpi);
      const t1 = performance.now();
      const labels = await ocr.labels(page.model, page.dpi, read);
      const t2 = performance.now();
      if (performance.now() - started > 600_000) throw new Error("pilot_time_limit");
      // Use the SAME measured deskew frame on both sides, including partially corrected or real scans.
      const referenceUpright = page.truth.map((t) => ({ text: t.text, ...rotateBox(page.model, t, read.skewDeg * Math.PI / 180) }));
      const anchorReference = corpus ? referenceUpright : page.truthUpright.map((t) => ({ text: t.text,
        ...rotateBox(page.model, t, ((page.scanRotationDeg ?? 0) + read.skewDeg) * Math.PI / 180) }));
      const referenceBoxes = <T extends TextBox>(t: T) => ({ text: t.text, ...rotateBox(page.model, t, read.skewDeg * Math.PI / 180) });
      const score = (words: OcrWord[]) => {
        const boxes: TextBox[] = words.map(({ text, x0, y0, x1, y1 }) => ({ text, x0, y0, x1, y1 }));
        const upright: TextBox[] = words.map(({ text, upright: u }) => ({ text, ...u }));
        // Reading lines follow Tesseract's line structure in the deskewed frame (columns are not merged by height).
        const lines = ocrLines(words.map(({ text, upright: u, line, confidence }) => ({ text, ...u, line, confidence })), page.model.mmPerPx);
        const l = labelOutcomes(page.model, page.truth, boxes);
        return {
          // Rotating an axis-aligned envelope a second time expands it and can merge reference lines. Reading order comes
          // from the original upright reference (synthetic) or human annotation order (real), not reconstructed envelopes.
          text: textErrors(page.truthUpright, upright, Boolean(corpus), lines),
          labels: l.outcomes,
          spurious: l.spurious,
          labelDetections: l.detections,
          instructions: instructionOutcomes(page.model, anchorReference, upright, page.activities,
            page.anchorTruth ? new Map(Object.entries(page.anchorTruth).map(([id, t]) => [id, referenceBoxes(t)])) : undefined,
            page.instructionTruth ? new Map(Object.entries(page.instructionTruth).map(([id, ts]) => [id, ts.map(referenceBoxes)])) : undefined, lines),
          candidates: candidateTrials(page, boxes),
          meanConfidence: Math.round(words.reduce((n, w) => n + w.confidence, 0) / Math.max(1, words.length)),
        };
      };
      results.push({
        id: page.id, docType: page.docType, condition: page.condition, dpi: page.dpi, pageMs: Math.round(t1 - t0), labelMs: Math.round(t2 - t1),
        skewDeg: Math.round(read.skewDeg * 100) / 100,
        labelCalls: read.labelCalls ?? 0,
        // The page-only engine keeps every page word; the combined one replaces rerouted lone words by the label pass.
        engines: { pagina: score(read.words), "pagina+etiquetas": score([...read.words.filter((w) => !w.rerouted), ...labels]) },
        referenceCandidates: candidateTrials(page, page.truth),
      });
      process.stdout.write(`${corpus ? `page_${results.length}` : `${page.condition} ${page.id}`} ${Math.round(t1 - t0)}+${Math.round(t2 - t1)} ms\n`);
    }
    const mb = (n: number) => Math.round(n / 1e6);
    const report = buildReport(results, { beforeEngineRssMb: mb(beforeEngine), withEngineRssMb: mb(withEngine), peakRssMb: mb(peak) }, dependencySize(), Boolean(corpus));
    finishOutput(out, report, Boolean(corpus));
    process.stdout.write("pilot_complete\n");
  } catch {
    finishOutput(out, null, Boolean(corpus));
    throw new Error("pilot_failed_no_report");
  } finally {
    clearInterval(sampler);
    await ocr?.terminate();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => {
  process.stderr.write("pilot_failed: consulta run-status.json; no se registra contenido ni rutas del corpus\n");
  process.exit(1);
});
