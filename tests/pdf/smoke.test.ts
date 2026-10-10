import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Block } from "@/lib/schemas/material-document";
import { bodyText, MARGIN_PX, type PageAnalysis } from "./analyze";
import { ANSWER_KEY_SECRET, SPANISH, TEACHER_ONLY, chart, checklist, document, heading, image, instruction, lines, paragraph, pin, redVisual, rotatedCropVisual, steps, studentModel, table, withSecretKey } from "./fixtures";
import { OUT_DIR, printPdf, type Printed } from "./harness";

/**
 * `pnpm smoke:pdf`: real PDFs, locally, with the production engine (`@sparticuz/chromium` 153 via `playwright-core` 1.63), the
 * production renderer (`material_renderer@v2`) and the production validation, then checked in depth (pdf.js text + 100 ppp PNG).
 * Visual regression: structure (pages, size, margins, cuts) and ink per page against a small baseline, never bytes.
 */

const BASELINE_FILE = path.join(import.meta.dirname, "baselines.json");
const UPDATE = process.env.UPDATE_PDF_BASELINES === "1";
const INK_TOLERANCE = 0.004;
type Baselines = Record<string, { pages: number; ink: number[] }>;
const baselines: Baselines = existsSync(BASELINE_FILE) ? (JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baselines) : {};
const measured: Baselines = {};
const report: Array<Record<string, unknown>> = [];

const VIS_A = "0b6f9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const VIS_B = "7d2c1b0a-9f8e-4d7c-b6a5-4f3e2d1c0b9a";
const VIS_TALL = "3a4b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d";

const body = (p: Printed) => p.print.html.slice(p.print.html.indexOf("<body>"));
/** Inter draws U+201D («”») with the glyph it shares with U+02EE, and Chromium's PDF text map names the lower code point: the
 * quote prints right but a reader extracts «ˮ». Stated here so a change in either is noticed, never hidden. */
const extracted = (text: string) => text.replaceAll(" ˮ", "”").replaceAll("ˮ", "”");

function common(p: Printed): void {
  expect(p.validation.issues).toEqual([]);
  expect(p.validation.pages.every((s) => Math.abs(s.widthPt - 595.28) < 2 && Math.abs(s.heightPt - 841.89) < 2)).toBe(true);
  expect(p.validation.fonts.every((f) => f.startsWith("Inter-"))).toBe(true);
  expect(p.result.blockedRequests).toEqual([]);
  expect(p.print.html).not.toMatch(/<script|<link|<iframe|https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i);
  expect(p.print.html.slice(p.print.html.indexOf("<body>"))).not.toMatch(/ms-teacher|ms-missing|ms-chrome|data-app/);
  const all = p.pages.map((pg) => pg.text).join(" ");
  expect(all).not.toContain(ANSWER_KEY_SECRET);
  for (const t of TEACHER_ONLY) expect(all).not.toContain(t);
  p.pages.forEach((page, i) => {
    // Physical page number, printed in the bottom-right page margin (inside the 18 mm margin band, never over the content).
    expect(page.pageLabel?.text, `página ${i + 1} sin número físico`).toBe(`${i + 1} / ${p.pages.length}`);
    expect(page.pageLabel!.yPt).toBeLessThan(18 * 72 / 25.4);
    expect(page.pageLabel!.xPt).toBeGreaterThan(595.28 / 2);
    expect(bodyText(page).length > 0 || page.contentInk > 0.002, `página ${i + 1} en blanco`).toBe(true);
    expect(page.marginInk, `tinta fuera de márgenes en la página ${i + 1}`).toBeLessThan(40);
  });
  measured[p.name] = { pages: p.pages.length, ink: p.pages.map((pg) => Math.round(pg.ink * 10000) / 10000) };
  const base = baselines[p.name];
  if (!UPDATE) {
    expect(base, `sin línea base para ${p.name} (UPDATE_PDF_BASELINES=1)`).toBeDefined();
    expect(p.pages.length).toBe(base!.pages);
    p.pages.forEach((pg, i) => expect(Math.abs(pg.ink - base!.ink[i]!), `tinta de la página ${i + 1}`).toBeLessThanOrEqual(INK_TOLERANCE));
  }
  report.push({ fixture: p.name, pages: p.pages.length, kb: Math.round(p.result.pdf.length / 1024), launchMs: Math.round(p.result.timings.launchMs), contentMs: Math.round(p.result.timings.contentMs), readyMs: Math.round(p.result.timings.readyMs), pdfMs: Math.round(p.result.timings.pdfMs), validationMs: Math.round(p.validationMs), totalMs: Math.round(p.result.timings.totalMs), peakRssMb: p.peakRssMb });
}

const redPages = (p: Printed) => p.pages.filter((pg) => pg.red && pg.red.count > 50);
const contentHeightPx = (page: PageAnalysis) => page.heightPx - 2 * MARGIN_PX;

let tallest = 0;

describe("smoke:pdf · motor real, renderer real", () => {
  afterAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
    if (UPDATE) writeFileSync(BASELINE_FILE, `{\n${Object.entries(measured).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`);
    console.table(report);
  });

  it("básico y caracteres españoles (el arranque en frío de una instancia nueva: cold-start.test.ts)", async () => {
    const p = await printPdf("basico", studentModel(withSecretKey(document([[heading("Ficha básica"), paragraph(SPANISH), instruction("Lee el texto y responde."), lines("1", "¿Qué animal aparece en el texto?", 3)]]))));
    common(p);
    expect(extracted(p.pages[0]!.text)).toContain(SPANISH);
    expect(p.result.engine.chromium).toMatch(/^153\./);
  });

  it("básico en caliente (Chromium ya extraído)", async () => {
    const p = await printPdf("basico_caliente", studentModel(document([[heading("Ficha básica"), paragraph(SPANISH), lines("1", "Responde.", 3)]])));
    common(p);
  });

  it("caracteres españoles: todos los glifos se extraen tal cual, con Inter incrustada", async () => {
    const p = await printPdf("caracteres_espanoles", studentModel(document([[heading("¿Ñandú? ¡Sí! «Pingüino»"), paragraph(SPANISH), paragraph(`**${SPANISH}**`), paragraph(`_${SPANISH}_`)]])));
    common(p);
    for (const ch of "ñÑáéíóúü¿¡º·…«»–—“") expect(p.pages[0]!.text).toContain(ch);
    expect(p.pages[0]!.text).toMatch(/dobles ?\u02ee/);
    expect(extracted(p.pages[0]!.text)).toContain("“dobles”");
    expect(p.validation.fonts).toEqual(expect.arrayContaining(["Inter-Regular", "Inter-Bold"]));
  });

  it("instrucciones largas: varios párrafos y pasos numerados", async () => {
    const long = Array.from({ length: 6 }, (_, i) => `Párrafo ${i + 1} de las instrucciones. `.repeat(12).trim()).join("\n\n");
    const p = await printPdf("instrucciones_largas", studentModel(document([[heading("Instrucciones"), instruction(long, steps(10)), lines("1", "Escribe tu respuesta.", 4)]])));
    common(p);
    expect(p.pages.map((pg) => pg.text).join(" ")).toContain("Paso 10:");
  });

  it("tabla", async () => {
    const p = await printPdf("tabla", studentModel(document([[heading("Datos"), table("Tabla de datos", 6)]])));
    common(p);
    expect(p.pages[0]!.text).toContain("Fila 6 · dato 3");
  });

  it("gráfico de una serie: se dibuja y lleva su tabla", async () => {
    const p = await printPdf("grafico_una_serie", studentModel(document([[heading("Gráfico"), chart([{ label: null, values: [10, 20, 15, 30] }])]])));
    common(p);
    expect(body(p)).toContain('class="ms-plot"');
    expect(body(p)).toContain("ms-data");
  });

  it("gráfico degradado a tabla: varias series sin nombres verificados → solo la tabla, sin leyenda", async () => {
    const p = await printPdf("grafico_degradado", studentModel(document([[heading("Gráfico"), chart([{ label: null, values: [1, 2, 3, 4] }, { label: null, values: [4, 3, 2, 1] }], "line")]])));
    common(p);
    expect(body(p)).not.toContain('class="ms-plot"');
    expect(body(p)).not.toContain("ms-legend");
    expect(body(p)).toContain("ms-data");
  });

  it("visual necesario: la instancia fijada aparece entera", async () => {
    const asset = pin(VIS_A, await redVisual(600, 400));
    const p = await printPdf("visual_necesario", studentModel(document([[heading("Observa la figura"), image("vis_1", "Figura 1"), lines("1", "Describe la figura.", 3)]]), { vis_1: asset }, ["vis_1"]), [asset], 1);
    common(p);
    expect(p.validation.imageCount).toBe(1);
    expect(redPages(p)).toHaveLength(1);
    expect(p.print.assets).toEqual([`asset:${VIS_A}@${asset.sha256}`]);
  });

  it("visual derivado de un original con /Rotate y CropBox desplazado (recorte real del pipeline)", async () => {
    const asset = pin(VIS_B, await rotatedCropVisual());
    const p = await printPdf("visual_rotacion_cropbox", studentModel(document([[heading("Mapa"), image("vis_2", "Mapa del original")]]), { vis_2: asset }, ["vis_2"]), [asset], 1);
    common(p);
    expect(p.pages).toHaveLength(1);
    expect(redPages(p)).toHaveLength(1);
    expect(bodyText(p.pages[0]!)).toContain("Mapa del original");
  });

  it("visual más alto que una página: se reduce al alto útil, sin cortarse ni partirse", async () => {
    const asset = pin(VIS_TALL, await redVisual(400, 2400));
    const p = await printPdf("visual_demasiado_alto", studentModel(document([[heading("Figura alta"), image("vis_3", "Figura muy alta")]]), { vis_3: asset }, ["vis_3"]), [asset], 1);
    common(p);
    expect(p.pages).toHaveLength(1);
    const red = redPages(p);
    expect(red).toHaveLength(1);
    expect(red[0]!.red!.bottom - red[0]!.red!.top).toBeLessThan(contentHeightPx(red[0]!) * 0.76);
    expect(red[0]!.red!.bottom).toBeLessThan(red[0]!.heightPx - MARGIN_PX);
    expect(bodyText(p.pages[0]!)).toContain("Figura muy alta");
  });

  it("respuesta corta", async () => {
    common(await printPdf("respuesta_corta", studentModel(document([[heading("Respuesta corta"), lines("1", "¿Cuántos años tiene el árbol?", 2)]]))));
  });

  it("respuesta larga: 40 líneas continúan en la página siguiente", async () => {
    const p = await printPdf("respuesta_larga", studentModel(document([[heading("Redacción"), lines("1", "Escribe una redacción de 150 a 180 palabras.", 40)]])));
    common(p);
    expect(p.pages.length).toBeGreaterThanOrEqual(2);
  });

  it("checklist de 12 elementos", async () => {
    const p = await printPdf("checklist", studentModel(document([[heading("Revisión"), checklist(12)]])));
    common(p);
    expect(p.pages.map((pg) => pg.text).join(" ")).toContain("Comprobación número 12");
  });

  it("varias páginas lógicas: cada una empieza página física", async () => {
    const p = await printPdf("varias_paginas", studentModel(document([[heading("Página uno"), paragraph("Primera.")], [heading("Página dos"), paragraph("Segunda.")], [heading("Página tres"), paragraph("Tercera.")]])));
    common(p);
    expect(p.pages.map((pg) => bodyText(pg))).toEqual([expect.stringContaining("Página uno"), expect.stringContaining("Página dos"), expect.stringContaining("Página tres")]);
  });

  it("diez páginas lógicas (presupuesto de tiempo de una ficha larga)", async () => {
    const pages = Array.from({ length: 10 }, (_, i) => [heading(`Página ${i + 1}`), paragraph(SPANISH), table(`Tabla ${i + 1}`, 4), lines(String(i + 1), "Responde.", 6)]);
    const p = await printPdf("diez_paginas", studentModel(document(pages)));
    common(p);
    expect(p.pages).toHaveLength(10);
  });

  it("hoja que llena exactamente una página: ni página en blanco detrás ni entre hojas", async () => {
    const fill = (n: number, extra: Block[][] = []) => studentModel(document([[heading("Llenado"), lines("1", "Escribe.", n)], ...extra]));
    let lo = 15;
    let hi = 40;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const { pages } = await printPdf(`llenado_sonda_${mid}`, fill(mid));
      if (pages.length === 1) lo = mid;
      else hi = mid - 1;
    }
    tallest = lo;
    const exact = await printPdf("llenado_exacto", fill(lo));
    common(exact);
    expect(exact.pages).toHaveLength(1);
    const two = await printPdf("llenado_exacto_y_otra_hoja", fill(lo, [[paragraph("Segunda hoja lógica.")]]));
    common(two);
    expect(two.pages).toHaveLength(2);
    expect(bodyText(two.pages[1]!)).toContain("Segunda hoja lógica");
  });

  it("salto cerca de un visual: el visual pasa entero a la página siguiente", async () => {
    const asset = pin(VIS_A, await redVisual(600, 400));
    const p = await printPdf("salto_cerca_visual", studentModel(document([[heading("Llenado"), lines("1", "Escribe.", tallest - 2), image("vis_1", "Figura al final")]]), { vis_1: asset }, ["vis_1"]), [asset], 1);
    common(p);
    const red = redPages(p);
    expect(red).toHaveLength(1);
    expect(red[0]!.number).toBe(2);
    expect(red[0]!.red!.top).toBeGreaterThan(MARGIN_PX - 4);
  });

  it("salto cerca de una tabla: la tabla sigue en la página siguiente y repite su cabecera", async () => {
    const p = await printPdf("salto_cerca_tabla", studentModel(document([[heading("Llenado"), lines("1", "Escribe.", tallest - 4), table("Tabla partida", 12)]])));
    common(p);
    expect(p.pages.length).toBe(2);
    expect(p.pages[1]!.text).toContain("Cabecera 1");
    expect(p.pages[1]!.text).toContain("Fila 12 · dato 3");
  });

  it("tabla larga (40 filas): cabecera repetida en cada página, sin filas partidas", async () => {
    const p = await printPdf("tabla_larga", studentModel(document([[heading("Tabla larga"), table("Muchas filas", 40)]])));
    common(p);
    expect(p.pages.length).toBeGreaterThanOrEqual(2);
    for (const page of p.pages) expect(page.text).toContain("Cabecera 1");
    const rows = p.pages.flatMap((pg) => [...pg.text.matchAll(/Fila (\d+) · dato 3/g)].map((m) => Number(m[1])));
    expect(rows).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it("actividad larga (enunciado, pasos y respuesta): fluye entre páginas sin perder nada", async () => {
    const prompt = Array.from({ length: 4 }, (_, i) => `Parte ${i + 1} del enunciado. `.repeat(10).trim()).join("\n\n");
    const activity: Block = { ...lines("1", prompt, 30), ...{ steps: steps(10) } } as Block;
    const p = await printPdf("actividad_larga", studentModel(document([[heading("Actividad larga"), activity]])));
    common(p);
    expect(p.pages.length).toBeGreaterThanOrEqual(2);
    expect(p.pages.map((pg) => pg.text).join(" ")).toContain("Paso 10:");
  });
});
