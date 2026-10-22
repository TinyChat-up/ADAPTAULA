import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { renderPrintHtml } from "@/lib/render/print/html";
import type { RenderModel } from "@/lib/render/model";
import type { PinnedAsset } from "@/lib/render/print/pinned-assets";
import { GALLERY, galleryModel } from "../support/editorial-gallery";
import { OUT_DIR, localChromium, printPdf } from "./harness";

/**
 * Fase B on real paper (docs/EDITORIAL.md): eight sheets of different subjects, one identity, answer spaces for their demand.
 * Measured in Chromium's print layout (A4, the PDF engine's own CSS), not «the PDF opens»: the squares and the writing lines in
 * millimetres, whole squares only, nothing out of the page, no page that is only a header or almost empty, the same masthead and
 * tokens everywhere, and no answer printed. Synthetic sheets of our own (tests/support/editorial-gallery.ts), no model calls.
 */

const PX_PER_MM = 96 / 25.4;

interface Layout {
  pageWidthMm: number;
  masthead: { brand: string; meta: string } | null;
  font: string;
  grids: Array<{ widthMm: number; heightMm: number; cellMm: number; columns: number; rows: number; whole: boolean }>;
  lines: Array<{ pitchMm: number; count: number }>;
  fields: Array<{ label: string; space: string; unit: boolean }>;
  overflow: string[];
  sheets: Array<{ fillMm: number; activities: number; onlyHeader: boolean }>;
  repeated: number;
  numbers: string[];
}

async function layoutOf(model: RenderModel, pins: PinnedAsset[]): Promise<Layout> {
  const { html } = await renderPrintHtml(model, pins);
  const browser = await chromium.launch({ executablePath: localChromium(), args: ["--no-sandbox"], headless: true });
  try {
    // 210 mm − 2 × 18 mm of @page margins: the printable width the PDF engine lays out.
    const page = await browser.newPage({ viewport: { width: Math.round(174 * PX_PER_MM), height: 1123 } });
    await page.emulateMedia({ media: "print" });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate((pxPerMm) => {
      const mm = (px: number) => Math.round((px / pxPerMm) * 10) / 10;
      const root = document.querySelector(".ms-root") as HTMLElement;
      const rootBox = root.getBoundingClientRect();
      const cellOf = (el: Element) => Number(el.getAttribute("data-cell-mm")) * pxPerMm;
      const grids = [...document.querySelectorAll(".ms-grid-area")].map((g) => {
        const r = g.getBoundingClientRect();
        const cell = cellOf(g);
        const columns = r.width / cell;
        const rows = r.height / cell;
        return { widthMm: mm(r.width), heightMm: mm(r.height), cellMm: mm(cell), columns: Math.round(columns * 100) / 100, rows: Math.round(rows * 100) / 100, whole: Math.abs(columns - Math.round(columns)) < 0.02 && Math.abs(rows - Math.round(rows)) < 0.02 };
      });
      const lines = [...document.querySelectorAll(".ms-lines")].map((l) => {
        const rows = [...l.children].map((c) => c.getBoundingClientRect());
        return { pitchMm: rows.length > 1 ? mm(rows[1]!.top - rows[0]!.top) : mm(rows[0]?.height ?? 0), count: rows.length };
      });
      const fields = [...document.querySelectorAll(".ms-answer-field")].map((f) => ({ label: (f.querySelector(".ms-answer-field-label")?.textContent ?? "").replace(/:$/, ""), space: f.classList.contains("ms-answer-field-grid") ? "grid" : f.classList.contains("ms-answer-field-box") ? "box" : "lines", unit: f.querySelector(".ms-unit") !== null }));
      // The lines inside a grid's SVG are clipped by it (overflow hidden): only boxes that really print count.
      const overflow = [...document.querySelectorAll(".ms-sheet *")].filter((el) => !el.closest("svg.ms-grid-area") || el.matches("svg.ms-grid-area")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > rootBox.right + 1 || r.left < rootBox.left - 1);
      }).map((el) => (typeof el.className === "string" ? el.className : el.tagName)).slice(0, 5);
      // Logical sheets (one per `.ms-sheet`): how far their content reaches, and whether one is only the header and title.
      const sheets = [...document.querySelectorAll(".ms-sheet")].map((s) => {
        const top = s.getBoundingClientRect().top;
        const last = [...s.querySelectorAll(".ms-flow > *")].reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), top);
        const activities = s.querySelectorAll(".ms-activity").length;
        return { fillMm: mm(last - top), activities, onlyHeader: activities === 0 };
      });
      const brand = document.querySelector(".ms-brand")?.textContent ?? null;
      const meta = document.querySelector(".ms-meta")?.textContent ?? "";
      return {
        pageWidthMm: mm(rootBox.width),
        masthead: brand ? { brand, meta } : null,
        font: getComputedStyle(root).fontFamily,
        grids,
        lines,
        fields,
        overflow,
        sheets,
        repeated: document.querySelectorAll(".ms-activity-figures .ms-figure").length,
        numbers: [...document.querySelectorAll(".ms-num")].map((n) => n.textContent ?? ""),
      };
    }, PX_PER_MM);
  } finally {
    await browser.close();
  }
}

/**
 * Grid lines that really printed: rows of the PDF rasterised by pdf.js crossed by a long run (half the page) of FAINT pixels once
 * converted to greyscale (lighter than text and writing lines, darker than paper). A grid that vanished in the PDF (as a CSS
 * background pattern and an SVG pattern did) has none.
 */
async function faintLineRows(png: Uint8Array): Promise<number> {
  const img = await loadImage(Buffer.from(png));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, img.width, img.height).data;
  let rows = 0;
  for (let y = 0; y < img.height; y++) {
    let run = 0;
    let best = 0;
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const l = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      run = l > 150 && l < 245 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    if (best > img.width * 0.5) rows += 1;
  }
  return rows;
}

/** How far down the page the ink reaches (0–1), ignoring the page number in the bottom margin. */
async function inkReach(png: Uint8Array): Promise<number> {
  const img = await loadImage(Buffer.from(png));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const limit = Math.floor(img.height * 0.9);
  const data = g.getImageData(0, 0, img.width, limit).data;
  let last = 0;
  for (let y = 0; y < limit; y++) {
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      if (data[i]! < 200 || data[i + 1]! < 200 || data[i + 2]! < 200) {
        last = y;
        break;
      }
    }
  }
  return last / img.height;
}

/** What each sheet must offer to be solved on paper (docs/EDITORIAL.md § Criterios de aceptación). */
const EXPECT: Record<string, (l: Layout) => void> = {
  "mat3-operaciones": (l) => expect(l.grids).toHaveLength(3),
  "mat4-problemas": (l) => {
    expect(l.grids).toHaveLength(3);
    expect(l.fields.filter((f) => f.label === "Datos y razonamiento")).toHaveLength(2);
    expect(l.fields.filter((f) => f.unit).map((f) => f.label)).toEqual(["Respuesta", "Respuesta"]);
  },
  "mat5-geometria": (l) => {
    expect(l.grids.length).toBeGreaterThanOrEqual(3);
    // The comparison sees the figure again on its own sheet: the crop is printed more than once.
    expect(l.repeated).toBeGreaterThanOrEqual(3);
  },
  "len3-comprension": (l) => expect(l.grids).toEqual([]),
  "len5-gramatica": (l) => {
    expect(l.grids).toEqual([]);
    expect(l.fields.map((f) => f.label)).toEqual(["1. Sujeto", "1. Predicado", "2. Sujeto", "2. Predicado"]);
    expect(l.lines.at(-1)!.count).toBeGreaterThanOrEqual(8);
  },
  "cn3-esquema": (l) => {
    expect(l.grids).toEqual([]);
    expect(l.fields.map((f) => f.label)).toEqual(["A", "B", "C", "D"]);
    // Fine motor demand: wider writing lines than the stage's 10 mm.
    expect(Math.min(...l.lines.map((x) => x.pitchMm))).toBeGreaterThanOrEqual(11.9);
  },
  "cs4-tablas": (l) => expect(l.grids).toEqual([]),
  "mat6-operaciones-problemas": (l) => {
    expect(l.grids).toHaveLength(4);
    expect(l.fields.some((f) => f.label === "Datos y razonamiento")).toBe(true);
  },
};

const reports: Record<string, unknown> = {};

describe("galería editorial: ocho fichas, una identidad, espacios para resolver", () => {
  for (const sheet of GALLERY) {
    it(`${sheet.label}: ${sheet.demand}`, async () => {
      const { model, pins, document, issues } = await galleryModel(sheet);
      expect(issues).toEqual([]);
      const printed = await printPdf(`gallery-${sheet.id}`, model, pins, pins.length);
      expect(printed.validation.issues).toEqual([]);
      const layout = await layoutOf(model, pins);
      const text = printed.pages.map((p) => p.text).join("\n");
      reports[sheet.id] = { label: sheet.label, profile: sheet.profileLabel, pdfPages: printed.pages.length, inkReach: await Promise.all(printed.pages.map((p) => inkReach(p.png))), responses: document.pages.flatMap((p) => p.blocks).filter((b) => b.type === "activity").map((b) => b.type === "activity" ? b.response : null), layout };
      // One identity: the same masthead, family and accent on every sheet.
      expect(layout.masthead?.brand).toBe("Adaptaula");
      expect(layout.masthead?.meta).toContain(sheet.input.subjectName);
      expect(layout.font).toContain("Adaptaula Inter");
      // Usable answer spaces: whole squares of a handwriting size, lines a hand can write on.
      for (const g of layout.grids) {
        expect(g.whole).toBe(true);
        expect(g.cellMm).toBeGreaterThanOrEqual(5);
        expect(g.rows).toBeGreaterThanOrEqual(4);
        expect(g.columns).toBeGreaterThanOrEqual(15);
      }
      for (const l of layout.lines) if (l.count > 1) expect(l.pitchMm).toBeGreaterThanOrEqual(8);
      expect(layout.overflow).toEqual([]);
      expect(layout.sheets.some((s) => s.onlyHeader)).toBe(false);
      EXPECT[sheet.id]!(layout);
      // Greyscale: the squares stay visible on the printed page, as faint lines.
      if (layout.grids.length > 0) {
        const rows = (await Promise.all(printed.pages.map((p) => faintLineRows(p.png)))).reduce((a, b) => a + b, 0);
        expect(rows).toBeGreaterThanOrEqual(layout.grids.reduce((n, g) => n + g.rows - 1, 0));
      }
      // On paper: no sheet but the last is almost empty (its ink reaches at least a third of the page).
      const reach = await Promise.all(printed.pages.map((p) => inkReach(p.png)));
      for (const r of reach.slice(0, -1)) expect(r).toBeGreaterThan(0.35);
      // No answer key on the student's sheet.
      expect(text).not.toMatch(/Soluci[oó]n|Respuestas correctas/);
    }, 180_000);
  }

  it("informe de la galería", () => {
    const dir = path.join(OUT_DIR, "gallery");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(reports, null, 2));
    expect(Object.keys(reports)).toHaveLength(GALLERY.length);
  });
});
