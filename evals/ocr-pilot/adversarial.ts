import { StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { scanCase, type FixtureCase } from "../visual-location/fixtures";
import type { PageActivity } from "../visual-location/verify";
import type { TextBox } from "@/lib/materials/visuals/auto/page-model";
import { normalizeAnchorText } from "./anchor-association";
import type { PilotPage } from "./metrics";
import { degrade } from "./pages";

/**
 * Adversarial synthetic sheets for Phase I, drawn as vectors by us (no third-party material) and delivered as pixels. Their vector
 * text layer is the reference for SCORING only. Two disjoint sets:
 *
 *   dev      reproduces each error class while developing the recognition rules (thresholds may be checked against it);
 *   holdout  different fonts, sizes and layouts for the same classes; run once at the end, never used to choose a threshold.
 *
 * They are not real scans and do not estimate accuracy on classroom material.
 */

const A4 = { w: 595.28, h: 841.89 } as const;
const top = (y: number) => A4.h - y;
type Fonts = { regular: PDFFont; bold: PDFFont };
type Draw = (page: PDFPage, fonts: Fonts) => void;

const text = (page: PDFPage, font: PDFFont, s: string, x: number, y: number, size = 11) => page.drawText(s, { x, y: top(y), size, font, color: rgb(0, 0, 0) });
const line = (page: PDFPage, x0: number, y0: number, x1: number, y1: number, thickness = 0.9) =>
  page.drawLine({ start: { x: x0, y: top(y0) }, end: { x: x1, y: top(y1) }, thickness, color: rgb(0.2, 0.2, 0.2) });
const std = (page: PDFPage, name: StandardFonts) => page.doc.embedStandardFont(name);

/** Header, numbered instruction (possibly wrapped) and answer lines: the frame shared by every sheet. */
function frame(page: PDFPage, f: Fonts, title: string, instructions: Array<{ n: string; lines: string[]; y: number; x?: number }>) {
  text(page, f.bold, title, 60, 60, 15);
  for (const ins of instructions) {
    text(page, f.bold, `${ins.n}.`, ins.x ?? 60, ins.y);
    ins.lines.forEach((l, i) => text(page, f.regular, l, (ins.x ?? 60) + 16, ins.y + 14 * i));
  }
}

/** Labels at the end of leader lines around a centre; `gap` pt between leader end and label (0 = touching). */
function leaders(page: PDFPage, font: PDFFont, cx: number, cy: number, labels: string[], size: number, gap = 4, radius = 90) {
  labels.forEach((l, i) => {
    const a = (i / labels.length) * 2 * Math.PI - Math.PI / 4;
    const ex = cx + Math.cos(a) * radius, ey = cy + Math.sin(a) * radius * 0.7;
    line(page, cx + Math.cos(a) * 35, cy + Math.sin(a) * 25, ex, ey);
    const w = font.widthOfTextAtSize(l, size);
    text(page, font, l, Math.cos(a) >= 0 ? ex + gap : ex - gap - w, ey + size * 0.35, size);
  });
}

const act = (id: string, label: string, instruction: string): PageActivity => ({ id, label, instruction, expectedAnswer: null });
const sheet = (id: string, description: string, activities: PageActivity[], draw: Draw, scan: FixtureCase["scan"] = { noise: true }): FixtureCase =>
  ({ id, description, activities, visuals: [], distractors: {}, scan, draw });

/** Hatching, dots, crosses and short strokes: drawings with many marks that are not text. */
function marks(page: PDFPage, x: number, y: number, w: number, h: number) {
  page.drawRectangle({ x, y: top(y + h), width: w, height: h, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  for (let k = 0; k < w + h; k += 9) line(page, x + Math.max(0, k - h), y + Math.min(h, k), x + Math.min(w, k), y + Math.max(0, k - w), 0.6);
  for (let i = 0; i < 6; i++) page.drawCircle({ x: x + w + 20 + i * 14, y: top(y + 10 + (i % 2) * 12), size: 1.6, color: rgb(0.2, 0.2, 0.2) });
  for (let i = 0; i < 5; i++) {
    const cx = x + w + 25 + i * 18, cy = y + h - 10;
    line(page, cx - 4, cy - 4, cx + 4, cy + 4, 0.8);
    line(page, cx - 4, cy + 4, cx + 4, cy - 4, 0.8);
  }
}

const INS_CG = "Observa la figura. Escribe qué señalan las letras C, G, O y S.";

export const ADVERSARIAL_DEV: FixtureCase[] = [
  sheet("dev_letras_cg", "C, G, O y S en negrita al final de líneas guía", [act("act_1", "1", INS_CG)], (page, f) => {
    frame(page, f, "Formas", [{ n: "1", lines: [INS_CG], y: 120 }]);
    page.drawEllipse({ x: 300, y: top(300), xScale: 60, yScale: 40, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.2 });
    leaders(page, f.bold, 300, 300, ["C", "G", "O", "S"], 13);
  }),
  sheet("dev_1i_0o", "1, 10, 0 y la letra O como rótulos de una tabla dibujada", [act("act_1", "1", "Observa la tabla. Explica qué indican los rótulos.")], (page, f) => {
    frame(page, f, "Tabla", [{ n: "1", lines: ["Observa la tabla. Explica qué indican los rótulos."], y: 120 }]);
    for (let i = 0; i <= 4; i++) line(page, 120 + i * 80, 200, 120 + i * 80, 320);
    line(page, 120, 200, 440, 200); line(page, 120, 320, 440, 320);
    ["1", "10", "0", "O"].forEach((l, i) => text(page, f.bold, l, 150 + i * 80, 180, 13));
  }),
  sheet("dev_b8", "B, 8, 3 y E aislados", [act("act_1", "1", "Observa el dibujo. Indica qué marcan B, 8, 3 y E.")], (page, f) => {
    frame(page, f, "Señales", [{ n: "1", lines: ["Observa el dibujo. Indica qué marcan B, 8, 3 y E."], y: 120 }]);
    page.drawRectangle({ x: 200, y: top(330), width: 200, height: 120, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.2 });
    leaders(page, f.bold, 300, 270, ["B", "8", "3", "E"], 13);
  }),
  sheet("dev_numeros_marcas", "Regla con números que tocan sus marcas", [act("act_1", "1", "Observa la regla. ¿Qué número está más a la derecha?")], (page, f) => {
    frame(page, f, "Medir", [{ n: "1", lines: ["Observa la regla. ¿Qué número está más a la derecha?"], y: 120 }]);
    line(page, 100, 260, 500, 260, 1.2);
    for (let i = 0; i <= 5; i++) {
      line(page, 110 + i * 75, 245, 110 + i * 75, 262, 1.1);
      text(page, f.bold, String(i), 110 + i * 75 + 0.5, 244, 12); // the digit's left edge touches the tick
    }
  }),
  sheet("dev_dos_columnas", "Dos columnas con consignas casi iguales", [act("act_1", "1", "Observa con atención la figura A. Colorea la mitad."), act("act_2", "2", "Observa con atención la figura B. Colorea la mitad.")], (page, f) => {
    frame(page, f, "Mitades", [
      { n: "1", lines: ["Observa con atención la figura A.", "Colorea la mitad."], y: 140, x: 50 },
      { n: "2", lines: ["Observa con atención la figura B.", "Colorea la mitad."], y: 140, x: 320 },
    ]);
    page.drawRectangle({ x: 80, y: top(320), width: 160, height: 100, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.2 });
    page.drawCircle({ x: 430, y: top(270), size: 55, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.2 });
  }),
  sheet("dev_marcas", "Muchas marcas que no son texto y una sola etiqueta", [act("act_1", "1", "Observa el dibujo. ¿Qué parte señala la letra A?")], (page, f) => {
    frame(page, f, "Texturas", [{ n: "1", lines: ["Observa el dibujo. ¿Qué parte señala la letra A?"], y: 120 }]);
    marks(page, 90, 180, 200, 120);
    text(page, f.bold, "A", 300, 245, 13);
  }),
  sheet("dev_girado_degradado", "Letras C, G, O y S girada 2,5° con fotocopia degradada", [act("act_1", "1", INS_CG)], (page, f) => {
    frame(page, f, "Formas", [{ n: "1", lines: [INS_CG], y: 120 }]);
    page.drawEllipse({ x: 300, y: top(300), xScale: 60, yScale: 40, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.2 });
    leaders(page, f.bold, 300, 300, ["C", "G", "O", "S"], 13);
  }, { noise: true, rotateDeg: 2.5 }),
  sheet("dev_consigna_cortada", "Consigna partida en tres líneas con el comienzo corto", [act("act_1", "1", "Observa el mapa y escribe el nombre de los ríos señalados con las letras A y B.")], (page, f) => {
    frame(page, f, "Ríos", [{ n: "1", lines: ["Observa el mapa y", "escribe el nombre de los ríos señalados", "con las letras A y B."], y: 120 }]);
    line(page, 150, 260, 450, 330, 1.4);
    text(page, f.bold, "A", 200, 255, 13);
    text(page, f.bold, "B", 400, 300, 13);
  }),
];

const INS_SERIF = "Mira el esquema. Nombra las zonas marcadas con C, G, Q y O.";

export const ADVERSARIAL_HOLDOUT: FixtureCase[] = [
  sheet("ho_serif_cgqo", "C, G, Q y O en Times negrita", [act("act_1", "1", INS_SERIF)], (page, f) => {
    const times = std(page, StandardFonts.TimesRomanBold);
    frame(page, f, "Esquema", [{ n: "1", lines: [INS_SERIF], y: 120 }]);
    page.drawRectangle({ x: 230, y: top(330), width: 150, height: 110, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.2 });
    leaders(page, times, 305, 275, ["C", "G", "Q", "O"], 15, 5, 110);
  }),
  sheet("ho_courier_confusiones", "1, I, 0, O, B y 8 en Courier", [act("act_1", "1", "Lee los rótulos de la caja y escribe cuáles son números.")], (page, f) => {
    const courier = std(page, StandardFonts.CourierBold);
    frame(page, f, "Rótulos", [{ n: "1", lines: ["Lee los rótulos de la caja y escribe cuáles son números."], y: 120 }]);
    page.drawRectangle({ x: 100, y: top(300), width: 380, height: 90, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
    ["1", "I", "0", "O", "B", "8"].forEach((l, i) => text(page, courier, l, 125 + i * 60, 260, 16));
  }),
  sheet("ho_cuadricula", "Letras dentro de las celdas y números junto a las líneas", [act("act_1", "1", "Busca la casilla del tesoro y escribe su letra y su número.")], (page, f) => {
    frame(page, f, "Tesoro", [{ n: "1", lines: ["Busca la casilla del tesoro y escribe su letra y su número."], y: 120 }]);
    for (let i = 0; i <= 5; i++) line(page, 120 + i * 60, 170, 120 + i * 60, 410, 1);
    for (let j = 0; j <= 4; j++) line(page, 120, 170 + j * 60, 420, 170 + j * 60, 1);
    ["A", "B", "C", "D", "E"].forEach((l, i) => text(page, f.bold, l, 145 + i * 60, 195, 12));
    ["1", "2", "3"].forEach((l, j) => text(page, f.bold, l, 108, 250 + j * 60, 12));
  }),
  sheet("ho_esfera", "Esfera con números que tocan las marcas y muchas marcas", [act("act_1", "1", "Observa la esfera. ¿Qué número señala la flecha?")], (page, f) => {
    frame(page, f, "Esfera", [{ n: "1", lines: ["Observa la esfera. ¿Qué número señala la flecha?"], y: 120 }]);
    const cx = 300, cy = 300, r = 110;
    page.drawCircle({ x: cx, y: top(cy), size: r, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.4 });
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * 2 * Math.PI;
      const l = k % 10 === 0 ? 14 : 6;
      line(page, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * (r - l), cy + Math.sin(a) * (r - l), 1);
    }
    text(page, f.bold, "0", cx + r - 24, cy + 4, 12); // touches the horizontal mark at 0°
    text(page, f.bold, "5", cx - r + 15, cy + 4, 12);
    text(page, f.bold, "2", cx - 4, cy + r - 16, 12);
    text(page, f.bold, "7", cx - 4, cy - r + 26, 12);
    line(page, cx, cy, cx + 50, cy - 50, 2);
  }),
  sheet("ho_columnas_girado", "Dos columnas con consignas parecidas, girado -2°", [act("act_1", "1", "Rodea con un círculo los animales del agua."), act("act_2", "2", "Rodea con un círculo los animales del aire.")], (page, f) => {
    frame(page, f, "Animales", [
      { n: "1", lines: ["Rodea con un círculo los", "animales del agua."], y: 140, x: 50 },
      { n: "2", lines: ["Rodea con un círculo los", "animales del aire."], y: 140, x: 320 },
    ]);
    page.drawRectangle({ x: 70, y: top(330), width: 200, height: 120, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.2 });
    page.drawRectangle({ x: 340, y: top(330), width: 200, height: 120, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.2 });
  }, { noise: true, rotateDeg: -2 }),
  sheet("ho_marcas_degradado", "Flechas, rayas y puntos con etiquetas A y B, fotocopia degradada", [act("act_1", "1", "Observa la textura. Explica la diferencia entre las zonas A y B.")], (page, f) => {
    frame(page, f, "Texturas", [{ n: "1", lines: ["Observa la textura. Explica la diferencia entre las zonas A y B."], y: 120 }]);
    marks(page, 80, 190, 170, 130);
    text(page, f.bold, "A", 265, 230, 13);
    text(page, f.bold, "B", 265, 300, 13);
  }),
  sheet("ho_consigna_partida", "Consigna con el comienzo en una línea aparte", [act("act_1", "1", "Lee el texto y subraya las palabras que indican lugar.")], (page, f) => {
    frame(page, f, "Lugares", [{ n: "1", lines: ["Lee el texto y", "subraya las palabras que indican lugar."], y: 120 }]);
    text(page, f.regular, "El gato duerme debajo de la mesa, junto a la ventana.", 76, 200);
  }),
];

/** Sheets that also get the degraded-photocopy treatment of the historical fixtures (deterministic). */
const DEGRADED = new Set(["dev_girado_degradado", "ho_marcas_degradado"]);

/**
 * The printed lines of each instruction (in drawing order), as an explicit scoring reference like the corpus's
 * `instructionTextIndices`: the matcher-derived synthetic reference merges two columns into one line.
 */
function printedInstructions(truth: readonly TextBox[], activities: readonly PageActivity[]) {
  const anchors: Record<string, TextBox> = {};
  const lines: Record<string, TextBox[]> = {};
  for (const a of activities) {
    const want = normalizeAnchorText(a.instruction);
    for (let i = 0; i < truth.length && !lines[a.id]; i++) {
      for (let j = i; j < truth.length; j++) {
        const got = normalizeAnchorText(truth.slice(i, j + 1).map((t) => t.text).join(" "));
        if (got === want) { lines[a.id] = truth.slice(i, j + 1); anchors[a.id] = truth[i]!; break; }
        if (!want.startsWith(got)) break;
      }
    }
  }
  return { anchorTruth: anchors, instructionTruth: lines };
}

export async function* adversarialPages(split: "dev" | "holdout", dpi = 200): AsyncGenerator<PilotPage> {
  for (const c of split === "dev" ? ADVERSARIAL_DEV : ADVERSARIAL_HOLDOUT) {
    const s = await scanCase(c, { dpi });
    if (DEGRADED.has(c.id)) degrade(s.model);
    const upright = await scanCase({ ...c, scan: { noise: false, rotateDeg: 0 } }, { dpi });
    yield {
      id: c.id, docType: c.id.replace(/^(dev|ho)_/, ""), condition: split, dpi,
      model: { ...s.model, texts: [] }, truth: s.model.texts, truthUpright: upright.model.texts, scanRotationDeg: c.scan.rotateDeg ?? 0,
      sha256: s.sha256, activities: c.activities, visuals: [], distractors: [],
      ...printedInstructions(s.model.texts, c.activities),
    };
  }
}
