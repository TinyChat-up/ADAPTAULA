import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Synthetic worksheets for the analysis evals. They are drawn from a small spec instead of hand-made PDFs:
 * the point is a minimal, deterministic input that exercises one capability (a table, a chart, an illegible
 * area, an injected instruction…), not a pretty document. Real, anonymized, authorized worksheets come later.
 * Only WinAnsi characters are used (accents, ñ, ¿, ¡): write formulas in plain text ("x^2", "m/s^2").
 */
export type Op =
  | { t: "title"; text: string }
  | { t: "text"; text: string }
  | { t: "exercise"; n: string; text: string }
  | { t: "answer-lines"; count: number }
  | { t: "table"; headers: string[]; rows: string[][] }
  | { t: "bar-chart"; title: string; bars: Array<{ label: string; value: number }> }
  | { t: "figure"; kind: "pizza" | "water-cycle" | "cell" | "map" | "triangle" | "timeline"; labels?: string[] }
  | { t: "border" }
  | { t: "smudge"; note?: string }
  | { t: "cut-off"; text: string }
  | { t: "gap"; height?: number };

export type PageSpec = Op[];

const MARGIN = 54;
const WIDTH = 595.28;
const HEIGHT = 841.89;

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
}

function paragraph(ctx: Ctx, text: string, options: { size?: number; bold?: boolean; indent?: number } = {}) {
  const size = options.size ?? 11;
  const font = options.bold ? ctx.bold : ctx.font;
  for (const line of wrap(text, font, size, WIDTH - 2 * MARGIN - (options.indent ?? 0))) {
    ctx.page.drawText(line, { x: MARGIN + (options.indent ?? 0), y: ctx.y, size, font });
    ctx.y -= size * 1.5;
  }
}

function draw(ctx: Ctx, op: Op) {
  const { page } = ctx;
  switch (op.t) {
    case "title":
      paragraph(ctx, op.text, { size: 18, bold: true });
      ctx.y -= 8;
      break;
    case "text":
      paragraph(ctx, op.text);
      ctx.y -= 6;
      break;
    case "exercise":
      paragraph(ctx, `${op.n}. ${op.text}`);
      ctx.y -= 4;
      break;
    case "answer-lines":
      for (let i = 0; i < op.count; i++) {
        page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: WIDTH - MARGIN, y: ctx.y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
        ctx.y -= 18;
      }
      ctx.y -= 4;
      break;
    case "table": {
      const colWidth = (WIDTH - 2 * MARGIN) / op.headers.length;
      const rowHeight = 20;
      [op.headers, ...op.rows].forEach((row, r) => {
        row.forEach((cell, c) => {
          const x = MARGIN + c * colWidth;
          page.drawRectangle({ x, y: ctx.y - rowHeight + 6, width: colWidth, height: rowHeight, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.7 });
          page.drawText(cell, { x: x + 4, y: ctx.y - 8, size: 10, font: r === 0 ? ctx.bold : ctx.font });
        });
        ctx.y -= rowHeight;
      });
      ctx.y -= 10;
      break;
    }
    case "bar-chart": {
      const height = 120;
      const max = Math.max(...op.bars.map((b) => b.value));
      paragraph(ctx, op.title, { bold: true, size: 10 });
      const base = ctx.y - height;
      page.drawLine({ start: { x: MARGIN + 20, y: base }, end: { x: MARGIN + 20 + op.bars.length * 55, y: base }, thickness: 1 });
      page.drawLine({ start: { x: MARGIN + 20, y: base }, end: { x: MARGIN + 20, y: base + height }, thickness: 1 });
      op.bars.forEach((bar, i) => {
        const h = (bar.value / max) * (height - 15);
        const x = MARGIN + 30 + i * 55;
        page.drawRectangle({ x, y: base, width: 35, height: h, color: rgb(0.3, 0.45, 0.8) });
        page.drawText(String(bar.value), { x: x + 8, y: base + h + 3, size: 8, font: ctx.font });
        page.drawText(bar.label, { x: x - 2, y: base - 11, size: 8, font: ctx.font });
      });
      ctx.y = base - 24;
      break;
    }
    case "figure": {
      const top = ctx.y;
      const label = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 9, font: ctx.font });
      if (op.kind === "pizza") {
        page.drawCircle({ x: MARGIN + 60, y: top - 60, size: 50, borderWidth: 1.5, borderColor: rgb(0.7, 0.4, 0.1) });
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          page.drawLine({ start: { x: MARGIN + 60, y: top - 60 }, end: { x: MARGIN + 60 + 50 * Math.cos(a), y: top - 60 + 50 * Math.sin(a) }, thickness: 1 });
        }
      } else if (op.kind === "water-cycle") {
        page.drawCircle({ x: MARGIN + 40, y: top - 25, size: 18, color: rgb(1, 0.85, 0.2) });
        page.drawRectangle({ x: MARGIN, y: top - 110, width: 220, height: 30, color: rgb(0.6, 0.8, 1) });
        page.drawRectangle({ x: MARGIN + 140, y: top - 55, width: 70, height: 22, color: rgb(0.85, 0.85, 0.85) });
        (op.labels ?? ["1", "2", "3"]).forEach((l, i) => label(l, MARGIN + 20 + i * 70, top - 125));
      } else if (op.kind === "cell") {
        page.drawEllipse({ x: MARGIN + 80, y: top - 55, xScale: 75, yScale: 45, borderWidth: 1.5, borderColor: rgb(0.2, 0.5, 0.2) });
        page.drawCircle({ x: MARGIN + 80, y: top - 55, size: 14, borderWidth: 1 });
        (op.labels ?? ["A", "B", "C"]).forEach((l, i) => label(l, MARGIN + 170, top - 25 - i * 20));
      } else if (op.kind === "map") {
        page.drawRectangle({ x: MARGIN, y: top - 100, width: 220, height: 100, borderWidth: 1 });
        page.drawRectangle({ x: MARGIN + 40, y: top - 80, width: 60, height: 50, color: rgb(0.8, 0.9, 0.7) });
        (op.labels ?? []).forEach((l, i) => label(l, MARGIN + 50 + i * 60, top - 50));
      } else if (op.kind === "triangle") {
        page.drawLine({ start: { x: MARGIN + 10, y: top - 90 }, end: { x: MARGIN + 130, y: top - 90 }, thickness: 1.5 });
        page.drawLine({ start: { x: MARGIN + 10, y: top - 90 }, end: { x: MARGIN + 10, y: top - 10 }, thickness: 1.5 });
        page.drawLine({ start: { x: MARGIN + 10, y: top - 10 }, end: { x: MARGIN + 130, y: top - 90 }, thickness: 1.5 });
        (op.labels ?? []).forEach((l, i) => label(l, MARGIN + 140, top - 30 - i * 15));
      } else {
        page.drawLine({ start: { x: MARGIN, y: top - 40 }, end: { x: WIDTH - MARGIN, y: top - 40 }, thickness: 2 });
        (op.labels ?? []).forEach((l, i, all) => label(l, MARGIN + (i * (WIDTH - 2 * MARGIN - 40)) / Math.max(1, all.length - 1), top - 58));
      }
      ctx.y = top - 140;
      break;
    }
    case "border":
      page.drawRectangle({ x: 24, y: 24, width: WIDTH - 48, height: HEIGHT - 48, borderColor: rgb(0.8, 0.5, 0.2), borderWidth: 4 });
      break;
    case "smudge":
      // Solid scribble over the area where text would be: unreadable on purpose.
      page.drawRectangle({ x: MARGIN, y: ctx.y - 6, width: WIDTH - 2 * MARGIN - 40, height: 26, color: rgb(0.15, 0.15, 0.15), opacity: 0.92 });
      ctx.y -= 34;
      break;
    case "cut-off":
      // Text that runs past the right edge of the page: the end of the sentence is cut.
      page.drawText(op.text, { x: WIDTH - 140, y: ctx.y, size: 11, font: ctx.font });
      ctx.y -= 20;
      break;
    case "gap":
      ctx.y -= op.height ?? 20;
      break;
  }
}

export async function buildPdf(pages: readonly PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const spec of pages) {
    const page = doc.addPage([WIDTH, HEIGHT]);
    const ctx: Ctx = { page, font, bold, y: HEIGHT - MARGIN };
    for (const op of spec) draw(ctx, op);
  }
  return doc.save({ useObjectStreams: false });
}
