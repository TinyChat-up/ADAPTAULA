import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { ANSWER_SPACE_VERSION, answerSpace, calculationRows, operationsOf, requestedResults, spaceContextOf, spaceNeed, statedLines, type SpaceContext } from "@/lib/adaptation/answer-space";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { activityPrompt, responseFor } from "@/lib/adaptation/document";
import { activityStructure, inlineFieldLabels } from "@/lib/adaptation/structure";
import { buildRenderModel, subjectName } from "@/lib/render/model";
import { renderTokens } from "@/lib/render/tokens";
import type { AnalysisActivity } from "@/lib/schemas/material-analysis";
import { DraftBlockSchema, MaterialDocumentSchema, type ResponseSpec } from "@/lib/schemas/material-document";
import { GALLERY, galleryDocument } from "../support/editorial-gallery";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/**
 * answer_space@v1 (docs/EDITORIAL.md): what kind of room, and how much, each activity gets to be solved on paper. Deterministic:
 * from the analysis's structured fields, the stage and the functional needs; the words of the instruction only size a decision.
 */

const activity = (over: Partial<AnalysisActivity>): AnalysisActivity => ({
  id: "act_1", section_id: null, page: 1, label: "1", type: "short_answer", instruction: "Responde.", context: null, resource_ids: [], objective_ids: [],
  response_format: "write_text", answer_area: { type: "lines", lines: 2 }, expected_answer: { basis: "not_inferable", value: null }, difficulty: "medium", confidence: 0.9, ...over,
});
const ctx = (over: Partial<SpaceContext> = {}): SpaceContext => ({ stage: "primaria", year: 4, mathematical: true, needs: new Map(), protectedOf: () => [], ...over });
const decide = (a: AnalysisActivity, c = ctx()) => answerSpace(a, responseFor(a), c).response;

describe("campos en línea: forman la zona de respuesta y no se imprimen dos veces", () => {
  it("«A:, B:, C:, D:» y «Flecha 1, Flecha 2, Flecha 3, Flecha 4» (sin dos puntos) son campos", () => {
    expect(inlineFieldLabels("A:, B:, C:, D:")).toEqual(["A", "B", "C", "D"]);
    expect(inlineFieldLabels("Flecha 1, Flecha 2, Flecha 3, Flecha 4")).toEqual(["Flecha 1", "Flecha 2", "Flecha 3", "Flecha 4"]);
    const plant = activity({ instruction: "Escribe qué parte indica cada letra.", context: "A:, B:, C:, D:", answer_area: { type: "box", lines: null } });
    expect(responseFor(plant)).toEqual({ kind: "fields", fields: ["A", "B", "C", "D"].map((label) => ({ label, space: "lines", lines: 1 })) });
    // The prompt keeps the instruction only: the fields are drawn by the answer area, never printed again as text.
    expect(activityPrompt(plant)).toBe("Escribe qué parte indica cada letra.");
    expect(activityStructure({ ...plant, context: "Flecha 1, Flecha 2, Flecha 3, Flecha 4" }).context).toBeNull();
  });

  it("una frase con comas, letras repetidas o números que no siguen no son campos", () => {
    for (const line of ["Rojo, azul y verde", "A, A, B", "Flecha 1, Flecha 3", "Flecha 1, Paso 2", "Juan, Ana", "A"]) expect(inlineFieldLabels(line)).toBeNull();
  });
});

describe("qué tiene que producir el alumno (campos estructurados del análisis)", () => {
  it("cálculo escrito solo en un contexto matemático o con una operación protegida; dibujar, marcar o elegir no es cálculo", () => {
    expect(spaceNeed(activity({ type: "calculation", response_format: "calculate" }), ctx())).toBe("calculation");
    expect(spaceNeed(activity({ type: "problem_solving", response_format: "write_text" }), ctx())).toBe("calculation");
    expect(spaceNeed(activity({ type: "calculation", response_format: "calculate" }), ctx({ mathematical: false }))).not.toBe("calculation");
    expect(spaceNeed(activity({ type: "calculation", response_format: "write_number" }), ctx({ mathematical: false, protectedOf: () => [{ id: "prt_1", type: "target_operation", importance: "essential", value: "x", activity_ids: ["act_1"], resource_ids: [] }] }))).toBe("calculation");
    for (const response_format of ["mark", "select_option", "match", "order", "fill_blanks"] as const) expect(spaceNeed(activity({ type: "calculation", response_format }), ctx())).toBe("keep");
    expect(spaceNeed(activity({ type: "drawing", response_format: "draw" }), ctx())).toBe("drawing");
  });

  it("las cuadrículas no aparecen fuera de lo que se calcula", () => {
    expect(decide(activity({ type: "open_question", instruction: "¿Por qué llueve? Explícalo." })).kind).toBe("lines");
    expect(decide(activity({ type: "short_answer", instruction: "¿Qué número sigue a 499?", response_format: "write_number" }), ctx({ mathematical: false })).kind).toBe("lines");
    expect(decide(activity({ type: "drawing", response_format: "draw", answer_area: { type: "box", lines: null } }))).toEqual({ kind: "box", size: "large" });
    // Answered on its figure (mark a number line): no second space at all.
    expect(decide(activity({ type: "calculation", response_format: "mark", answer_area: { type: "none", lines: null }, resource_ids: ["vis_1"] }))).toEqual({ kind: "none" });
  });
});

describe("cuadrícula: cuándo y de qué tamaño", () => {
  it("filas por operaciones: resultados pedidos, expresiones impresas, datos del problema y dificultad", () => {
    expect(requestedResults(activity({ instruction: "Calcula el perímetro y el área de A. Muestra cómo has dividido la figura." }))).toBe(3);
    expect(operationsOf(activity({ type: "calculation", instruction: "Calcula: 36 × 4 y 125 + 98 + 47" }))).toBe(2);
    expect(operationsOf(activity({ type: "problem_solving", instruction: "Se compran 6 paquetes de 12. Se comen 58. ¿Cuántos sobran?" }))).toBe(2);
    const one = calculationRows(activity({ type: "calculation", instruction: "Calcula en columna: 347 + 285" }), ctx({ year: 3 }));
    const two = calculationRows(activity({ type: "calculation", instruction: "Calcula: 36 × 4 y 125 + 98 + 47" }), ctx({ year: 3 }));
    const division = calculationRows(activity({ type: "calculation", instruction: "Divide: 7.452 : 36" }), ctx({ year: 6 }));
    expect(one).toBe(5);
    expect(two).toBe(9);
    expect(division).toBeGreaterThan(one);
    // «Calcula: 347» is not a division (a colon before a number is punctuation).
    expect(calculationRows(activity({ type: "calculation", instruction: "Calcula: 347 + 285" }), ctx({ year: 3 }))).toBe(one);
    // Bounded: a calculation area never takes more than a third of a Primaria page.
    expect(calculationRows(activity({ type: "calculation", instruction: "Calcula a, b, c. ¿x? ¿y? ¿z? ¿w?", difficulty: "high" }), ctx({ year: 5 }))).toBe(12);
  });

  it("un problema recibe solo las partes que necesita: datos si hay qué organizar, respuesta con hueco para la unidad si hay unidades", () => {
    const bus = activity({ type: "problem_solving", response_format: "calculate", instruction: "El autobús recorre 145 km a la ida y 138 km a la vuelta. ¿Cuántos kilómetros recorre en total?" });
    expect(decide(bus)).toEqual({ kind: "fields", fields: [{ label: "Operaciones", space: "grid", lines: 5 }, { label: "Respuesta", space: "lines", lines: 1, unit: true }] });
    const planning = ctx({ needs: new Map([["planning_support", "medium"]]) });
    expect(decide(bus, planning)).toMatchObject({ fields: [{ label: "Datos y razonamiento" }, { label: "Operaciones" }, { label: "Respuesta" }] });
    // A bare calculation is answered in its squares: no answer line, no unit slot.
    expect(decide(activity({ type: "calculation", response_format: "calculate", instruction: "Calcula 3/4 + 2/3." }))).toEqual({ kind: "grid", rows: 5 });
    // The unit is never printed: only an empty slot for it.
    const json = JSON.stringify(decide(bus));
    expect(json).not.toMatch(/km|kil[oó]metros/);
  });

  it("los campos impresos por el original conservan sus etiquetas; el de operaciones pasa a cuadrícula", () => {
    const printed = activity({ type: "problem_solving", response_format: "calculate", instruction: "Una botella tiene 750 ml. Cada vaso, 150 ml. ¿Cuántos vasos?", context: "Operaciones y unidades:\nRespuesta:", answer_area: { type: "box", lines: null } });
    expect(decide(printed)).toEqual({ kind: "fields", fields: [{ label: "Operaciones y unidades", space: "grid", lines: 5 }, { label: "Respuesta", space: "lines", lines: 2, unit: true }] });
  });
});

describe("escritura y explicaciones", () => {
  it("«line» con 4 líneas da 4 líneas; una respuesta por elemento pedido; nunca menos que el original", () => {
    expect(responseFor(activity({ answer_area: { type: "line", lines: 4 } }))).toEqual({ kind: "lines", lines: 4 });
    expect(decide(activity({ instruction: "Escribe dos servicios que tiene una ciudad.", answer_area: { type: "lines", lines: 1 } }), ctx({ mathematical: false }))).toEqual({ kind: "lines", lines: 2 });
    expect(decide(activity({ answer_area: { type: "lines", lines: 6 } }), ctx({ mathematical: false }))).toEqual({ kind: "lines", lines: 6 });
  });

  it("explicar pide más que una palabra, según el curso; una redacción respeta la extensión que indica", () => {
    const explain = activity({ type: "open_question", instruction: "¿Por qué es importante la raíz? Explica tu respuesta.", answer_area: { type: "lines", lines: 1 } });
    expect(decide(explain, ctx({ mathematical: false, year: 3 }))).toEqual({ kind: "lines", lines: 4 });
    expect(decide(explain, ctx({ mathematical: false, year: 1 }))).toEqual({ kind: "lines", lines: 3 });
    expect(statedLines(activity({ instruction: "Escribe un texto de 60-80 palabras." }))).toBe(8);
    expect(statedLines(activity({ instruction: "Escribe 4-5 líneas." }))).toBe(5);
    expect(decide(activity({ type: "writing", instruction: "Escribe un texto de 60-80 palabras.", answer_area: { type: "lines", lines: 3 } }), ctx({ mathematical: false }))).toEqual({ kind: "lines", lines: 8 });
    // Without a stated length, the original's room (4+ lines) is the evidence; only without it does the grade decide.
    expect(decide(activity({ type: "writing", instruction: "Escribe sobre tu barrio.", answer_area: { type: "lines", lines: 5 } }), ctx({ mathematical: false, year: 9 }))).toEqual({ kind: "lines", lines: 5 });
    expect(decide(activity({ type: "writing", instruction: "Escribe sobre tu barrio.", answer_area: { type: "lines", lines: 2 } }), ctx({ mathematical: false, year: 5 }))).toEqual({ kind: "lines", lines: 10 });
  });

  it("sujeto y predicado de cada oración numerada: un par de campos por oración", () => {
    const grammar = activity({ instruction: "Separa el sujeto y el predicado de cada oración.", context: "1. Los alumnos visitaron el museo.\n2. Mi hermana dibuja.\nSujeto:\nPredicado:" });
    expect(decide(grammar, ctx({ mathematical: false }))).toEqual({ kind: "fields", fields: ["1. Sujeto", "1. Predicado", "2. Sujeto", "2. Predicado"].map((label) => ({ label, space: "lines", lines: 1 })) });
  });

  it("lo que fija el original o una decisión no cambia: formatos cerrados, ordenar, comparar y un formato elegido por el plan", () => {
    const closed: ResponseSpec = { kind: "choice", multiple: false, options: [{ id: "a", text: "Sí" }, { id: "b", text: "No" }] };
    expect(answerSpace(activity({ type: "multiple_choice" }), closed, ctx()).response).toBe(closed);
    const short: ResponseSpec = { kind: "lines", lines: 1 };
    expect(answerSpace(activity({ type: "open_question", instruction: "¿Por qué? Explícalo." }), short, ctx(), true).response).toBe(short);
    const unknown = activity({ type: "other", response_format: "write_text", answer_area: { type: "unknown", lines: null } });
    expect(answerSpace(unknown, responseFor(unknown), ctx({ mathematical: false })).need).toBe("keep");
  });
});

describe("necesidades funcionales: el espacio físico cambia, la decisión pedagógica no", () => {
  it("motricidad fina o letra grande → renglones y casillas un quinto más amplios; sin ella, los de la etapa", () => {
    const base = { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "standard", max_tasks_per_page: null, color_independent: false, text_alternatives_for_visuals: false } as const;
    const standard = renderTokens(base, "primaria");
    const roomy = renderTokens({ ...base, answer_space: "roomy" }, "primaria");
    expect([standard.gridCellMm, standard.answerLineMm]).toEqual([7, 10]);
    expect([roomy.gridCellMm, roomy.answerLineMm]).toEqual([8.5, 12]);
    expect([renderTokens(base, "eso").gridCellMm, renderTokens(base, "bachillerato").gridCellMm]).toEqual([6, 5]);
  });

  it("el contexto (política 2) solo dice «roomy» cuando cambia algo; la política 1 no cambia nunca (huellas históricas)", () => {
    const sheet = GALLERY.find((g) => g.id === "cn3-esquema")!;
    const { analysis } = galleryDocument(sheet);
    const make = (supports: Record<string, string>, policy: 1 | 2) => buildAdaptationContext({ profile: { schema_version: 1, supports, limits: {}, allowances: {} } as never, education: { stage: "primaria", grade: "3-primaria", subject: "conocimiento-medio" }, analysis, adaptationType: "accessibility", policy }).context.presentation;
    expect(make({ fine_motor_demand: "medium" }, 2).answer_space).toBe("roomy");
    expect(make({ fine_motor_demand: "medium" }, 1).answer_space).toBeUndefined();
    expect(make({}, 2)).not.toHaveProperty("answer_space");
  });

  it("el motor lee las necesidades del contexto (planificación, pasos), nunca etiquetas diagnósticas", () => {
    const sheet = GALLERY.find((g) => g.id === "mat6-operaciones-problemas")!;
    const { analysis, context } = galleryDocument(sheet);
    const space = spaceContextOf(analysis, context);
    expect(space.needs.get("working_memory_support")).toBe("high");
    expect(space.year).toBe(6);
    expect(space.mathematical).toBe(true);
  });
});

describe("compatibilidad: contrato versionado y documentos guardados", () => {
  it(`${ANSWER_SPACE_VERSION}: un documento anterior (cuadrícula sin filas, campos sin unidad) sigue siendo válido y se imprime`, () => {
    const old = {
      schema_version: 1, meta: { title: "Ficha", language: "es", stage: "primaria", grade: "4-primaria", subject: "matematicas", topic: null },
      presentation: { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "standard", max_tasks_per_page: null, color_independent: false, text_alternatives_for_visuals: false },
      admin_fields: [], answer_key: [],
      pages: [{ blocks: [
        { id: "blk_aaaa1", type: "activity", label: "1", prompt: "Calcula.", response: { kind: "grid" }, trace: { origin: "original", source_refs: ["act_1"], decision_ids: [] } },
        { id: "blk_aaaa2", type: "activity", label: "2", prompt: "Resuelve.", response: { kind: "fields", fields: [{ label: "Operaciones y unidades", space: "box", lines: 5 }, { label: "Respuesta", space: "lines", lines: 2 }] }, trace: { origin: "original", source_refs: ["act_2"], decision_ids: [] } },
      ] }],
    };
    const doc = MaterialDocumentSchema.parse(old);
    const { model, validation } = buildRenderModel(doc, { mode: "student", deferred: [] });
    expect(validation.status).not.toBe("not_renderable");
    const out = renderToStaticMarkup(createElement(MaterialSheet, { model }));
    expect(out).toContain("ms-grid-area");
    expect(out).toContain("ms-answer-field-box");
    expect(out).not.toContain("ms-unit");
  });

  it("lo que puede escribir un modelo no cambia: la cuadrícula del borrador no admite filas ni el campo `grid`", () => {
    const draft = DraftBlockSchema.parse({ id: "x1", type: "activity", prompt: "Calcula.", response: { kind: "grid", rows: 12 }, trace: { origin: "adapted", source_refs: [], decision_ids: [] } });
    expect(draft.type === "activity" && draft.response).toEqual({ kind: "grid" });
    expect(DraftBlockSchema.safeParse({ id: "x2", type: "activity", prompt: "a", response: { kind: "fields", fields: [] }, trace: { origin: "adapted", source_refs: [], decision_ids: [] } }).success).toBe(false);
  });

  it("la cabecera nombra la materia por su nombre, nunca por su clave", () => {
    expect(subjectName("matematicas")).toBeNull();
    expect(subjectName("conocimiento-medio")).toBeNull();
    expect(subjectName("Matemáticas")).toBe("Matemáticas");
  });
});
