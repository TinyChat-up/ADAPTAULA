import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Original synthetic sheets for the figures located by their marks (docs/VISUAL_RESOURCES.md § Figuras con marcas). Our own
 * drawings with the structure of the real sheets 03 (an L-shaped outline with its measures and «?»), 06 (a scheme with letters
 * A–D and leader lines) and 07 (boxes joined by arrows numbered 1–4), plus adversarial variants. No private material: these are
 * NOT the real sheets and say nothing by themselves about them. Coordinates in points from the TOP of an A4 page.
 */

export const A4 = { w: 595.28, h: 841.89 } as const;
const ink = rgb(0.12, 0.2, 0.25);

interface Pen {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
}
const top = (y: number) => A4.h - y;
const text = (p: Pen, s: string, x: number, y: number, size = 11, bold = false) => p.page.drawText(s, { x, y: top(y), size, font: bold ? p.bold : p.font, color: ink });
const line = (p: Pen, x0: number, y0: number, x1: number, y1: number, thickness = 1.5) => p.page.drawLine({ start: { x: x0, y: top(y0) }, end: { x: x1, y: top(y1) }, thickness, color: ink });
const box = (p: Pen, x: number, y: number, w: number, h: number, thickness = 1.2) => p.page.drawRectangle({ x, y: top(y + h), width: w, height: h, borderColor: ink, borderWidth: thickness });
const circle = (p: Pen, x: number, y: number, r: number) => p.page.drawCircle({ x, y: top(y), size: r, borderColor: ink, borderWidth: 1.2 });

async function sheet(draw: (p: Pen, page: number) => void, pages = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) draw({ page: pdf.addPage([A4.w, A4.h]), font, bold }, i);
  return pdf.save();
}

/** An L-shaped outline (x, y = its top-left) with its four measures written beside its sides and «?» on the two unknown ones. */
function lShape(p: Pen, x: number, y: number, s = 1) {
  const w = 160 * s, h = 140 * s, notchW = 70 * s, notchH = 50 * s;
  line(p, x, y, x + w, y, 2.5); line(p, x + w, y, x + w, y + notchH, 2.5); line(p, x + w, y + notchH, x + w - notchW, y + notchH, 2.5);
  line(p, x + w - notchW, y + notchH, x + w - notchW, y + h, 2.5); line(p, x + w - notchW, y + h, x, y + h, 2.5); line(p, x, y + h, x, y, 2.5);
  text(p, "8 cm", x + w / 2 - 12, y - 8, 10 * s, true);
  text(p, "3 cm", x + w + 8, y + notchH / 2 + 4, 10 * s, true);
  text(p, "7 cm", x - 34 * s, y + h / 2 + 4, 10 * s, true);
  text(p, "5 cm", x + (w - notchW) / 2 - 12, y + h + 16 * s, 10 * s, true);
  text(p, "?", x + w - 24 * s, y + notchH - 10 * s, 10 * s, true);
  text(p, "?", x + w - notchW + 10 * s, y + notchH + 45 * s, 10 * s, true);
}

/** A plant-like scheme: a stem, leaves and a flower, with leader lines ending in circled letters on its right. */
function lettered(p: Pen, x: number, y: number, letters = ["D", "C", "B", "A"], s = 1, omit: string | null = null) {
  line(p, x + 60 * s, y + 20 * s, x + 60 * s, y + 200 * s, 3);
  circle(p, x + 60 * s, y + 20 * s, 18 * s);
  line(p, x + 60 * s, y + 90 * s, x + 20 * s, y + 70 * s, 2); line(p, x + 60 * s, y + 110 * s, x + 105 * s, y + 85 * s, 2);
  line(p, x + 60 * s, y + 200 * s, x + 35 * s, y + 230 * s, 2); line(p, x + 60 * s, y + 200 * s, x + 85 * s, y + 232 * s, 2);
  letters.forEach((l, i) => {
    const ly = y + (20 + i * 65) * s;
    if (l === omit) return;
    line(p, x + 65 * s, ly, x + 165 * s, ly, 1);
    circle(p, x + 177 * s, ly, 12 * s);
    text(p, l, x + 173 * s, ly + 4 * s, 12 * s, true);
  });
}

/** Four boxes with their labels inside, joined clockwise by arrows numbered 1–4 in small circles. */
function arrows(p: Pen, x: number, y: number) {
  const bw = 170, bh = 70, gx = 110, gy = 80;
  const boxes = [[x, y], [x + bw + gx, y], [x + bw + gx, y + bh + gy], [x, y + bh + gy]] as const;
  const labels = ["Vapor de agua en el aire", "Nubes con gotas", "Lluvia sobre el terreno", "Agua en el mar"];
  boxes.forEach(([bx, by], i) => { box(p, bx, by, bw, bh); text(p, labels[i]!, bx + 12, by + 42, 10); });
  const arrow = (x0: number, y0: number, x1: number, y1: number, n: string, nx: number, ny: number) => {
    line(p, x0, y0, x1, y1, 2);
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    line(p, x1, y1, x1 - 8 * dx - 5 * dy, y1 - 8 * dy - 5 * dx, 2); line(p, x1, y1, x1 - 8 * dx + 5 * dy, y1 - 8 * dy + 5 * dx, 2);
    circle(p, nx, ny, 10); text(p, n, nx - 3, ny + 4, 10, true);
  };
  arrow(x + 40, y + bh + gy - 4, x + 40, y + bh + 4, "1", x + 60, y + bh + gy / 2);
  arrow(x + bw + 4, y + bh / 2, x + bw + gx - 4, y + bh / 2, "2", x + bw + gx / 2, y + bh / 2 - 16);
  arrow(x + bw + gx + 40, y + bh + 4, x + bw + gx + 40, y + bh + gy - 4, "3", x + bw + gx + 60, y + bh + gy / 2);
  arrow(x + bw + gx - 4, y + bh + gy + bh / 2, x + bw + 4, y + bh + gy + bh / 2, "4", x + bw + gx / 2, y + bh + gy + bh / 2 - 16);
}

const header = (p: Pen) => { text(p, "Ficha de prueba", 50, 50, 16, true); text(p, "Nombre: ............................", 50, 80, 10); };

export const POLYGON_INSTRUCTION = "Deduce la longitud de los lados con ? de la figura.";
export const LETTERS_INSTRUCTION = "Escribe que parte indica cada letra.";
export const ARROWS_INSTRUCTION = "Escribe el nombre de cada proceso de las flechas.";
export const SECOND_INSTRUCTION = "Explica tu respuesta con una frase completa.";
export const NUMBERED_INSTRUCTION = "Nombra las partes señaladas con los números 1, 2, 3 y 4.";
export const GRID_INSTRUCTION = "Mira el plano. Escribe la casilla donde se encuentra el circulo.";

/** The axis labels are outside the lattice; its internal symbols must survive as original pixels, never be reconstructed. */
export const coordinateGridSheet = (variant?: "missing" | "misaligned" | "irregular") => sheet((p) => {
  header(p);
  text(p, `1. ${GRID_INSTRUCTION}`, 50, 130);
  for (let i = 0; i <= 4; i++) {
    line(p, 180 + 50 * i, 200, 180 + 50 * i, 400);
    const y = 200 + 50 * i + (variant === "irregular" && i === 2 ? 12 : 0);
    line(p, 180, y, 380, y);
  }
  for (let i = 0; i < 4; i++) {
    text(p, "ABCD"[i]!, 201 + 50 * i, 190, 12, true);
    if (!(variant === "missing" && i === 2)) text(p, String(i + 1), 149, 229 + 50 * i + (variant === "misaligned" && i === 2 ? 18 : 0), 12, true);
  }
  circle(p, 305, 325, 12);
  text(p, `2. ${SECOND_INSTRUCTION}`, 50, 520);
});

/** A synthetic diagram with a detached number beside a visible leader, rather than inside a circle. */
export const numberedLeadersSheet = (variant?: "no_leader" | "too_far" | "other_activity" | "duplicate" | "instruction_inside" | "clipped") => sheet((p) => {
  header(p);
  text(p, `1. ${NUMBERED_INSTRUCTION}`, 50, 130);
  circle(p, 300, 220, 35);
  line(p, 300, 255, 300, 480, 3);
  line(p, 300, 300, 250, 280, 2);
  line(p, 300, 400, 350, 380, 2);
  line(p, 300, 480, 260, 520, 2);
  line(p, 300, 480, 340, 520, 2);
  for (const [n, y] of [["1", 220], ["2", 380], ["4", 500]] as const) {
    line(p, 305, y, 390, y);
    text(p, n, 396, y + 4, 12, true);
  }
  if (variant !== "no_leader") line(p, 206, 340, 300, 340);
  text(p, "3", variant === "too_far" ? 120 : 183, 344, 12, true);
  if (variant === "duplicate") text(p, "3", 325, 340, 12, true);
  if (variant === "instruction_inside") text(p, "Responde aqui con una frase completa.", 220, 360, 10);
  if (variant === "clipped") line(p, 300, 460, -20, 460, 2);
  text(p, `2. ${SECOND_INSTRUCTION}`, 50, variant === "other_activity" ? 300 : 620);
});

/** 03-like: the outline LEADS its activity (above the first instruction), as the real sheet prints it. */
export const polygonSheet = (scale = 1) => sheet((p) => { header(p); lShape(p, 120, 150, scale); text(p, `1. ${POLYGON_INSTRUCTION}`, 50, 420); text(p, `2. ${SECOND_INSTRUCTION}`, 50, 600); });
/** 06-like: the scheme follows its instruction; the answer fields A:–D: are printed apart, on the right. */
export const lettersSheet = (options: { omit?: string; detachedD?: boolean; scale?: number } = {}) => sheet((p) => {
  header(p);
  text(p, `1. ${LETTERS_INSTRUCTION}`, 50, 130);
  lettered(p, 70, 170, ["D", "C", "B", "A"], options.scale ?? 1, options.detachedD ? "D" : (options.omit ?? null));
  // A letter written far from its leader line (beyond any reach): the figure no longer carries it.
  if (options.detachedD) text(p, "D", 70 + 260, 190, 12, true);
  ["A:", "B:", "C:", "D:"].forEach((f, i) => text(p, f, 450, 200 + i * 40, 11, true));
  text(p, `2. ${SECOND_INSTRUCTION}`, 50, 520);
});
/** 07-like: the diagram leads the activity; its boxes carry text; the fields «Flecha N:» are printed below. */
export const arrowsSheet = (options: { solution?: "inside" | "below" } = {}) => sheet((p) => {
  header(p);
  arrows(p, 60, 130);
  if (options.solution === "inside") text(p, "Solucion: 1 evaporacion", 260, 218, 9);
  if (options.solution === "below") text(p, "Solucion: 1 evaporacion, 2 condensacion", 60, 470, 9);
  text(p, `1. ${ARROWS_INSTRUCTION}`, 50, 520);
  text(p, "Flecha 1: ______  Flecha 2: ______", 50, 550); text(p, "Flecha 3: ______  Flecha 4: ______", 50, 580);
  text(p, `2. ${SECOND_INSTRUCTION}`, 50, 640);
});
/** A lettered figure printed BETWEEN two activities: it belongs to the first one (it follows its instruction). */
export const betweenSheet = () => sheet((p) => { header(p); text(p, `1. ${LETTERS_INSTRUCTION}`, 50, 130); lettered(p, 70, 170); text(p, `2. ${SECOND_INSTRUCTION}`, 50, 470); });
/** Two lettered figures side by side in the same zone: nothing tells which one the activity is about. */
export const twinSheet = () => sheet((p) => { header(p); text(p, `1. ${LETTERS_INSTRUCTION}`, 50, 130); lettered(p, 40, 170); lettered(p, 310, 170); text(p, `2. ${SECOND_INSTRUCTION}`, 50, 470); });
/** The figure is on page 2 while its instruction (and the analysis) say page 1. */
export const wrongPageSheet = () => sheet((p, n) => { header(p); if (n === 1) { text(p, `1. ${LETTERS_INSTRUCTION}`, 50, 130); text(p, `2. ${SECOND_INSTRUCTION}`, 50, 470); } else lettered(p, 70, 170); }, 2);
/** A lettered figure drawn far too small to read once printed (letters ≈ 3 pt). */
export const tinySheet = () => sheet((p) => { header(p); text(p, `1. ${LETTERS_INSTRUCTION}`, 50, 130); lettered(p, 70, 170, ["D", "C", "B", "A"], 0.22); text(p, `2. ${SECOND_INSTRUCTION}`, 50, 470); });

/** The analysis each sheet would get (only the fields the locator reads), in the words a careful analyzer writes. */
export const VISUALS = {
  grid: { title: "Plano", description: "Cuadrícula con columnas señaladas con las letras A, B, C y D y filas numeradas del 1 al 4.", text: null },
  numbered: { title: "Partes de una planta", description: "Dibujo con partes señaladas.", text: null },
  polygon: { title: "Figura A", description: "Contorno en L con las medidas de sus lados en centímetros y dos lados desconocidos marcados con ?.", text: null },
  letters: { title: "Esquema", description: "Dibujo de una planta con cuatro partes señaladas con las letras A, B, C y D.", text: null },
  arrows: { title: null, description: "Esquema del ciclo del agua con cuatro flechas numeradas del 1 al 4 entre cajas.", text: null },
} as const;
const shortAnswer = (instruction: string, context: string | null = null) => ({ instruction, context, type: "short_answer" as const, answer_area: { type: "lines" as const, lines: null } });
export const USERS = {
  grid: [shortAnswer(GRID_INSTRUCTION)],
  numbered: [shortAnswer(NUMBERED_INSTRUCTION)],
  polygon: [shortAnswer(POLYGON_INSTRUCTION)],
  letters: [shortAnswer(LETTERS_INSTRUCTION, "A:\nB:\nC:\nD:")],
  arrows: [shortAnswer(ARROWS_INSTRUCTION, "Flecha 1: ______ Flecha 2: ______\nFlecha 3: ______ Flecha 4: ______")],
};
export const activities = (first: string) => [{ id: "act_1", label: "1", instruction: first }, { id: "act_2", label: "2", instruction: SECOND_INSTRUCTION }];
