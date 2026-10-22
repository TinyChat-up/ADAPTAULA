import { describe, expect, it } from "vitest";
import { locateVisuals, type Located, type VisualTarget } from "@/lib/materials/visuals/auto/locate";
import { expectedMarks, isMark, isMeasure } from "@/lib/materials/visuals/auto/marks";
import type { PageModel } from "@/lib/materials/visuals/auto/page-model";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { encodePng } from "@/lib/materials/visuals/raster";
import {
  ARROWS_INSTRUCTION, LETTERS_INSTRUCTION, POLYGON_INSTRUCTION, USERS, VISUALS, activities, arrowsSheet, betweenSheet, lettersSheet, polygonSheet, tinySheet, twinSheet, wrongPageSheet,
} from "../support/marked-figures";

/**
 * Figures located by their marks (auto_visuals@v6) on ORIGINAL synthetic sheets with the structure of the real 03, 06 and 07, and
 * adversarial variants. Deterministic: no model, no OCR, no network. These are not the real sheets.
 */

type Kind = keyof typeof VISUALS;
const target = (kind: Kind, activity = "act_1"): VisualTarget => ({ id: "vis_1", shape: "figure", activityIds: [activity], marks: expectedMarks(VISUALS[kind], USERS[kind] as never) });
const model = async (pdf: Promise<Uint8Array>, page = 1): Promise<PageModel> => (await readPage(await pdf, "application/pdf", page, 100)).model;
const locate = async (pdf: Promise<Uint8Array>, kind: Kind, instruction: string, activity = "act_1", page = 1): Promise<{ located: Located; page: PageModel }> => {
  const m = await model(pdf, page);
  return { located: locateVisuals(m, [target(kind, activity)], activities(instruction))[0]!, page: m };
};
/** The page's text boxes whose centre is inside the accepted crop. */
const inCrop = (page: PageModel, l: Located) => {
  const b = l.bounds!;
  return page.texts.filter((t) => {
    const cx = (t.x0 + t.x1) / 2 / page.width;
    const cy = (t.y0 + t.y1) / 2 / page.height;
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  }).map((t) => t.text.trim());
};

describe("marcas que nombra el análisis (nunca un modelo)", () => {
  it("letras, números de flechas y medidas, de la descripción o de los campos de la actividad", () => {
    expect(expectedMarks(VISUALS.letters, USERS.letters as never)).toEqual({ letters: ["A", "B", "C", "D"], numbers: [], measures: false });
    expect(expectedMarks(VISUALS.arrows, USERS.arrows as never)).toEqual({ letters: [], numbers: ["1", "2", "3", "4"], measures: false });
    expect(expectedMarks(VISUALS.polygon, USERS.polygon as never)).toEqual({ letters: [], numbers: [], measures: true });
    // From the answer fields alone («A:» … «D:», «Flecha 1:» …) when the description does not list them.
    expect(expectedMarks({ title: null, description: "Dibujo de una planta con sus partes.", text: null }, USERS.letters as never)?.letters).toEqual(["A", "B", "C", "D"]);
    expect(expectedMarks({ title: null, description: "Esquema del ciclo del agua.", text: null }, USERS.arrows as never)?.numbers).toEqual(["1", "2", "3", "4"]);
    // Words that name no marks: the figure is not located by marks (it stays as uncertain as before).
    expect(expectedMarks({ title: null, description: "Fotografía de un paisaje.", text: null }, [])).toBeNull();
  });

  it("formas en que un analizador real enumera las marcas: letras con su parte, números al inicio de cada paso, campos en línea", () => {
    const plant = { title: "Planta", description: "Cuatro líneas señalan partes con las letras D (flor), C (hoja), B (tallo) y A (raíz).", text: null };
    expect(expectedMarks(plant, [])?.letters).toEqual(["D", "C", "B", "A"]);
    const cycle = { title: "Ciclo del agua", description: "Cuatro cajas unidas por flechas numeradas en circuito: 1 del mar al vapor, 2 del vapor a las nubes, 3 de las nubes a la lluvia, 4 de la lluvia al mar.", text: null };
    expect(expectedMarks(cycle, [])?.numbers).toEqual(["1", "2", "3", "4"]);
    const short = (context: string) => [{ instruction: "Escribe.", context, type: "short_answer" as const, answer_area: { type: "lines" as const, lines: null } }];
    const bare = { title: null, description: "Dibujo de una planta con sus partes.", text: null };
    expect(expectedMarks(bare, short("A:, B:, C:, D:"))?.letters).toEqual(["A", "B", "C", "D"]);
    expect(expectedMarks({ ...bare, description: "Esquema del ciclo del agua." }, short("Flecha 1, Flecha 2, Flecha 3, Flecha 4"))?.numbers).toEqual(["1", "2", "3", "4"]);
    // Nothing invented: a capital outside a «letras …» enumeration, measures, a run that does not start at 1, prose in the context.
    expect(expectedMarks({ title: null, description: "Naranja con vitamina C (ácido) y A (retinol).", text: null }, [])).toBeNull();
    expect(expectedMarks({ title: null, description: "Flechas numeradas entre cajas.", text: "8 cm; 3 cm; 7 cm" }, [])?.numbers ?? []).toEqual([]);
    expect(expectedMarks({ title: null, description: "Pasos numerados: 2 hervir, 3 enfriar.", text: null }, [])).toBeNull();
    expect(expectedMarks(bare, short("A: la raíz, B: el tallo"))).toBeNull();
  });

  it("una medida y una marca son marcas; el texto corrido no", () => {
    for (const m of ["8 cm", "3,5 m", "12 mm", "4 cm²", "?", "A", "1"]) expect(isMark(m)).toBe(true);
    for (const t of ["Solución: 24 cm", "Flecha 1:", "A:", "Escribe qué parte"]) expect(isMark(t)).toBe(false);
    expect(isMeasure("24 cm")).toBe(true);
  });
});

describe("los tres casos prioritarios (sintéticos originales)", () => {
  it("03 · polígono con medidas: aceptado, con las cuatro medidas y los dos «?» dentro del recorte", async () => {
    const { located, page } = await locate(polygonSheet(), "polygon", POLYGON_INSTRUCTION);
    expect(located).toMatchObject({ accepted: true, evidence: { shape: "figure", signature: true, placement: true, unique: true, clean: true, anchor: "act_1", reason: "accepted", marks: { measures: 4, legible: true } } });
    expect(located.confidence).toBeGreaterThanOrEqual(0.75);
    const texts = inCrop(page, located);
    for (const m of ["8 cm", "3 cm", "7 cm", "5 cm"]) expect(texts).toContain(m);
    expect(texts.filter((t) => t === "?")).toHaveLength(2);
    expect(texts.some((t) => t.includes("Deduce"))).toBe(false);
  });

  it("06 · esquema A–D con líneas indicadoras: aceptado, con las cuatro letras y sin los campos «A:»…«D:»", async () => {
    const { located, page } = await locate(lettersSheet(), "letters", LETTERS_INSTRUCTION);
    expect(located).toMatchObject({ accepted: true, evidence: { reason: "accepted", marks: { found: ["A", "B", "C", "D"], legible: true } } });
    const texts = inCrop(page, located);
    for (const l of ["A", "B", "C", "D"]) expect(texts).toContain(l);
    expect(texts.some((t) => t.endsWith(":"))).toBe(false);
  });

  it("07 · flechas 1–4 entre cajas con texto: aceptado, con los cuatro números y el texto de sus cajas", async () => {
    const { located, page } = await locate(arrowsSheet(), "arrows", ARROWS_INSTRUCTION);
    expect(located).toMatchObject({ accepted: true, evidence: { reason: "accepted", marks: { found: ["1", "2", "3", "4"], legible: true } } });
    const texts = inCrop(page, located);
    for (const n of ["1", "2", "3", "4"]) expect(texts).toContain(n);
    expect(texts).toContain("Nubes con gotas");
    expect(texts.some((t) => t.startsWith("Flecha"))).toBe(false);
  });
});

describe("adversariales: lo incierto sigue siendo incierto", () => {
  it("figura entre dos actividades: es de la que la precede; atribuida a la siguiente no se acepta", async () => {
    expect((await locate(betweenSheet(), "letters", LETTERS_INSTRUCTION, "act_1")).located.accepted).toBe(true);
    const wrong = (await locate(betweenSheet(), "letters", LETTERS_INSTRUCTION, "act_2")).located;
    expect(wrong).toMatchObject({ accepted: false, bounds: null });
  });

  it("dos figuras parecidas en la misma zona: ninguna se acepta (nada dice cuál es)", async () => {
    const { located } = await locate(twinSheet(), "letters", LETTERS_INSTRUCTION);
    expect(located).toMatchObject({ accepted: false, bounds: null });
  });

  it("una etiqueta que queda fuera del alcance del dibujo: marcas incompletas, nunca un recorte que la corte", async () => {
    const { located } = await locate(lettersSheet({ detachedD: true }), "letters", LETTERS_INSTRUCTION);
    expect(located).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "marks_incomplete" } });
  });

  it("una etiqueta que falta: marcas incompletas", async () => {
    expect((await locate(lettersSheet({ omit: "B" }), "letters", LETTERS_INSTRUCTION)).located).toMatchObject({ accepted: false, evidence: { reason: "marks_incomplete" } });
  });

  it("una solución impresa: dentro del dibujo lo invalida; debajo, nunca entra en el recorte", async () => {
    expect((await locate(arrowsSheet({ solution: "inside" }), "arrows", ARROWS_INSTRUCTION)).located).toMatchObject({ accepted: false, bounds: null });
    const { located, page } = await locate(arrowsSheet({ solution: "below" }), "arrows", ARROWS_INSTRUCTION);
    expect(located.accepted).toBe(true);
    expect(inCrop(page, located).some((t) => /Solucion/.test(t))).toBe(false);
  });

  it("figura demasiado pequeña para imprimirse legible: no se acepta (ilegible)", async () => {
    expect((await locate(tinySheet(), "letters", LETTERS_INSTRUCTION)).located).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "illegible" } });
  });

  it("página equivocada: en la página que dice el análisis no hay figura; no se acepta nada", async () => {
    expect((await locate(wrongPageSheet(), "letters", LETTERS_INSTRUCTION, "act_1", 1)).located).toMatchObject({ accepted: false, bounds: null });
  });

  it("PDF sin capa de texto (una imagen de la misma ficha): identidad no verificable, nunca aceptado", async () => {
    const raster = (await readPage(await lettersSheet(), "application/pdf", 1, 100)).raster;
    const image = (await readPage(new Uint8Array(await encodePng(raster)), "image/png", 1, 100)).model;
    const located = locateVisuals(image, [target("letters")], activities(LETTERS_INSTRUCTION))[0]!;
    expect(located).toMatchObject({ accepted: false, bounds: null, evidence: { reason: "scan_identity_unverified" } });
  });

  it("sin marcas que nombre el análisis, una figura genérica sigue sin aceptarse solo por geometría (como antes)", async () => {
    const m = await model(lettersSheet());
    const located = locateVisuals(m, [{ id: "vis_1", shape: "figure", activityIds: ["act_1"] }], activities(LETTERS_INSTRUCTION))[0]!;
    expect(located.accepted).toBe(false);
    expect(located.confidence).toBeLessThan(0.75);
  });
});
