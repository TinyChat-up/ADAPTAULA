/**
 * Local OCR pilot (NOT production): real Tesseract on the scan's pixels, scored against a reference transcription.
 *
 *   pnpm eval:ocr                          synthetic fixtures × 4 scan conditions → evals/ocr-pilot/results/
 *   pnpm eval:ocr -- --corpus /ruta/corpus authorised real corpus (manifest.json, outside git) → /ruta/corpus/results/
 *
 * No network call while recognising and no paid API. The report never contains page text of a real corpus: only counts,
 * label characters and confusions.
 */
import { mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { TextBox } from "@/lib/materials/visuals/auto/page-model";
import { CACHE_DIR, LANG_FILE, createOcr, type OcrWord } from "./engine";
import { candidateSummary, candidateTrials, instructionOutcomes, labelOutcomes, textErrors, type CandidateTrial, type InstructionOutcome, type LabelOutcome, type PilotPage } from "./metrics";
import { CONDITIONS, corpusPages, fixturePages } from "./pages";

const ENGINES = ["pagina", "pagina+etiquetas"] as const;
type Engine = (typeof ENGINES)[number];

interface PageResult {
  id: string;
  docType: string;
  condition: string;
  dpi: number;
  pageMs: number;
  labelMs: number;
  /** Skew estimated and corrected by Tesseract (degrees). */
  skewDeg: number;
  engines: Record<Engine, {
    text: ReturnType<typeof textErrors>;
    labels: LabelOutcome[];
    spurious: string[];
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
  return {
    pages: results.length,
    wordAccuracy: pct(sum((x) => x.text.words) - sum((x) => x.text.wordErrors), sum((x) => x.text.words)),
    charAccuracy: pct(sum((x) => x.text.chars) - sum((x) => x.text.charErrors), sum((x) => x.text.chars)),
    instructionsDetected: pct(instructions.filter((i) => i.anchor === "correct" && i.recall >= 0.9).length, instructions.length),
    instructionWordRecall: pct(instructions.reduce((n, i) => n + i.recall, 0), instructions.length),
    anchors: { correct: instructions.filter((i) => i.anchor === "correct").length, wrong: instructions.filter((i) => i.anchor === "wrong").length, missed: instructions.filter((i) => i.anchor === "missed").length, of: instructions.length },
    tolerantAnchors: { correct: instructions.filter((i) => i.tolerant === "correct").length, wrong: instructions.filter((i) => i.tolerant === "wrong").length, missed: instructions.filter((i) => i.tolerant === "missed").length, of: instructions.length },
    anchorOffsetMmP90: quantile(instructions.flatMap((i) => (i.offsetMm === null ? [] : [i.offsetMm])), 0.9),
    labels: {
      of: labels.length,
      detected: pct(labels.filter((l) => l.status === "ok").length, labels.length),
      confused: labels.filter((l) => l.status === "confused").map((l) => `${l.text}→${l.read}`),
      lost: labels.filter((l) => l.status === "lost").length,
      duplicates: labels.reduce((n, l) => n + l.duplicates, 0),
      spurious: e.flatMap((x) => x.spurious),
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
    `| ${name} | ${a.pages} | ${a.wordAccuracy ?? "—"} | ${a.charAccuracy ?? "—"} | ${a.instructionsDetected ?? "—"} | ${a.anchors.correct}/${a.anchors.wrong}/${a.anchors.missed} | ${a.tolerantAnchors.correct}/${a.tolerantAnchors.wrong}/${a.tolerantAnchors.missed} | ${a.labels.detected ?? "—"} (${a.labels.of}) | ${a.labels.lost} | ${a.labels.confused.length ? a.labels.confused.join(", ") : "—"} | ${a.labels.spurious.length} | ${a.labels.offsetMmP90 ?? "—"} | ${a.candidates.covered}/${a.candidates.eligible} (ref ${a.candidates.referenceCoverage ?? "—"} %) | ${a.candidates.wrongCandidates} | ${a.pageMsMedian} |`;
  const head = "| grupo | págs | palabras % | caracteres % | consignas % | anclas ok/mal/no | anclas tolerantes ok/mal/no | etiquetas % (n) | perdidas | confusiones | espurias | desvío etiqueta p90 mm | candidatos ok/elegibles | candidatos erróneos | ms/pág (mediana) |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const out = [
    `# Piloto OCR local — ${real ? "corpus real autorizado" : "fixtures SINTÉTICOS"}`,
    "",
    real ? "Corpus real autorizado (fuera del repositorio)." : "**Fixtures sintéticos: no validan el comportamiento con documentos reales.** Las cajas de referencia se usan solo para puntuar.",
    "",
    `Motor: ${report.engine}. Generado con \`pnpm eval:ocr\`. Memoria (RSS de todo el proceso, con pdf.js y canvas): ${report.memory.beforeEngineRssMb} MB antes de cargar el motor, ${report.memory.withEngineRssMb} MB con los dos workers cargados, pico ${report.memory.peakRssMb} MB. Dependencia: tesseract.js ${report.dependency.tesseractJsMb} MB + núcleo WASM ${report.dependency.coreMb} MB (${report.dependency.coreWasmVariants} variantes) + modelo spa ${report.dependency.spaModelGzMb} MB (gzip).`,
    "",
  ];
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

function buildReport(results: PageResult[], memory: { beforeEngineRssMb: number; withEngineRssMb: number; peakRssMb: number }, dependency: ReturnType<typeof dependencySize>) {
  const by = (key: (r: PageResult) => string) => Object.fromEntries(ENGINES.map((e) => [e, Object.fromEntries(Object.entries(groupBy(results, key)).map(([k, rs]) => [k, aggregate(rs, e)]))])) as Record<Engine, Record<string, ReturnType<typeof aggregate>>>;
  return {
    engine: "tesseract.js 7.0.0 (Tesseract 5, WASM) · spa 4.0.0_best_int · PSM 3 + enderezado automático en página, PSM 8 en etiquetas",
    conditions: CONDITIONS.map(({ id, description, dpi }) => ({ id, description, dpi })),
    memory,
    dependency,
    overall: Object.fromEntries(ENGINES.map((e) => [e, aggregate(results, e)])),
    byCondition: by((r) => r.condition),
    byDocType: by((r) => r.docType),
    pages: results,
  };
}

async function main() {
  const corpusFlag = process.argv.indexOf("--corpus");
  const corpus = corpusFlag >= 0 ? process.argv[corpusFlag + 1] : undefined;
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 25);
  const pages: AsyncGenerator<PilotPage> = corpus ? corpusPages(corpus) : fixturePages();
  const beforeEngine = process.memoryUsage().rss;
  const ocr = await createOcr();
  const withEngine = process.memoryUsage().rss;
  const results: PageResult[] = [];
  try {
    for await (const page of pages) {
      const t0 = performance.now();
      const read = await ocr.page(page.model, page.dpi);
      const t1 = performance.now();
      const labels = await ocr.labels(page.model, page.dpi, read);
      const t2 = performance.now();
      const score = (words: OcrWord[]) => {
        const boxes: TextBox[] = words.map(({ text, x0, y0, x1, y1 }) => ({ text, x0, y0, x1, y1 }));
        const upright: TextBox[] = words.map(({ text, upright: u }) => ({ text, ...u }));
        const l = labelOutcomes(page.model, page.truth, boxes);
        return {
          text: textErrors(page.truthUpright, upright),
          labels: l.outcomes,
          spurious: l.spurious,
          instructions: instructionOutcomes(page.model, page.truthUpright, upright, page.activities),
          candidates: candidateTrials(page, boxes),
          meanConfidence: Math.round(words.reduce((n, w) => n + w.confidence, 0) / Math.max(1, words.length)),
        };
      };
      results.push({
        id: page.id, docType: page.docType, condition: page.condition, dpi: page.dpi, pageMs: Math.round(t1 - t0), labelMs: Math.round(t2 - t1),
        skewDeg: Math.round(read.skewDeg * 100) / 100,
        engines: { pagina: score(read.words), "pagina+etiquetas": score([...read.words, ...labels]) },
        referenceCandidates: candidateTrials(page, page.truth),
      });
      process.stdout.write(`${page.condition} ${page.id} ${Math.round(t1 - t0)}+${Math.round(t2 - t1)} ms\n`);
    }
  } finally {
    await ocr.terminate();
    clearInterval(sampler);
  }
  const mb = (n: number) => Math.round(n / 1e6);
  const report = buildReport(results, { beforeEngineRssMb: mb(beforeEngine), withEngineRssMb: mb(withEngine), peakRssMb: mb(peak) }, dependencySize());
  const out = corpus ? path.join(corpus, "results") : path.join(import.meta.dirname, "results");
  mkdirSync(out, { recursive: true });
  // A real corpus report keeps counts and labels only: no page text leaves the corpus folder anyway, but the JSON stays lean.
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(path.join(out, "report.md"), markdown(report, Boolean(corpus)));
  process.stdout.write(`\n${path.join(out, "report.md")}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
