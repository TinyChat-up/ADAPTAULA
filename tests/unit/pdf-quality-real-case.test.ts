import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withNamedLabels } from "@/lib/materials/visuals/auto/locate";
import type { PageModel, TextBox } from "@/lib/materials/visuals/auto/page-model";
import { buildRenderModel, type RenderNode } from "@/lib/render/model";
import { MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { geografia } from "../support/render-fixtures";

/** A one-page sheet with only these blocks (the fixture's meta and presentation). */
const sheet = (blocks: Block[]): MaterialDocument => MaterialDocumentSchema.parse({ ...geografia(), pages: [{ blocks }], answer_key: [] });

/**
 * Regressions of the real pond sheet (PR #98, docs/qa/calidad-visual-pdf/caso-real.md), on synthetic equivalents: the user's PDF and
 * the stored document never enter the repository.
 */

const trace = (origin: "original" | "adapted" | "support", refs: string[] = []) => ({ origin, source_refs: refs, decision_ids: [] });

/** An 1654 × 2339 raster (A4 at 200 dpi), blank, with the given words. */
function page(texts: TextBox[]): PageModel {
  return { width: 1654, height: 2339, gray: new Uint8Array(1654 * 2339).fill(255), texts, mmPerPx: 25.4 / 200 };
}

describe("el recorte de un esquema incluye los nombres impresos de sus partes", () => {
  // Four pictures 1730–1876 px; their names printed in chips ≈ 4 mm below (the real food chain).
  const crop = { x0: 86, y0: 1731, x1: 1534, y1: 1877 };
  const names: TextBox[] = [
    { text: "Algas", x0: 160, y0: 1905, x1: 260, y1: 1930 },
    { text: "Larvas", x0: 470, y0: 1905, x1: 560, y1: 1930 },
    { text: "de", x0: 565, y0: 1905, x1: 590, y1: 1930 },
    { text: "insectos", x0: 595, y0: 1905, x1: 720, y1: 1930 },
    { text: "Ranas", x0: 900, y0: 1905, x1: 990, y1: 1930 },
    { text: "Garzas", x0: 1290, y0: 1905, x1: 1390, y1: 1930 },
  ];
  const labels = ["Algas", "Larvas de insectos", "Ranas", "Garzas"];

  it("crece hasta los rótulos cuando están todos junto a la figura", () => {
    const grown = withNamedLabels(page(names), crop, labels);
    expect(grown.y1).toBeGreaterThan(1930);
    expect(grown.y0).toBe(crop.y0);
    expect(grown.x0).toBeLessThanOrEqual(crop.x0);
  });

  it("no cambia si falta un nombre, si el texto está lejos o si es texto corrido", () => {
    expect(withNamedLabels(page(names), crop, [...labels, "Peces"])).toEqual(crop);
    const far = names.map((t) => ({ ...t, y0: t.y0 + 200, y1: t.y1 + 200 }));
    expect(withNamedLabels(page(far), crop, labels)).toEqual(crop);
    const prose = [...names, { text: "Explica", x0: 160, y0: 1940, x1: 300, y1: 1965 }];
    const grown = withNamedLabels(page(prose), crop, labels);
    expect(grown.y1).toBeLessThan(1965);
    expect(withNamedLabels(page(names), crop, [])).toEqual(crop);
  });
});

describe("paginación: una actividad que no cabe holgada no se empuja entera a otra hoja", () => {
  const steps = ["Mira el esquema completo y fíjate en qué dibujos o palabras aparecen.", "Busca dónde empieza cada flecha y dónde termina.", "Señala con el dedo o un color el camino de una flecha.", "Piensa qué une la flecha entre el principio y el final.", "Revisa si todas las flechas se leen en el mismo sentido."];
  const blocks: Block[] = [
    { id: "blk_steps", type: "image", trace: trace("adapted", ["act_3"]), source: { kind: "figure", spec: { kind: "steps", items: steps, title: "Cómo mirar las flechas", spec_version: 1 }, provenance: "generated", decision_id: "dec_3" }, alt_text: "Pasos para mirar las flechas." } as Block,
    { id: "blk_act3a", type: "activity", label: "3a", trace: trace("original", ["act_3"]), prompt: "Observa el esquema y explica qué indican las flechas.", response: { kind: "lines", lines: 3 }, resource_block_ids: ["blk_steps"] } as Block,
    { id: "blk_vocab", type: "vocabulary", items: [{ term: "Cadena alimentaria", definition: "Serie de seres vivos en la que cada uno se alimenta del anterior." }], trace: trace("support", ["act_3"]) } as Block,
  ];
  const doc = sheet(blocks);
  const activity = (nodes: readonly RenderNode[]) => nodes.find((n): n is Extract<RenderNode, { kind: "activity" }> => n.kind === "activity" && n.label === "3a");

  it("ni la caja de la actividad ni su unidad se marcan «no partir» si su estimación pasa de media página", () => {
    const { model } = buildRenderModel(doc, { mode: "student", deferred: [] });
    const a = activity(model.pages.flatMap((p) => p.nodes));
    expect(a).toBeDefined();
    expect(a!.figures.length + a!.supports.length).toBeGreaterThan(0);
    expect(a!.keepTogether).toBe(false);
    expect(a!.keepUnitTogether).toBe(false);
  });

  it("una actividad corta sigue entera", () => {
    const short = sheet([{ id: "blk_short", type: "activity", label: "1", trace: trace("original", ["act_1"]), prompt: "Nombra dos seres vivos.", response: { kind: "lines", lines: 2 } } as Block]);
    const a = buildRenderModel(short, { mode: "student", deferred: [] }).model.pages.flatMap((p) => p.nodes).find((n) => n.kind === "activity");
    expect(a && a.kind === "activity" && a.keepTogether && a.keepUnitTogether).toBe(true);
  });

  it("CSS: cuatro pasos o más, uno por fila; y una actividad no compacta puede seguir entre sus figuras", () => {
    const css = readFileSync("src/components/material/material.css", "utf8");
    expect(css).toMatch(/\.ms-vsteps:has\(> li:nth-child\(4\)\) > li \{ flex-basis: 100%;/);
    expect(css).toMatch(/\.ms-activity:not\(\[data-keep\]\) > \.ms-activity-figures \{ break-inside: auto; break-after: auto; \}/);
  });
});
