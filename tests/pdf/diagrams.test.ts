import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { buildRenderModel } from "@/lib/render/model";
import { MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { DiagramSpec } from "@/lib/visuals/diagram";
import { runMockRecreation } from "../support/recreation-mocks";
import { localChromium, printPdf, type Printed } from "./harness";

/**
 * ADR-059 · the four layouts of a NEW scheme printed by the product's renderer and Chromium engine (no Claude, no OpenAI): long labels,
 * relation labels and the widest shapes the contract allows. What is checked is the printed result, not the HTML: every label and
 * every arrow is in the PDF's text, each scheme is whole on one page, and in print layout nothing is cut or overflows the sheet.
 * Output in `.pdf-smoke/diagrams-*` (PNG per page, for a person to look at).
 */

const SPECS: Record<"chain" | "row" | "cycle" | "hierarchy" | "groups", DiagramSpec> = {
  chain: {
    spec_version: 1, kind: "diagram", layout: "chain", title: "Cadena larga con rótulos en las flechas",
    nodes: ["Luz del sol sobre la superficie", "Algas y plantas acuáticas", "Larvas de insectos acuáticos", "Ranas comunes de la orilla", "Garzas que pescan en la charca", "Descomponedores del fondo"].map((label, i) => ({ id: `n_${i + 1}`, label })),
    edges: [1, 2, 3, 4, 5].map((i) => ({ from: `n_${i}`, to: `n_${i + 1}`, label: "sirve de alimento a" })),
    groups: [],
  },
  row: {
    spec_version: 1, kind: "diagram", layout: "chain", title: "Fracciones equivalentes",
    nodes: ["1/2", "2/4", "4/8"].map((label, i) => ({ id: `n_${i + 1}`, label })),
    edges: [1, 2].map((i) => ({ from: `n_${i}`, to: `n_${i + 1}`, label: "es igual a" })),
    groups: [],
  },
  cycle: {
    spec_version: 1, kind: "diagram", layout: "cycle", title: "Ciclo del agua",
    nodes: ["Evaporación del mar", "Condensación en nubes", "Precipitación", "Escorrentía hacia los ríos"].map((label, i) => ({ id: `n_${i + 1}`, label })),
    edges: [[1, 2], [2, 3], [3, 4], [4, 1]].map(([a, b]) => ({ from: `n_${a}`, to: `n_${b}`, label: "da lugar a" })),
    groups: [],
  },
  hierarchy: {
    spec_version: 1, kind: "diagram", layout: "hierarchy", title: "Partes de la oración",
    nodes: ["Oración", "Sujeto", "Predicado", "Núcleo del sujeto", "Verbo", "Complementos del verbo"].map((label, i) => ({ id: `n_${i + 1}`, label })),
    edges: [[1, 2, "tiene"], [1, 3, "tiene"], [2, 4, "se organiza en torno a"], [3, 5, "tiene como núcleo"], [3, 6, "puede llevar"]].map(([a, b, l]) => ({ from: `n_${a}`, to: `n_${b}`, label: String(l) })),
    groups: [],
  },
  groups: {
    spec_version: 1, kind: "diagram", layout: "groups", title: "El estanque en mayo y en junio",
    nodes: ["30 centímetros de agua", "Plantas dentro del agua", "18 centímetros de agua", "Plantas fuera del agua", "Muchas larvas en la orilla", "Menos larvas en la orilla", "3/4 de la charca", "1/2 de la charca"].map((label, i) => ({ id: `n_${i + 1}`, label, group: [0, 0, 1, 1, 2, 3, 2, 3][i]! })),
    edges: [],
    groups: ["Mayo", "Junio", "Mayo (seres vivos)", "Junio (seres vivos)"],
  },
};
const ARROWS = { chain: { glyph: "↓", count: 5 }, row: { glyph: "→", count: 2 }, cycle: { glyph: "↓", count: 3 }, hierarchy: { glyph: "↓", count: 5 }, groups: { glyph: "→", count: 0 } } as const;
const flat = (t: string) => t.replace(/\s+/g, " ").toLowerCase();

const base = (async () => {
  const run = await runMockRecreation({ imagesAuthorized: false });
  if (run.outcome.status !== "ready") throw new Error(run.outcome.status);
  return run.outcome.compiled.student;
})();

/** One sheet with an activity per layout, each with its scheme right before it (the same blocks the compiler produces). */
async function sheet(): Promise<MaterialDocument> {
  const doc = await base;
  const blocks = doc.pages.flatMap((p) => p.blocks);
  const heading = blocks.find((b) => b.type === "heading")!;
  const activity = blocks.find((b): b is Extract<Block, { type: "activity" }> => b.type === "activity")!;
  const out: Block[] = [heading];
  Object.entries(SPECS).forEach(([layout, spec], i) => {
    const figure: Block = { id: `blk_d${i}fig`, type: "image", alt_text: `Esquema ${layout}`, source: { kind: "figure", spec, provenance: "generated", decision_id: "dec_1" }, trace: { origin: "support", source_refs: [], decision_ids: activity.trace.decision_ids } };
    out.push(figure, { ...activity, id: `blk_d${i}act`, label: String(i + 1), prompt: `Mira el esquema (${layout === "row" ? "chain" : layout}) y explica la relación que muestra.`, response: { kind: "lines", lines: 2 }, resource_block_ids: [figure.id] });
  });
  return MaterialDocumentSchema.parse({ ...doc, answer_key: [], pages: [{ blocks: out }] });
}

/** The print layout as Chromium lays it out (same HTML, fonts and CSS as the PDF): boxes, arrows and overflow of each scheme. */
async function measure(html: string) {
  const browser = await chromium.launch({ executablePath: localChromium(), headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html);
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => {
      const sheetRect = document.querySelector(".ms-root")!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>('[data-spec="diagram"][data-layout]')].map((d) => {
        const r = d.getBoundingClientRect();
        const inside = (e: Element) => {
          const x = e.getBoundingClientRect();
          return x.left >= r.left - 0.5 && x.right <= r.right + 0.5 && x.top >= r.top - 0.5 && x.bottom <= r.bottom + 0.5 && x.width > 0 && x.height > 0;
        };
        const boxes = [...d.querySelectorAll(".ms-vflow-box")];
        const arrows = [...d.querySelectorAll(".ms-vdiagram-arrow")];
        const overflowing = [...d.querySelectorAll<HTMLElement>("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible").length;
        // Text wider than its own box (a long word that does not wrap) shows as a box narrower than its text.
        const clipped = boxes.filter((b) => (b as HTMLElement).scrollWidth > (b as HTMLElement).clientWidth + 1).length;
        // A box broken over two lines is two rectangles: its border and its words come apart on paper.
        const split = boxes.filter((b) => b.getClientRects().length !== 1).length;
        // In a chain or a cycle each arrow sits between the box before it and the box after it, in the direction it points.
        const items = [...d.querySelectorAll(".ms-vdiagram-chain > li")];
        const misplaced = items.slice(0, -1).filter((li, i) => {
          const glyph = li.querySelector(".ms-vdiagram-glyph");
          const box = li.querySelector(".ms-vflow-box");
          const next = items[i + 1]?.querySelector(".ms-vflow-box");
          if (!glyph || !box || !next) return false;
          const [a, g, b] = [box.getBoundingClientRect(), glyph.getBoundingClientRect(), next.getBoundingClientRect()];
          return glyph.textContent === "↓" ? !(g.top >= a.bottom - 1 && b.top >= g.bottom - 1) : !(g.left >= a.right - 1 && (b.left >= g.right - 1 || b.top >= g.bottom - 1));
        }).length;
        return {
          layout: d.getAttribute("data-layout"),
          split,
          misplaced,
          withinSheet: r.left >= sheetRect.left - 0.5 && r.right <= sheetRect.right + 0.5,
          boxes: boxes.length,
          boxesInside: boxes.every(inside),
          arrows: arrows.length,
          arrowsInside: arrows.every(inside),
          arrowsVisible: arrows.every((a) => getComputedStyle(a).visibility !== "hidden" && (a.textContent ?? "").trim().length > 0),
          overflowing,
          clipped,
        };
      });
    });
  } finally {
    await browser.close();
  }
}

let printed: Printed | null = null;
const print = async () => (printed ??= await printPdf("diagrams-all-layouts", buildRenderModel(await sheet(), { mode: "student", deferred: [] }).model));

describe("esquemas nuevos impresos en PDF (Chromium, sin IA)", () => {
  it("el PDF es válido: fuentes incrustadas, sin peticiones de red, sin errores de validación", async () => {
    const pdf = await print();
    expect(pdf.validation.issues).toEqual([]);
    expect(pdf.result.blockedRequests).toEqual([]);
    // No page left blank because a scheme did not fit after the header: every page carries an activity with its scheme.
    for (const page of pdf.pages) expect(page.text, `página ${page.number}`).toMatch(/Mira el esquema \((chain|cycle|hierarchy|groups)\)/);
  });

  it("cada esquema se imprime ENTERO en una sola página, con todos sus rótulos y rótulos de relación", async () => {
    const pdf = await print();
    for (const [layout, spec] of Object.entries(SPECS)) {
      const texts = [spec.title!, ...spec.nodes.map((n) => n.label), ...spec.groups, ...spec.edges.flatMap((e) => (e.label ? [e.label] : []))];
      // The title prints in small caps (CSS uppercase): compared without case.
      const pages = pdf.pages.filter((p) => texts.every((t) => flat(p.text).includes(flat(t))));
      expect(pages.length, `${layout}: todos sus textos en una misma página`).toBe(1);
    }
  });

  it("las flechas llegan al PDF como texto legible (no se pierden ni se sustituyen por cuadros vacíos)", async () => {
    const pdf = await print();
    const all = pdf.pages.map((p) => p.text).join("\n");
    expect(all).not.toMatch(/[�□]/);
    for (const [layout, spec] of Object.entries(SPECS)) {
      const page = pdf.pages.find((p) => flat(p.text).includes(flat(spec.title!)))!;
      const { glyph, count } = ARROWS[layout as keyof typeof ARROWS];
      if (count > 0) expect((page.text.match(new RegExp(glyph, "g")) ?? []).length, layout).toBeGreaterThanOrEqual(count);
    }
    expect(all).toContain("↺");
  });

  it("en la disposición de impresión nada se corta ni desborda: cajas y flechas dentro del esquema, esquema dentro de la hoja", async () => {
    const pdf = await print();
    const measured = await measure(pdf.print.html);
    expect(measured.map((m) => m.layout)).toEqual(["chain", "chain", "cycle", "hierarchy", "groups"]);
    for (const m of measured) {
      expect(m, `${m.layout}`).toMatchObject({ withinSheet: true, boxesInside: true, arrowsInside: true, arrowsVisible: true, overflowing: 0, clipped: 0, split: 0, misplaced: 0 });
    }
    const [long, short] = measured;
    const by = Object.fromEntries(measured.map((m) => [m.layout, m]));
    expect(long).toMatchObject({ boxes: 6, arrows: 5 });
    expect(short).toMatchObject({ boxes: 3, arrows: 2 });
    expect(by.cycle).toMatchObject({ boxes: 4, arrows: 4 }); // three ↓ and the ↺ back to the start
    expect(by.hierarchy).toMatchObject({ boxes: 6, arrows: 5 });
    expect(by.groups).toMatchObject({ boxes: 8, arrows: 0 });
  });
});
