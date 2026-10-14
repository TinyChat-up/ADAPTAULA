import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { lumaOf, textBoxesToPx, type PageModel } from "@/lib/materials/visuals/auto/page-model";
import { pageText, pageRgba, renderPage } from "@/lib/materials/visuals/raster";
import type { PageActivity } from "./verify";

/**
 * Prototype fixtures (Phase 8.2B.7): synthetic one-page sheets with KNOWN truth, drawn as vectors, then delivered as a scanner
 * would (raster only: grain, paper tone, edge shadow, optional skew). The text layer handed to the verifier is the vector PDF's
 * own text, transformed like the pixels: it stands for a PERFECT local OCR. `ocrLoss` removes short boxes to stand for a weak one.
 * Nothing here measures a real model or a real OCR engine: only how the verifier behaves given such inputs.
 */

const A4 = { w: 595.28, h: 841.89 } as const;
const top = (y: number) => A4.h - y;
type Box = { x0: number; y0: number; x1: number; y1: number };

export interface CaseVisual {
  id: string;
  activityId: string;
  kind: "bar" | "number_line" | "figure";
  labels: string[];
  /** Where the figure really is (pt, top-left origin), or null when the sheet does not contain it. */
  truth: Box | null;
  /** Whether a correct verifier SHOULD accept the true region (false: it cannot be verified, e.g. ambiguous or cut). */
  acceptable: boolean;
}

export interface FixtureCase {
  id: string;
  description: string;
  activities: PageActivity[];
  visuals: CaseVisual[];
  /** Wrong places a model could point at (pt): another figure, a decoration, a headline… */
  distractors: Record<string, Box>;
  scan: { rotateDeg?: number; noise?: boolean };
  draw(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }): void;
}

const text = (page: PDFPage, font: PDFFont, s: string, x: number, y: number, size = 11) => page.drawText(s, { x, y: top(y), size, font, color: rgb(0, 0, 0) });
const answerLines = (page: PDFPage, ys: number[]) => {
  for (const y of ys) page.drawLine({ start: { x: 76, y: top(y) }, end: { x: 520, y: top(y) }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) });
};

/** A cell: membrane, grey nucleus, dots, and numbered leaders. `labelGap` pushes the labels away from their leaders (pt). */
function cell(page: PDFPage, font: PDFFont, cx: number, cy: number, labels: string[], labelGap = 4, scale = 1) {
  page.drawEllipse({ x: cx, y: top(cy), xScale: 110 * scale, yScale: 70 * scale, borderColor: rgb(0, 0, 0), borderWidth: 1.4 });
  page.drawEllipse({ x: cx + 12 * scale, y: top(cy + 4 * scale), xScale: 28 * scale, yScale: 22 * scale, color: rgb(0.72, 0.72, 0.72), borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  for (const [dx, dy] of [[-55, -25], [-60, 25], [60, -30], [55, 35]] as const) page.drawCircle({ x: cx + dx * scale, y: top(cy + dy * scale), size: 2 * scale, color: rgb(0.3, 0.3, 0.3) });
  const leaders = [
    { from: [cx + 95 * scale, cy - 30 * scale], to: [cx + 140 * scale, cy - 52 * scale] },
    { from: [cx + 40 * scale, cy + 22 * scale], to: [cx + 140 * scale, cy + 42 * scale] },
    { from: [cx + 10 * scale, cy + 2 * scale], to: [cx - 140 * scale, cy + 58 * scale] },
  ];
  labels.forEach((label, i) => {
    const l = leaders[i]!;
    page.drawLine({ start: { x: l.from[0]!, y: top(l.from[1]!) }, end: { x: l.to[0]!, y: top(l.to[1]!) }, thickness: 0.8 });
    const right = l.to[0]! > cx;
    const width = font.widthOfTextAtSize(label, 11);
    text(page, font, label, right ? l.to[0]! + labelGap : l.to[0]! - labelGap - width, l.to[1]! + 4, 11);
  });
}

/** Bounds (pt, top origin) of `cell(…)` with three labels and the default gap: membrane + leaders + labels. */
const cellBox = (cx: number, cy: number, labelGap = 4, extra = 0, scale = 1): Box => ({ x0: cx - 140 * scale - labelGap - 8 - extra, y0: cy - 70 * scale, x1: cx + 140 * scale + labelGap + 8 + extra, y1: cy + 70 * scale });

function bar(page: PDFPage, x: number, y: number, parts: number, shaded: number) {
  const w = 300;
  const h = 40;
  for (let i = 0; i < parts; i++) page.drawRectangle({ x: x + (i * w) / parts, y: top(y + h), width: w / parts, height: h, color: i < shaded ? rgb(0.6, 0.6, 0.6) : rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.4 });
}

function flower(page: PDFPage, cx: number, cy: number) {
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    page.drawCircle({ x: cx + 22 * Math.cos(a), y: top(cy) + 22 * Math.sin(a), size: 14, borderColor: rgb(0, 0, 0), borderWidth: 1.1 });
  }
  page.drawCircle({ x: cx, y: top(cy), size: 10, color: rgb(0.3, 0.3, 0.3) });
}

const ACT1_CELL = "Observa el esquema de la célula animal. Escribe el nombre de las partes señaladas con los números 1, 2 y 3.";
const CELL_ANSWER = "1: membrana plasmática; 2: citoplasma; 3: núcleo";
const ACT2 = "¿Qué función tiene el núcleo? Explícalo con tus palabras.";

/** The common sheet: title, name field, activity 1 at y=132 (two lines), its answer lines, activity 2 at y=470. */
function sheet(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, act1: string) {
  text(page, fonts.bold, "La célula animal", 60, 60, 16);
  text(page, fonts.regular, "Nombre: ____________________   Fecha: __________", 60, 92, 10);
  text(page, fonts.bold, "1.", 60, 132);
  const cut = act1.lastIndexOf(" ", 70);
  text(page, fonts.regular, act1.slice(0, cut), 76, 132);
  text(page, fonts.regular, act1.slice(cut + 1), 76, 146);
  answerLines(page, [380, 402, 424]);
  text(page, fonts.bold, "2.", 60, 470);
  text(page, fonts.regular, ACT2, 76, 470);
  answerLines(page, [498, 520, 542]);
}

const activities = (act1 = ACT1_CELL): PageActivity[] => [
  { id: "act_1", label: "1", instruction: act1, expectedAnswer: CELL_ANSWER },
  { id: "act_2", label: "2", instruction: ACT2, expectedAnswer: null },
];

export const CASES: FixtureCase[] = [
  {
    id: "cell_labels",
    description: "Célula con etiquetas 1, 2 y 3 junto a la actividad que la nombra",
    activities: activities(),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: cellBox(250, 255), acceptable: true }],
    distractors: { answer_lines: { x0: 76, y0: 372, x1: 520, y1: 430 } },
    scan: { noise: true },
    draw: (page, f) => {
      sheet(page, f, ACT1_CELL);
      cell(page, f.regular, 250, 255, ["1", "2", "3"]);
    },
  },
  {
    id: "two_similar",
    description: "Dos células casi iguales en la zona de la misma actividad: no se puede saber cuál",
    activities: activities("Observa la célula A. Escribe el nombre de las partes señaladas con los números 1, 2 y 3."),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: cellBox(175, 265, 4, 0, 0.55), acceptable: false }],
    distractors: { other_cell: cellBox(425, 265, 4, 0, 0.55) },
    scan: { noise: true },
    draw: (page, f) => {
      sheet(page, f, "Observa la célula A. Escribe el nombre de las partes señaladas con los números 1, 2 y 3.");
      cell(page, f.regular, 175, 265, ["1", "2", "3"], 4, 0.55);
      cell(page, f.regular, 425, 265, ["1", "2", "3"], 4, 0.55);
    },
  },
  {
    id: "decorative",
    description: "Una flor decorativa grande en la cabecera, fuera de toda actividad",
    activities: activities(),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: cellBox(250, 255), acceptable: true }],
    distractors: { flower: { x0: 440, y0: 30, x1: 520, y1: 110 } },
    scan: { noise: true },
    draw: (page, f) => {
      sheet(page, f, ACT1_CELL);
      cell(page, f.regular, 250, 255, ["1", "2", "3"]);
      flower(page, 480, 70);
    },
  },
  {
    id: "big_text",
    description: "Un rótulo enorme («CÉLULA») junto a la figura: texto, no dibujo",
    activities: activities(),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: cellBox(230, 255), acceptable: true }],
    distractors: { headline: { x0: 300, y0: 600, x1: 560, y1: 660 } },
    scan: { noise: true },
    draw: (page, f) => {
      sheet(page, f, ACT1_CELL);
      cell(page, f.regular, 230, 255, ["1", "2", "3"]);
      text(page, f.bold, "CÉLULA", 300, 655, 60);
    },
  },
  {
    id: "incomplete",
    description: "La figura se sale por el borde derecho: el recorte la daría incompleta",
    activities: activities(),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: { x0: 400, y0: 185, x1: 595, y1: 325 }, acceptable: false }],
    distractors: {},
    scan: { noise: true },
    draw: (page, f) => {
      sheet(page, f, ACT1_CELL);
      cell(page, f.regular, 540, 255, ["1", "2", "3"]);
    },
  },
  {
    id: "far_labels",
    description: "Los números están a más de 1 cm de sus líneas: un recorte del dibujo los perdería",
    activities: activities(),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: cellBox(250, 255, 34), acceptable: false }],
    distractors: {},
    scan: { noise: true },
    draw: (page, f) => {
      sheet(page, f, ACT1_CELL);
      cell(page, f.regular, 250, 255, ["1", "2", "3"], 34);
    },
  },
  {
    id: "other_activity",
    description: "La figura está impresa en la zona de la actividad 2, pero el análisis la asigna a la 1",
    activities: activities(),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: cellBox(250, 640), acceptable: false }],
    distractors: {},
    scan: { noise: true },
    draw: (page, f) => {
      sheet(page, f, ACT1_CELL);
      cell(page, f.regular, 250, 640, ["1", "2", "3"]);
    },
  },
  {
    id: "rotated_noisy",
    description: "La célula escaneada torcida 1,5°, con grano y sombra de escáner",
    activities: activities(),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: cellBox(250, 255), acceptable: true }],
    distractors: { answer_lines: { x0: 76, y0: 372, x1: 520, y1: 430 } },
    scan: { noise: true, rotateDeg: 1.5 },
    draw: (page, f) => {
      sheet(page, f, ACT1_CELL);
      cell(page, f.regular, 250, 255, ["1", "2", "3"]);
    },
  },
  {
    id: "multi",
    description: "Tres actividades y dos figuras: una barra en la 1 y una célula con letras A y B en la 3",
    activities: [
      { id: "act_1", label: "1", instruction: "Observa la barra. ¿Qué fracción de la barra está coloreada?", expectedAnswer: "3/8" },
      { id: "act_2", label: "2", instruction: "Escribe una fracción equivalente a un medio.", expectedAnswer: null },
      { id: "act_3", label: "3", instruction: "Observa la célula. Escribe qué parte señalan las letras A y B.", expectedAnswer: "A: membrana; B: núcleo" },
    ],
    visuals: [
      { id: "vis_1", activityId: "act_1", kind: "bar", labels: [], truth: { x0: 120, y0: 170, x1: 420, y1: 210 }, acceptable: true },
      { id: "vis_2", activityId: "act_3", kind: "figure", labels: ["A", "B"], truth: { x0: 98, y0: 545, x1: 402, y1: 685 }, acceptable: true },
    ],
    distractors: {},
    scan: { noise: true },
    draw: (page, f) => {
      text(page, f.bold, "Repaso", 60, 60, 16);
      text(page, f.bold, "1.", 60, 132);
      text(page, f.regular, "Observa la barra. ¿Qué fracción de la barra está coloreada?", 76, 132);
      bar(page, 120, 170, 8, 3);
      answerLines(page, [250]);
      text(page, f.bold, "2.", 60, 300);
      text(page, f.regular, "Escribe una fracción equivalente a un medio.", 76, 300);
      answerLines(page, [340, 362]);
      text(page, f.bold, "3.", 60, 450);
      text(page, f.regular, "Observa la célula. Escribe qué parte señalan las letras A y B.", 76, 450);
      cell(page, f.regular, 250, 615, ["A", "B"]);
      answerLines(page, [720, 742]);
    },
  },
  {
    id: "no_figure",
    description: "La ficha no contiene la figura que el análisis cree ver",
    activities: activities(),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: ["1", "2", "3"], truth: null, acceptable: false }],
    distractors: { where_it_would_be: cellBox(250, 255) },
    scan: { noise: true },
    draw: (page, f) => sheet(page, f, ACT1_CELL),
  },
  {
    id: "answer_leak",
    description: "El esquema rotula «núcleo» y la actividad pide escribir ese nombre: recortarlo daría la solución",
    activities: activities("Observa el esquema. Escribe el nombre de la parte más oscura de la célula."),
    visuals: [{ id: "vis_1", activityId: "act_1", kind: "figure", labels: [], truth: cellBox(250, 255, 30), acceptable: false }],
    distractors: {},
    scan: { noise: true },
    draw: (page, f) => {
      sheet(page, f, "Observa el esquema. Escribe el nombre de la parte más oscura de la célula.");
      cell(page, f.regular, 250, 255, ["membrana", "citoplasma", "núcleo"]);
    },
  },
];

export interface ScannedCase {
  model: PageModel;
  sha256: string;
  /** pt (top origin) → normalised region on the scanned page (same skew as the pixels). */
  toRegion(box: Box): { x: number; y: number; w: number; h: number };
}

const rotatePt = (x: number, y: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  const cx = A4.w / 2;
  const cy = A4.h / 2;
  return { x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) };
};

/** The vector sheet → its scan (pixels) + its text layer as a perfect (or lossy) local OCR would give it. */
export async function scanCase(c: FixtureCase, options: { dpi?: number; ocrLoss?: number } = {}): Promise<ScannedCase> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.w, A4.h]);
  c.draw(page, { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) });
  const vector = await pdf.save({ useObjectStreams: false });
  const dpi = options.dpi ?? 100;
  const raster = await renderPage(vector, "application/pdf", 1, { dpi, maxPx: 4096 });
  const deg = c.scan.rotateDeg ?? 0;
  const canvas = createCanvas(raster.width, raster.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, raster.width, raster.height);
  ctx.translate(raster.width / 2, raster.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(raster.canvas, -raster.width / 2, -raster.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rgba = pageRgba({ ...raster, canvas });
  const gray = lumaOf(rgba, raster.width, raster.height);
  if (c.scan.noise) {
    let seed = 0x9e3779b9;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const shadow = Math.round((4 / 25.4) * dpi);
    for (let i = 0; i < gray.length; i++) {
      const x = i % raster.width;
      let v = gray[i]! * 0.96 + (rand() - 0.5) * 10;
      if (x < shadow) v = Math.min(v, 50 + (x / shadow) * 110);
      gray[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  const toRegion = (b: Box) => {
    const corners = [rotatePt(b.x0, b.y0, deg), rotatePt(b.x1, b.y0, deg), rotatePt(b.x0, b.y1, deg), rotatePt(b.x1, b.y1, deg)];
    const xs = corners.map((p) => Math.min(A4.w, Math.max(0, p.x)));
    const ys = corners.map((p) => Math.min(A4.h, Math.max(0, p.y)));
    const x0 = Math.min(...xs) / A4.w;
    const y0 = Math.min(...ys) / A4.h;
    return { x: x0, y: y0, w: Math.max(...xs) / A4.w - x0, h: Math.max(...ys) / A4.h - y0 };
  };
  // The text layer, moved with the pixels: what a local OCR of this scan would report at best.
  let seed = 7;
  const drop = () => ((seed = (seed * 48271) % 2147483647) / 2147483647) < (options.ocrLoss ?? 0);
  const texts = (await pageText(vector, "application/pdf", 1))
    .filter((t) => !(t.text.trim().length <= 2 && drop()))
    .map((t) => ({ text: t.text, ...toRegion({ x0: t.x * A4.w, y0: t.y * A4.h, x1: (t.x + t.w) * A4.w, y1: (t.y + t.h) * A4.h }) }));
  const model: PageModel = { width: raster.width, height: raster.height, gray, texts: textBoxesToPx(texts, raster.width, raster.height), mmPerPx: 210 / raster.width };
  return { model, sha256: createHash("sha256").update(vector).digest("hex"), toRegion };
}
