import { describe, expect, it } from "vitest";
import { expectedMarks } from "@/lib/materials/visuals/auto/marks";
import { locateVisuals } from "@/lib/materials/visuals/auto/locate";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { activities, coordinateGridSheet, GRID_INSTRUCTION, numberedLeadersSheet, NUMBERED_INSTRUCTION, twinSheet, VISUALS, USERS, LETTERS_INSTRUCTION } from "../support/marked-figures";

const visual = { title: "Partes de una planta", description: "Dibujo con partes señaladas.", text: null };
const user = { instruction: NUMBERED_INSTRUCTION, context: null, type: "short_answer" as const, answer_area: { type: "lines" as const, lines: null } };
const marks = { letters: [], numbers: ["1", "2", "3", "4"], measures: false };

describe("recuperar la figura original antes de intentar ilustrarla", () => {
  it("reconoce «partes señaladas con los números», sin exigir «flechas numeradas»", () => {
    expect(expectedMarks(visual, [user])).toEqual(marks);
    expect(expectedMarks(visual, [{ ...user, instruction: "Observa el dibujo de la célula. Escribe qué indican los números 1, 2, 3 y 4." }])).toEqual(marks);
  });

  it("conserva enumeraciones cortas y rangos explícitos de letras, sin inferirlas de palabras", () => {
    expect(expectedMarks(visual, [{ ...user, instruction: "Identifica las etiquetas A y B." }])?.letters).toEqual(["A", "B"]);
    expect(expectedMarks(visual, [{ ...user, instruction: "Identifica las letras A–D." }])?.letters).toEqual(["A", "B", "C", "D"]);
    expect(expectedMarks(visual, [{ ...user, instruction: "Las etiquetas están junto al dibujo." }])).toBeNull();
    expect(expectedMarks({ ...visual, description: "Triángulo con vértices A, B, C." }, [])?.letters).toEqual(["A", "B", "C"]);
    expect(expectedMarks({ ...visual, description: "Reloj con los números 12, 3, 6 y 9." }, [])?.numbers).toEqual(["12", "3", "6", "9"]);
  });

  it.each([
    "Suma los números 1, 2, 3 y 4.",
    "Resuelve los ejercicios 1, 2, 3 y 4.",
    "Trabaja con los números 1, 2, 3 y 4.",
  ])("no convierte una enumeración de ejercicios o datos en marcas: %s", (instruction) => {
    expect(expectedMarks(visual, [{ ...user, instruction }])).toBeNull();
  });

  it.each([100, 200])("conserva los cuatro números de sus líneas indicadoras a %i ppp", async (dpi) => {
    const { model } = await readPage(await numberedLeadersSheet(), "application/pdf", 1, dpi);
    const [located] = locateVisuals(model, [{ id: "vis_1", shape: "figure", activityIds: ["act_1"], marks }], activities(NUMBERED_INSTRUCTION));
    expect(located).toMatchObject({ accepted: true, evidence: { marks: { found: marks.numbers, legible: true }, anchor: "act_1" } });
    for (const t of model.texts.filter((t) => marks.numbers.includes(t.text))) {
      expect(located!.bounds!.x * model.width).toBeLessThanOrEqual(t.x0);
      expect((located!.bounds!.x + located!.bounds!.w) * model.width + 0.01).toBeGreaterThanOrEqual(t.x1);
    }
  });

  it.each(["no_leader", "too_far", "other_activity", "duplicate", "instruction_inside", "clipped"] as const)("rechaza etiquetas sin vínculo o un recorte inseguro: %s", async (variant) => {
    const { model } = await readPage(await numberedLeadersSheet(variant), "application/pdf", 1, 100);
    const [located] = locateVisuals(model, [{ id: "vis_1", shape: "figure", activityIds: ["act_1"], marks }], activities(NUMBERED_INSTRUCTION));
    expect(located).toMatchObject({ accepted: false, bounds: null });
  });

  it("una hipótesis de IA no decide entre dos figuras con las mismas letras", async () => {
    const { model } = await readPage(await twinSheet(), "application/pdf", 1, 100);
    const [located] = locateVisuals(model, [{ id: "vis_1", shape: "figure", activityIds: ["act_1"], marks: expectedMarks(VISUALS.letters, USERS.letters) }], activities(LETTERS_INSTRUCTION), new Map([
      ["vis_1", { bounds: { x: 0.08, y: 0.20, w: 0.31, h: 0.29 }, confidence: 1 }],
    ]));
    expect(located).toMatchObject({ accepted: false, bounds: null });
  });

  it.each([100, 200])("recupera el plano con todos sus ejes externos a %i ppp", async (dpi) => {
    const { model } = await readPage(await coordinateGridSheet(), "application/pdf", 1, dpi);
    const [located] = locateVisuals(model, [{ id: "vis_1", shape: "figure", activityIds: ["act_1"], marks: expectedMarks(VISUALS.grid, USERS.grid) }], activities(GRID_INSTRUCTION));
    expect(located).toMatchObject({ accepted: true, evidence: { marks: { found: ["A", "B", "C", "D", "1", "2", "3", "4"] } } });
  });

  it.each(["missing", "misaligned", "irregular"] as const)("no amplía el recorte de un plano sin correspondencia verificable: %s", async (variant) => {
    const { model } = await readPage(await coordinateGridSheet(variant), "application/pdf", 1, 100);
    const [located] = locateVisuals(model, [{ id: "vis_1", shape: "figure", activityIds: ["act_1"], marks: expectedMarks(VISUALS.grid, USERS.grid) }], activities(GRID_INSTRUCTION));
    expect(located).toMatchObject({ accepted: false, bounds: null });
  });
});
