import { rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PilotPage } from "../ocr-pilot/metrics";
import { degrade } from "../ocr-pilot/pages";
import { scanCase, type CaseVisual, type FixtureCase } from "./fixtures";
import type { PageActivity } from "./verify";

/**
 * Phase II geometry sheets, drawn as vectors for this phase (original, synthetic) and delivered as scanned pixels. Grouped by
 * drawing FAMILY; development and holdout never share a family variant, and the holdout is run once, after the rules are fixed.
 * Negative sheets carry a visual with `truth: null` or `acceptable: false`: any candidate there is a false positive.
 */

const A4 = { w: 595.28, h: 841.89 } as const;
const top = (y: number) => A4.h - y;
type Fonts = { regular: PDFFont; bold: PDFFont };
type Box = { x0: number; y0: number; x1: number; y1: number };
const INK = rgb(0.15, 0.15, 0.15);

const text = (p: PDFPage, f: PDFFont, s: string, x: number, y: number, size = 11) => p.drawText(s, { x, y: top(y), size, font: f, color: rgb(0, 0, 0) });
const line = (p: PDFPage, x0: number, y0: number, x1: number, y1: number, t = 1) => p.drawLine({ start: { x: x0, y: top(y0) }, end: { x: x1, y: top(y1) }, thickness: t, color: INK });
const rect = (p: PDFPage, x: number, y: number, w: number, h: number, fill?: number, t = 1.4) =>
  p.drawRectangle({ x, y: top(y + h), width: w, height: h, borderColor: INK, borderWidth: t, ...(fill === undefined ? {} : { color: rgb(fill, fill, fill) }) });
const pad = (b: Box, d = 8): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
const act = (id: string, label: string, instruction: string): PageActivity => ({ id, label, instruction, expectedAnswer: null });
const vis = (id: string, activityId: string, kind: CaseVisual["kind"], labels: string[], truth: Box | null, acceptable = true): CaseVisual => ({ id, activityId, kind, labels, truth: truth && pad(truth), acceptable });

/** Header, numbered instructions (x, y in pt) and the footer rule every sheet has. */
function sheet(p: PDFPage, f: Fonts, title: string, ins: Array<{ n: string; text: string; x?: number; y: number }>) {
  text(p, f.bold, title, 60, 60, 15);
  line(p, 50, 75, 545, 75, 0.8);
  for (const i of ins) { text(p, f.bold, `${i.n}.`, i.x ?? 60, i.y); text(p, f.regular, i.text, (i.x ?? 60) + 16, i.y); }
}
const answerLines = (p: PDFPage, ys: number[], x0 = 76, x1 = 520) => ys.forEach((y) => line(p, x0, y, x1, y, 0.6));

function bar(p: PDFPage, x: number, y: number, w: number, h: number, parts: number, shaded: number, fill = 0.6, t = 1.4) {
  for (let i = 0; i < parts; i++) rect(p, x + (i * w) / parts, y, w / parts, h, i < shaded ? fill : undefined, t);
}
function numberLine(p: PDFPage, f: PDFFont, x: number, y: number, w: number, ticks: string[], arrows = false) {
  line(p, x, y, x + w, y, 1.3);
  ticks.forEach((t, i) => {
    const tx = x + 15 + (i * (w - 30)) / (ticks.length - 1);
    line(p, tx, y - 6, tx, y + 6, 1.1);
    text(p, f, t, tx - f.widthOfTextAtSize(t, 11) / 2, y + 20);
  });
  if (arrows) { line(p, x + w, y, x + w - 8, y - 5, 1.3); line(p, x + w, y, x + w - 8, y + 5, 1.3); line(p, x, y, x + 8, y - 5, 1.3); line(p, x, y, x + 8, y + 5, 1.3); }
}
function clock(p: PDFPage, f: PDFFont, cx: number, cy: number, r: number, numbers: Record<string, number>) {
  p.drawCircle({ x: cx, y: top(cy), size: r, borderColor: INK, borderWidth: 1.6 });
  for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI; line(p, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8), 1.2); }
  for (const [n, k] of Object.entries(numbers)) { const a = (k / 12) * 2 * Math.PI - Math.PI / 2; text(p, f, n, cx + Math.cos(a) * (r - 20) - 4, cy + Math.sin(a) * (r - 20) + 4); }
  line(p, cx, cy, cx, cy - r * 0.6, 2.4);
  line(p, cx, cy, cx + r * 0.45, cy + r * 0.2, 2.4);
}
function triangle(p: PDFPage, x: number, y: number, w: number, h: number) { line(p, x, y + h, x + w, y + h, 1.4); line(p, x + w, y + h, x + w / 2, y, 1.4); line(p, x + w / 2, y, x, y + h, 1.4); }
/** A schematic flower with leaders ending `gap` pt from their labels. */
function flower(p: PDFPage, f: PDFFont, cx: number, cy: number, labels: string[], gap = 6, diagonal = false) {
  for (let i = 0; i < 5; i++) { const a = (i / 5) * 2 * Math.PI; p.drawCircle({ x: cx + Math.cos(a) * 18, y: top(cy + Math.sin(a) * 18), size: 12, borderColor: INK, borderWidth: 1.1 }); }
  p.drawCircle({ x: cx, y: top(cy), size: 8, color: rgb(0.45, 0.45, 0.45) });
  line(p, cx, cy + 30, cx, cy + 110, 1.6);
  p.drawEllipse({ x: cx + 18, y: top(cy + 80), xScale: 16, yScale: 7, borderColor: INK, borderWidth: 1.1 });
  const ends = [[cx + 25, cy - 25], [cx + 30, cy + 80], [cx, cy + 100]] as const;
  labels.forEach((l, i) => {
    const [ex, ey] = ends[i]!;
    const lx = diagonal ? ex + 55 : ex + 65, ly = diagonal ? ey - 25 + i * 10 : ey;
    line(p, ex, ey, lx, ly, 0.8);
    text(p, f, l, lx + gap, ly + 4);
  });
}

const case_ = (id: string, family: string, activities: PageActivity[], visuals: CaseVisual[], draw: (p: PDFPage, f: Fonts) => void, scan: FixtureCase["scan"] = { noise: true }, distractors: Record<string, Box> = {}): FixtureCase & { family: string } =>
  ({ id, family, description: family, activities, visuals, distractors, scan, draw });

const INS = {
  bar: "Observa la barra con atención. ¿Qué fracción está coloreada?",
  line: "Observa la recta numérica. ¿Qué número señala la letra A?",
  clock: "Observa el reloj de la cocina. ¿Qué hora marca ahora mismo?",
  tri: "Observa el triángulo de la izquierda. Colorea su interior.",
  rect: "Observa el rectángulo de la derecha. Colorea su interior.",
  flower: "Escribe el nombre de las partes señaladas con los números 1, 2 y 3.",
  figure: "Observa el dibujo con atención y describe lo que representa.",
};

export const GEOMETRY_DEV = [
  case_("d_barra_seis", "barra", [act("act_1", "1", INS.bar)], [vis("vis_1", "act_1", "bar", [], { x0: 120, y0: 150, x1: 440, y1: 200 })],
    (p, f) => { sheet(p, f, "Fracciones", [{ n: "1", text: INS.bar, y: 120 }]); bar(p, 120, 150, 320, 50, 6, 2); answerLines(p, [260, 285]); }),
  case_("d_recta_letra", "recta", [act("act_1", "1", INS.line)], [vis("vis_1", "act_1", "number_line", ["A", "0", "1", "2", "3", "4", "5"], { x0: 100, y0: 165, x1: 480, y1: 230 })],
    (p, f) => { sheet(p, f, "Recta", [{ n: "1", text: INS.line, y: 120 }]); numberLine(p, f.regular, 100, 200, 380, ["0", "1", "2", "3", "4", "5"]); text(p, f.bold, "A", 245, 180); line(p, 249, 183, 249, 195, 0.9); answerLines(p, [290]); },
    { noise: true, rotateDeg: 1.8 }),
  case_("d_reloj", "reloj", [act("act_1", "1", INS.clock)], [vis("vis_1", "act_1", "figure", ["12", "3", "6", "9"], { x0: 230, y0: 150, x1: 370, y1: 290 })],
    (p, f) => { sheet(p, f, "La hora", [{ n: "1", text: INS.clock, y: 120 }]); clock(p, f.bold, 300, 220, 70, { "12": 0, "3": 3, "6": 6, "9": 9 }); answerLines(p, [330]); }),
  case_("d_columnas", "columnas", [act("act_1", "1", INS.tri), act("act_2", "2", INS.rect)],
    [vis("vis_1", "act_1", "figure", [], { x0: 80, y0: 170, x1: 220, y1: 290 }), vis("vis_2", "act_2", "figure", [], { x0: 340, y0: 180, x1: 500, y1: 280 })],
    (p, f) => {
      text(p, f.bold, "Figuras", 60, 60, 15); line(p, 50, 75, 545, 75, 0.8);
      text(p, f.bold, "1.", 50, 120); text(p, f.regular, "Observa el triángulo de la izquierda.", 64, 120); text(p, f.regular, "Colorea su interior.", 64, 134);
      text(p, f.bold, "2.", 310, 120); text(p, f.regular, "Observa el rectángulo de la derecha.", 324, 120); text(p, f.regular, "Colorea su interior.", 324, 134);
      line(p, 298, 100, 298, 320, 0.6);
      triangle(p, 80, 170, 140, 120); rect(p, 340, 180, 160, 100);
    }),
  case_("d_esquema", "esquema", [act("act_1", "1", INS.flower)], [vis("vis_1", "act_1", "figure", ["1", "2", "3"], { x0: 222, y0: 140, x1: 350, y1: 290 })],
    (p, f) => { sheet(p, f, "La planta", [{ n: "1", text: INS.flower, y: 120 }]); flower(p, f.bold, 250, 180, ["1", "2", "3"]); answerLines(p, [330, 352]); }),
  case_("dn_sin_figura", "sin_figura", [act("act_1", "1", INS.figure)], [vis("vis_1", "act_1", "figure", [], null)],
    (p, f) => { sheet(p, f, "Escribe", [{ n: "1", text: INS.figure, y: 120 }]); answerLines(p, [160, 185, 210, 235]); for (let i = 0; i < 6; i++) line(p, 60 + i * 80, 300, 100 + i * 80, 300, 2.5); }),
  case_("dn_tabla_barra", "tabla", [act("act_1", "1", INS.bar)], [vis("vis_1", "act_1", "bar", [], null)],
    (p, f) => { sheet(p, f, "Fracciones", [{ n: "1", text: INS.bar, y: 120 }]); for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) rect(p, 120 + c * 80, 150 + r * 30, 80, 30); },
    { noise: true }, { tabla: { x0: 120, y0: 150, x1: 440, y1: 240 } }),
  case_("dn_dos_figuras", "competidoras", [act("act_1", "1", INS.tri)], [vis("vis_1", "act_1", "figure", [], { x0: 90, y0: 170, x1: 230, y1: 290 }, false)],
    (p, f) => { sheet(p, f, "Triángulos", [{ n: "1", text: INS.tri, y: 120 }]); triangle(p, 90, 170, 140, 120); triangle(p, 330, 170, 140, 120); },
    { noise: true }, { otro: { x0: 330, y0: 170, x1: 470, y1: 290 } }),
  case_("dn_cortada", "cortada", [act("act_1", "1", INS.bar)], [vis("vis_1", "act_1", "bar", [], { x0: 300, y0: 150, x1: 595, y1: 200 }, false)],
    (p, f) => { sheet(p, f, "Fracciones", [{ n: "1", text: INS.bar, y: 120 }]); bar(p, 300, 150, 340, 50, 6, 2); }),
  case_("dn_cruza_columnas", "cruza", [act("act_1", "1", INS.tri), act("act_2", "2", INS.rect)], [vis("vis_1", "act_1", "figure", [], { x0: 200, y0: 170, x1: 400, y1: 290 }, false)],
    (p, f) => {
      text(p, f.bold, "Figuras", 60, 60, 15); line(p, 50, 75, 545, 75, 0.8);
      text(p, f.bold, "1.", 50, 120); text(p, f.regular, "Observa el triángulo de la izquierda.", 64, 120);
      text(p, f.bold, "2.", 310, 120); text(p, f.regular, "Observa el rectángulo de la derecha.", 324, 120);
      triangle(p, 200, 170, 200, 120);
    }),
];

const HINS = {
  bar: "Mira la barra dividida en partes. Escribe la fracción sombreada.",
  line: "Mira la recta y escribe qué fracción falta en el recuadro vacío.",
  clock: "Mira el reloj del colegio y escribe la hora que marca.",
  twoA: "Observa la figura de esta columna y cuenta sus lados.",
  twoB: "Observa la figura de esta columna y cuenta sus vértices.",
  flower: "Escribe el nombre de las partes señaladas con los números 1, 2 y 3.",
  next: "Escribe en tu cuaderno una frase sobre lo que has observado.",
};

export const GEOMETRY_HOLDOUT = [
  case_("h_barra_gris", "barra", [act("act_1", "1", HINS.bar)], [vis("vis_1", "act_1", "bar", [], { x0: 140, y0: 160, x1: 420, y1: 200 })],
    (p, f) => { sheet(p, f, "Partes", [{ n: "1", text: HINS.bar, y: 120 }]); bar(p, 140, 160, 280, 40, 4, 1, 0.7, 0.9); answerLines(p, [250]); }),
  case_("h_recta_flechas", "recta", [act("act_1", "1", HINS.line)], [vis("vis_1", "act_1", "number_line", ["0", "1"], { x0: 90, y0: 175, x1: 500, y1: 240 })],
    (p, f) => { sheet(p, f, "Fracciones en la recta", [{ n: "1", text: HINS.line, y: 120 }]); numberLine(p, f.regular, 90, 205, 410, ["0", "1/4", "2/4", "3/4", "1"], true); },
    { noise: true, rotateDeg: -2.5 }),
  case_("h_reloj_completo", "reloj", [act("act_1", "1", HINS.clock)], [vis("vis_1", "act_1", "figure", ["12", "3", "6", "9"], { x0: 210, y0: 140, x1: 390, y1: 320 })],
    (p, f) => { sheet(p, f, "Horario", [{ n: "1", text: HINS.clock, y: 120 }]); clock(p, f.regular, 300, 230, 90, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i === 0 ? 12 : i), i]))); }),
  case_("h_columnas_parecidas", "columnas", [act("act_1", "1", HINS.twoA), act("act_2", "2", HINS.twoB)],
    [vis("vis_1", "act_1", "figure", [], { x0: 80, y0: 180, x1: 230, y1: 300 }), vis("vis_2", "act_2", "figure", [], { x0: 350, y0: 180, x1: 490, y1: 300 })],
    (p, f) => {
      text(p, f.bold, "Lados y vértices", 60, 60, 15); line(p, 50, 75, 545, 75, 0.8);
      text(p, f.bold, "1.", 50, 120); text(p, f.regular, "Observa la figura de esta columna", 64, 120); text(p, f.regular, "y cuenta sus lados.", 64, 134);
      text(p, f.bold, "2.", 310, 120); text(p, f.regular, "Observa la figura de esta columna", 324, 120); text(p, f.regular, "y cuenta sus vértices.", 324, 134);
      triangle(p, 80, 180, 150, 120); rect(p, 350, 190, 140, 100);
    }),
  case_("h_esquema_diagonal", "esquema", [act("act_1", "1", HINS.flower)], [vis("vis_1", "act_1", "figure", ["1", "2", "3"], { x0: 222, y0: 125, x1: 365, y1: 290 })],
    (p, f) => { sheet(p, f, "Partes de la flor", [{ n: "1", text: HINS.flower, y: 120 }]); flower(p, f.regular, 250, 180, ["1", "2", "3"], 9, true); },
    { noise: true, rotateDeg: 2 }),
  case_("hn_respuesta_dibujada", "respuesta", [act("act_1", "1", HINS.bar)], [vis("vis_1", "act_1", "bar", [], { x0: 140, y0: 160, x1: 420, y1: 200 }, false)],
    (p, f) => { sheet(p, f, "Partes", [{ n: "1", text: HINS.bar, y: 120 }]); bar(p, 140, 160, 280, 40, 4, 1); text(p, f.bold, "1/4", 440, 185, 16); }),
  case_("hn_superpuestas", "superpuestas", [act("act_1", "1", HINS.twoA)], [vis("vis_1", "act_1", "figure", [], { x0: 150, y0: 160, x1: 330, y1: 290 }, false)],
    (p, f) => { sheet(p, f, "Figuras", [{ n: "1", text: HINS.twoA, y: 120 }]); triangle(p, 150, 170, 140, 120); rect(p, 230, 160, 140, 100); }),
  case_("hn_recuadros", "recuadros", [act("act_1", "1", HINS.next)], [vis("vis_1", "act_1", "figure", [], null)],
    (p, f) => { sheet(p, f, "Escritura", [{ n: "1", text: HINS.next, y: 120 }]); rect(p, 80, 160, 200, 80, undefined, 1); rect(p, 320, 160, 200, 80, undefined, 1); for (let x = 60; x < 540; x += 12) line(p, x, 300 + (x % 24 ? 4 : -4), x + 12, 300 + (x % 24 ? -4 : 4), 0.9); }),
  case_("hn_entre_actividades", "entre", [act("act_1", "1", HINS.twoA), act("act_2", "2", HINS.next)], [vis("vis_1", "act_1", "figure", [], { x0: 220, y0: 200, x1: 380, y1: 330 }, false)],
    (p, f) => { sheet(p, f, "Figuras", [{ n: "1", text: HINS.twoA, y: 120 }, { n: "2", text: HINS.next, y: 260 }]); rect(p, 220, 200, 160, 130); }),
  case_("hn_tabla_barra", "tabla", [act("act_1", "1", HINS.bar)], [vis("vis_1", "act_1", "bar", [], null)],
    (p, f) => { sheet(p, f, "Partes", [{ n: "1", text: HINS.bar, y: 120 }]); for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) rect(p, 110 + c * 60, 160 + r * 35, 60, 35, undefined, 1); },
    { noise: true }, { tabla: { x0: 110, y0: 160, x1: 470, y1: 230 } }),
];

const DEGRADED = new Set(["h_barra_gris"]);
const DPI: Record<string, number> = { d_reloj: 150, h_reloj_completo: 150, h_esquema_diagonal: 300 };
const toPx = (w: number, h: number, r: { x: number; y: number; w: number; h: number }) => ({ x0: r.x * w, y0: r.y * h, x1: (r.x + r.w) * w, y1: (r.y + r.h) * h });

export async function* geometryPages(split: "dev" | "holdout"): AsyncGenerator<PilotPage> {
  for (const c of split === "dev" ? GEOMETRY_DEV : GEOMETRY_HOLDOUT) {
    const dpi = DPI[c.id] ?? 200;
    const s = await scanCase(c, { dpi });
    if (DEGRADED.has(c.id)) degrade(s.model);
    const upright = await scanCase({ ...c, scan: { noise: false, rotateDeg: 0 } }, { dpi });
    const W = s.model.width, H = s.model.height;
    yield {
      id: c.id, docType: c.family, condition: split, dpi, model: { ...s.model, texts: [] }, truth: s.model.texts, truthUpright: upright.model.texts,
      scanRotationDeg: c.scan.rotateDeg ?? 0, sha256: s.sha256, activities: c.activities,
      visuals: c.visuals.map((v) => ({ id: v.id, activityId: v.activityId, kind: v.kind, labels: v.labels, truth: v.truth ? toPx(W, H, s.toRegion(v.truth)) : null, acceptable: v.acceptable })),
      distractors: Object.values(c.distractors).map((d) => toPx(W, H, s.toRegion(d))),
    };
  }
}
