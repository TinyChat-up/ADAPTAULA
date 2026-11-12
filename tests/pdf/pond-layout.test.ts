import { describe, expect, it } from "vitest";
import { pondModel } from "../support/pond-plan";
import { placedText, type PlacedText } from "./analyze";
import { printPdf } from "./harness";
import { measureLayout } from "./layout-measurements";

/**
 * «Un estanque en equilibrio» as the student's PDF, not as an internal structure: where every line is printed, in which order and
 * how far from what it belongs to (docs/qa/bloque2-estanque). The same sheet through both planners; the PDF is rendered once.
 */

const PAGE_WIDTH_PT = 595.28;
const PAGE_HEIGHT_PT = 841.89;
const MARGIN_PT = (18 * 72) / 25.4;
const isPageLabel = (r: PlacedText) => /^\d+ \/ \d+$/.test(r.str);

describe.each(["v2", "v3"] as const)("PDF del estanque con el planificador %s", (planner) => {
  const rendered = (async () => {
    const { model, validation } = pondModel(planner);
    const printed = await printPdf(`pond-layout-${planner}`, model);
    const runs = await placedText(printed.result.pdf);
    const layout = await measureLayout(printed.print.html);
    return { model, validation, printed, runs, layout };
  })();

  /** Where the first run that starts with `text` is printed: PDF page (0-based) and distance from the top, in pt. */
  const where = async (text: string) => {
    const { runs } = await rendered;
    for (const [page, list] of runs.entries()) {
      const run = list.find((r) => r.str.startsWith(text));
      if (run) return { page, top: run.top, run };
    }
    throw new Error(`No se imprime «${text}»`);
  };
  const count = async (text: string) => (await rendered).runs.flat().filter((r) => r.str.includes(text)).length;
  /** The runs printed strictly between two places of the same page. */
  const between = async (a: string, b: string) => {
    const from = await where(a);
    const to = await where(b);
    expect(to.page).toBe(from.page);
    return (await rendered).runs[from.page]!.filter((r) => r.top > from.top + 1 && r.top < to.top - 1).map((r) => r.str);
  };

  it("se imprime sin cortes, desbordamientos, páginas vacías ni textos superpuestos", async () => {
    const { validation, printed, runs, model } = await rendered;
    expect(validation.status).not.toBe("not_renderable");
    expect(printed.validation.issues).toEqual([]);
    expect(runs.length).toBeGreaterThanOrEqual(model.pages.length);
    for (const page of printed.pages) {
      expect(page.marginInk, `margen de la página ${page.number}`).toBe(0);
      expect(page.contentInk, `página ${page.number} vacía`).toBeGreaterThan(0.02);
    }
    for (const [index, list] of runs.entries()) {
      const body = list.filter((r) => !isPageLabel(r));
      // Dentro del área imprimible (los márgenes son de 18 mm), sin salirse por la derecha ni por abajo.
      for (const r of body) {
        expect(r.x, `«${r.str}» (pág. ${index + 1})`).toBeGreaterThanOrEqual(MARGIN_PT - 1);
        expect(r.x + r.width, `«${r.str}» (pág. ${index + 1})`).toBeLessThanOrEqual(PAGE_WIDTH_PT - MARGIN_PT + 1);
        expect(r.top + r.height, `«${r.str}» (pág. ${index + 1})`).toBeLessThanOrEqual(PAGE_HEIGHT_PT - MARGIN_PT + 1);
      }
      // Ningún texto pisa a otro (cajas reducidas un 25 % para no contar el interlineado).
      const boxes = body.map((r) => ({ r, l: r.x + r.width * 0.125, rr: r.x + r.width * 0.875, t: r.top + r.height * 0.125, b: r.top + r.height * 0.875 }));
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlaps = a.l < b.rr && b.l < a.rr && a.t < b.b && b.t < a.b;
          expect(overlaps, `«${a.r.str}» pisa a «${b.r.str}» (pág. ${index + 1})`).toBe(false);
        }
      }
    }
  });

  it("la tipografía y el espacio de respuesta no se reducen para conseguir el orden", async () => {
    const { layout, model } = await rendered;
    expect(layout.bodyFontPt).toBeCloseTo(12.5, 1);
    expect(layout.writingLinesMm.length).toBeGreaterThan(0);
    expect(layout.writingLinesMm.every((mm) => mm >= model.tokens.answerLineMm - 0.1)).toBe(true);
    expect(layout.activities).toBe(8);
  });

  it("«Lee el texto con atención» se imprime antes de la lectura, en la misma página", async () => {
    const instruction = await where("Lee el texto con atención");
    const reading = await where("En un estanque situado");
    expect(instruction.page).toBe(reading.page);
    expect(instruction.top).toBeLessThan(reading.top);
    expect(await count("Lee el texto con atención")).toBe(1);
  });

  it("los componentes de la actividad 2 están pegados a su consigna, tras su ejemplo y sobre su tabla, en una misma página", async () => {
    const example = await where("Clasifica: Pez");
    const components = await where("Algas · Agua · Larvas de insectos");
    const prompt = await where("Clasifica estos componentes del estanque");
    const table = await where("SERES VIVOS");
    expect([components.page, prompt.page, table.page]).toEqual([example.page, example.page, example.page]);
    expect(example.top).toBeLessThan(components.top);
    expect(components.top).toBeLessThan(prompt.top);
    expect(prompt.top).toBeLessThan(table.top);
    // Entre los componentes y la consigna solo está su marca de actividad (el número), ningún otro texto.
    expect((await between("Algas · Agua · Larvas de insectos", "Clasifica estos componentes del estanque")).filter((s) => s.length > 2)).toEqual([]);
    expect(await count("Algas · Agua · Larvas de insectos")).toBe(1);
  });

  it("la afirmación de la actividad 5 se imprime una sola vez, justo sobre su consigna", async () => {
    expect(await count("Si disminuye el agua del estanque")).toBe(1);
    const statement = await where("«Si disminuye el agua del estanque");
    const prompt = await where("Valora esta afirmación y justifica");
    expect(statement.page).toBe(prompt.page);
    expect(statement.top).toBeLessThan(prompt.top);
    expect((await between("«Si disminuye el agua del estanque", "Valora esta afirmación y justifica")).filter((s) => s.length > 2)).toEqual(["exactamente de la misma manera»."]);
  });

  it("3a/3b y 4a/4b se imprimen en la misma hoja cada pareja; el esquema y la tabla, con su actividad", async () => {
    const third = await where("Explica qué indican las flechas");
    const thirdB = await where("¿Qué podría ocurrir con las ranas");
    const fourth = await where("¿Cuántos centímetros descendió");
    const fourthB = await where("Explica una consecuencia posible");
    expect(thirdB.page).toBe(third.page);
    expect(fourthB.page).toBe(fourth.page);
    expect(new Set([third.page, fourth.page, (await where("Valora esta afirmación")).page]).size).toBe(3);
    expect((await where("Larvas de insectos")).page).toBe(third.page);
    expect((await where("MAYO")).page).toBe(fourth.page);
    expect((await where("Un charco tenía 20 cm")).page).toBe(fourth.page);
  });

  it("las autocomprobaciones van tras su actividad y la revisión final es lo último de la ficha", async () => {
    const { runs } = await rendered;
    const order = [
      "Identifica dos cambios ocurridos", "ANTES DE ESCRIBIR",
      "Valora esta afirmación", "PARA VALORAR",
      "Propón una medida", "MI MEDIDA",
      "REVISIÓN FINAL",
    ];
    const places = await Promise.all(order.map(where));
    for (let i = 1; i < places.length; i += 1) expect(places[i]!.page * 10_000 + places[i]!.top, `${order[i]} tras ${order[i - 1]}`).toBeGreaterThan(places[i - 1]!.page * 10_000 + places[i - 1]!.top);
    // Cada autocomprobación está en la página de su actividad.
    expect(places[1]!.page).toBe(places[0]!.page);
    expect(places[3]!.page).toBe(places[2]!.page);
    expect(places[5]!.page).toBe(places[4]!.page);
    // La revisión final cierra la última página: nada impreso debajo de ella salvo el número de página.
    const last = runs.at(-1)!.filter((r) => !isPageLabel(r));
    const final = last.find((r) => r.str === "REVISIÓN FINAL")!;
    expect(last.filter((r) => r.top > final.top).map((r) => r.str)).toEqual(["He contestado todo", "He releído mis respuestas"]);
    expect(places.at(-1)!.page).toBe(runs.length - 1);
    // El recordatorio general no es una revisión: sigue al principio de la ficha.
    expect((await where("Lee despacio cada consigna")).page).toBe(0);
  });

  it("no se pierde ninguna consigna, dato ni texto del original en el PDF", async () => {
    const { runs } = await rendered;
    const text = runs.flat().map((r) => r.str).join(" ").replace(/\s+/g, " ");
    for (const piece of [
      "Identifica dos cambios ocurridos en el estanque entre mayo y junio", "Clasifica estos componentes del estanque", "Explica qué indican las flechas del esquema",
      "Justifica tu predicción", "Escribe la operación", "Explica una consecuencia posible de ese descenso", "Usa información del texto para defender tu respuesta",
      "Propón una medida para proteger el estanque", "Continúa trabajando a partir de la lectura de la página anterior", "30 cm de profundidad", "18 cm de profundidad",
      "SERES VIVOS", "ELEMENTOS NO VIVOS", "Garzas", "Relación alimentaria del estanque", "Nombre", "Fecha",
    ]) expect(text, piece).toContain(piece);
  });
});
