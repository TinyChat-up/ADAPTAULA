import { createHash } from "node:crypto";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { normalizePlan } from "@/lib/adaptation/plan";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { locateVisuals } from "@/lib/materials/visuals/auto/locate";
import { expectedMarks } from "@/lib/materials/visuals/auto/marks";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { pixelRect, withMargin } from "@/lib/materials/visuals/geometry";
import { cropPng, renderPage } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { buildRenderModel, type AssetSource, type RenderModel } from "@/lib/render/model";
import { assetRef, type PinnedAsset } from "@/lib/render/print/pinned-assets";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis, type MaterialAnalysisDraftInput } from "@/lib/schemas/material-analysis";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { USERS, VISUALS, activities as figureActivities, arrowsSheet, lettersSheet, polygonSheet, LETTERS_INSTRUCTION, ARROWS_INSTRUCTION, POLYGON_INSTRUCTION } from "./marked-figures";

/**
 * The editorial gallery of Fase B (docs/EDITORIAL.md): eight sheets of different subjects and grades, OUR OWN texts (not the real
 * sheets), each with the answer demand its subject needs and a functional profile, assembled by the product without any model
 * (the deterministic document: what CLARO prints before any generated support). Same identity, different answer spaces.
 * The three figures are cropped from our synthetic original sheets (tests/support/marked-figures.ts) with the person's recipe.
 */

type Draft = MaterialAnalysisDraftInput;
type DraftActivity = Draft["activities"][number];
const profile = (supports: FunctionalProfile["supports"], limits: FunctionalProfile["limits"] = {}): FunctionalProfile => ({ schema_version: 1, supports, limits, allowances: {} });

interface SheetInput {
  title: string;
  grade: string;
  subject: string;
  subjectName: string;
  activities: Array<Partial<DraftActivity> & Pick<DraftActivity, "id" | "type" | "instruction" | "response" | "answer_area">>;
  texts?: Draft["texts"];
  visuals?: Draft["visuals"];
  protected?: Draft["protected"];
}

function analysisOf(s: SheetInput): MaterialAnalysis {
  const draft = MaterialAnalysisDraftSchema.parse({
    identification: { title: s.title, language: "es", stage: "primaria", grade: s.grade, subject: s.subjectName, topic: s.title, confidence: { stage: 0.9, grade: 0.9, subject: 0.9, topic: 0.9 } },
    intent: { purpose: `Trabajar ${s.title.toLowerCase()}.`, objectives: [{ id: "o1", text: s.title }], knowledge: [], prerequisites: [], difficulty: "medium" },
    sections: [],
    texts: s.texts ?? [],
    visuals: s.visuals ?? [],
    admin: [{ type: "student_name", label: "Nombre", page: 1 }, { type: "date", label: "Fecha", page: 1 }],
    activities: s.activities.map((a, i) => ({ label: String(i + 1), page: 1, objectives: ["o1"], difficulty: "medium", confidence: 0.9, resources: [], ...a })),
    protected: s.protected ?? [],
    uncertainties: [],
    quality: { confidence: 0.9, readability: "good" },
  });
  return normalizeAnalysis(draft, { pageCount: 1 }).analysis;
}

export type FigureKind = "polygon" | "letters" | "arrows";

export interface GallerySheet {
  id: string;
  label: string;
  /** The answer demand this sheet exercises, for the report. */
  demand: string;
  input: SheetInput;
  profile: FunctionalProfile;
  profileLabel: string;
  /** Figures cropped from our synthetic originals, by visual id. */
  figures?: Record<string, FigureKind>;
}

const fig = (id: string, kind: FigureKind): NonNullable<Draft["visuals"]>[number] => ({ id, kind: kind === "polygon" ? "geometric_figure" : "diagram", page: 1, role: "required", ...(VISUALS[kind].title ? { title: VISUALS[kind].title! } : {}), description: VISUALS[kind].description });

export const GALLERY: GallerySheet[] = [
  {
    id: "mat3-operaciones",
    label: "Matemáticas 3.º · operaciones",
    demand: "operaciones en columna con llevadas: cuadrícula por operación",
    profile: profile({}),
    profileLabel: "sin necesidades registradas",
    input: {
      title: "Sumamos y restamos con llevadas",
      grade: "3-primaria",
      subject: "matematicas",
      subjectName: "Matemáticas",
      texts: [{ id: "t1", kind: "instruction", page: 1, text: "Coloca bien las cifras: unidades debajo de unidades, decenas debajo de decenas." }],
      activities: [
        { id: "a1", type: "calculation", instruction: "Calcula en columna: 347 + 285", response: "calculate", answer_area: "grid" },
        { id: "a2", type: "calculation", instruction: "Calcula en columna: 602 − 178", response: "calculate", answer_area: "grid" },
        { id: "a3", type: "calculation", instruction: "Calcula: 36 × 4 y 125 + 98 + 47", response: "calculate", answer_area: "lines", answer_lines: 2 },
        { id: "a4", type: "short_answer", instruction: "¿Qué número va justo después de 499?", response: "write_number", answer_area: "line", answer_lines: 1 },
      ],
      protected: [{ type: "target_operation", importance: "essential", value: "Suma y resta con llevadas en columna", activities: ["a1", "a2", "a3"] }],
    },
  },
  {
    id: "mat4-problemas",
    label: "Matemáticas 4.º · problemas de varios pasos",
    demand: "problemas: datos, operaciones en cuadrícula y respuesta con hueco para la unidad",
    profile: profile({ planning_support: "medium", operation_steps: "medium" }),
    profileLabel: "planificación y pasos de las operaciones (medio)",
    input: {
      title: "Problemas de la excursión",
      grade: "4-primaria",
      subject: "matematicas",
      subjectName: "Matemáticas",
      activities: [
        { id: "a1", type: "problem_solving", instruction: "Para la excursión se compran 6 paquetes de 12 bocadillos. Se comen 58. ¿Cuántos bocadillos sobran?", response: "calculate", answer_area: "box" },
        { id: "a2", type: "problem_solving", instruction: "El autobús recorre 145 km a la ida y 138 km a la vuelta. ¿Cuántos kilómetros recorre en total?", response: "calculate", answer_area: "lines", answer_lines: 2 },
        { id: "a3", type: "problem_solving", instruction: "Una botella tiene 750 ml de agua. Cada alumno bebe 150 ml. ¿Para cuántos alumnos llega la botella?", context: "Operaciones y unidades:\nRespuesta:", response: "calculate", answer_area: "box" },
      ],
      protected: [{ type: "units_or_magnitudes", importance: "essential", value: "Kilómetros y mililitros", activities: ["a2", "a3"] }],
    },
  },
  {
    id: "mat5-geometria",
    label: "Matemáticas 5.º · geometría",
    demand: "perímetro y área con cuadrícula; la comparación ve la figura otra vez",
    profile: profile({ number_of_visible_tasks: "high" }),
    profileLabel: "pocas tareas por página (alto)",
    figures: { v1: "polygon" },
    input: {
      title: "Perímetros y áreas",
      grade: "5-primaria",
      subject: "matematicas",
      subjectName: "Matemáticas",
      visuals: [fig("v1", "polygon")],
      activities: [
        { id: "a1", type: "calculation", instruction: POLYGON_INSTRUCTION, response: "write_number", answer_area: "lines", answer_lines: 2, resources: ["v1"] },
        { id: "a2", type: "calculation", instruction: "Calcula el perímetro y el área de la figura. Muestra cómo la has dividido.", response: "calculate", answer_area: "lines", answer_lines: 2, resources: ["v1"], difficulty: "high" },
        { id: "a3", type: "open_question", instruction: "¿Por qué el área se mide en centímetros cuadrados? Explícalo con tus palabras.", response: "write_text", answer_area: "lines", answer_lines: 2 },
        { id: "a4", type: "problem_solving", instruction: "Compara la figura con un cuadrado de 6 cm de lado: ¿cuál tiene más área y cuánto más?", response: "write_text", answer_area: "lines", answer_lines: 2, resources: ["v1"] },
      ],
      protected: [
        { type: "target_operation", importance: "essential", value: "Perímetro y área de una figura compuesta", activities: ["a2", "a4"] },
        { type: "units_or_magnitudes", importance: "essential", value: "Centímetros y centímetros cuadrados", activities: ["a2"] },
        { type: "response_constraint", importance: "important", value: "Mostrar cómo se divide la figura", activities: ["a2"] },
      ],
    },
  },
  {
    id: "len3-comprension",
    label: "Lengua 3.º · comprensión lectora",
    demand: "lectura con párrafos, respuestas proporcionales y una casilla por elemento al ordenar",
    profile: profile({ decoding_support: "medium", font_size: "medium" }),
    profileLabel: "decodificación y tamaño de letra (medio)",
    input: {
      title: "El huerto del colegio",
      grade: "3-primaria",
      subject: "lengua-castellana",
      subjectName: "Lengua Castellana y Literatura",
      texts: [{ id: "t1", kind: "reading_text", page: 1, text: "El lunes, la clase de Marta preparó el huerto del colegio. Primero quitaron las piedras de la tierra.\n\nDespués plantaron lechugas y tomates en filas rectas. Marta regaba cada mañana con una regadera verde.\n\n—¿Cuándo saldrán los tomates? —preguntó Leo.\n—Si los cuidamos, en verano —respondió la maestra." }],
      activities: [
        { id: "a1", type: "reading_comprehension", instruction: "¿Qué plantaron en el huerto?", response: "write_text", answer_area: "line", answer_lines: 1, resources: ["t1"] },
        { id: "a2", type: "sequencing", instruction: "Ordena lo que pasó del 1 al 3.", context: "Plantaron lechugas y tomates.\nQuitaron las piedras.\nMarta regaba cada mañana.", response: "order", answer_area: "other" },
        { id: "a3", type: "open_question", instruction: "¿Por qué crees que Marta regaba cada mañana? Explica tu respuesta.", response: "write_text", answer_area: "lines", answer_lines: 2 },
      ],
    },
  },
  {
    id: "len5-gramatica",
    label: "Lengua 5.º · gramática",
    demand: "oraciones numeradas, campos de sujeto y predicado, tabla para clasificar y redacción",
    profile: profile({}),
    profileLabel: "sin necesidades registradas",
    input: {
      title: "Sujeto, predicado y clases de palabras",
      grade: "5-primaria",
      subject: "lengua-castellana",
      subjectName: "Lengua Castellana y Literatura",
      visuals: [{ id: "v1", kind: "table", page: 1, role: "required", title: "Clasifica las palabras", description: "Tabla con tres columnas vacías para clasificar palabras.", table: { headers: ["Sustantivos", "Adjetivos", "Verbos"], rows: [["", "", ""], ["", "", ""], ["", "", ""]] } }],
      activities: [
        { id: "a1", type: "short_answer", instruction: "Separa el sujeto y el predicado de cada oración.", context: "1. Los alumnos de quinto visitaron el museo.\n2. Mi hermana pequeña dibuja un castillo.\nSujeto:\nPredicado:", response: "write_text", answer_area: "lines", answer_lines: 2 },
        { id: "a2", type: "classification", instruction: "Clasifica estas palabras en la tabla: río, alegre, saltar, mesa, rápido, escribir.", response: "write_text", answer_area: "table_cells", resources: ["v1"] },
        { id: "a3", type: "writing", instruction: "Escribe un texto de 60-80 palabras sobre tu lugar favorito. Usa al menos tres adjetivos.", response: "write_text", answer_area: "lines", answer_lines: 5 },
      ],
    },
  },
  {
    id: "cn3-esquema",
    label: "Ciencias Naturales 3.º · esquema etiquetado",
    demand: "cuatro campos A–D junto al dibujo, explicaciones y un espacio para dibujar",
    profile: profile({ fine_motor_demand: "medium" }),
    profileLabel: "menor exigencia de motricidad fina (medio): renglones y casillas más amplios",
    figures: { v1: "letters" },
    input: {
      title: "Las partes de la planta",
      grade: "3-primaria",
      subject: "conocimiento-medio",
      subjectName: "Conocimiento del Medio Natural, Social y Cultural",
      visuals: [fig("v1", "letters")],
      activities: [
        { id: "a1", type: "short_answer", instruction: LETTERS_INSTRUCTION, context: "A:, B:, C:, D:", response: "write_text", answer_area: "box", resources: ["v1"] },
        { id: "a2", type: "open_question", instruction: "¿Qué parte absorbe el agua? Explica por qué es importante.", response: "write_text", answer_area: "lines", answer_lines: 2, resources: ["v1"] },
        { id: "a3", type: "drawing", instruction: "Dibuja una planta de tu casa y señala la raíz y el tallo.", response: "draw", answer_area: "box" },
      ],
    },
  },
  {
    id: "cs4-tablas",
    label: "Ciencias Sociales 4.º · tablas y explicaciones",
    demand: "tabla con celdas utilizables y espacio para comparar y explicar",
    profile: profile({ visual_density: "medium" }),
    profileLabel: "menos densidad visual (medio)",
    input: {
      title: "Pueblos y ciudades",
      grade: "4-primaria",
      subject: "conocimiento-medio",
      subjectName: "Conocimiento del Medio Natural, Social y Cultural",
      texts: [{ id: "t1", kind: "reading_text", page: 1, text: "En un pueblo viven pocas personas y muchas trabajan en el campo. En una ciudad viven muchas personas y hay más tiendas, hospitales y transporte público." }],
      visuals: [{ id: "v1", kind: "table", page: 1, role: "required", title: "Pueblo y ciudad", description: "Tabla para comparar un pueblo y una ciudad.", table: { headers: ["", "Pueblo", "Ciudad"], rows: [["Habitantes", "", ""], ["Trabajos", "", ""], ["Transporte", "", ""]] } }],
      activities: [
        { id: "a1", type: "table_completion", instruction: "Completa la tabla con la información del texto.", response: "write_text", answer_area: "table_cells", resources: ["v1", "t1"] },
        { id: "a2", type: "open_question", instruction: "¿Dónde preferirías vivir, en un pueblo o en una ciudad? ¿Por qué?", response: "write_text", answer_area: "lines", answer_lines: 2 },
        { id: "a3", type: "short_answer", instruction: "Escribe dos servicios que tiene una ciudad.", response: "write_text", answer_area: "lines", answer_lines: 1 },
      ],
    },
  },
  {
    id: "mat6-operaciones-problemas",
    label: "Matemáticas 6.º · operaciones y problemas",
    demand: "divisiones y decimales con cuadrícula amplia; problema con datos organizados",
    profile: profile({ working_memory_support: "high", operation_steps: "medium" }),
    profileLabel: "memoria de trabajo (alto) y pasos de las operaciones (medio)",
    input: {
      title: "Decimales, divisiones y un problema",
      grade: "6-primaria",
      subject: "matematicas",
      subjectName: "Matemáticas",
      activities: [
        { id: "a1", type: "calculation", instruction: "Divide: 7.452 : 36", response: "calculate", answer_area: "grid" },
        { id: "a2", type: "calculation", instruction: "Calcula: 12,75 + 8,6 − 3,48", response: "calculate", answer_area: "lines", answer_lines: 2 },
        { id: "a3", type: "calculation", instruction: "Calcula 3/4 + 2/3 y simplifica el resultado.", response: "calculate", answer_area: "lines", answer_lines: 2 },
        { id: "a4", type: "problem_solving", instruction: "Una tienda vende cuadernos a 2,35 € cada uno. Laura compra 4 cuadernos y paga con un billete de 20 €. ¿Cuánto dinero le devuelven?", response: "calculate", answer_area: "lines", answer_lines: 2, difficulty: "high" },
      ],
      protected: [{ type: "target_operation", importance: "essential", value: "División y operaciones con decimales", activities: ["a1", "a2", "a4"] }],
    },
  },
];

export function galleryAnalysis(s: GallerySheet): MaterialAnalysis {
  return analysisOf(s.input);
}

export function galleryContext(s: GallerySheet, analysis = galleryAnalysis(s)): AdaptationContext {
  return buildAdaptationContext({ profile: s.profile, education: { stage: "primaria", grade: s.input.grade, subject: s.input.subject }, analysis, adaptationType: "accessibility", policy: 2 }).context;
}

/** The deterministic document the product assembles for this sheet and profile (no plan decisions, no model). */
export function galleryDocument(s: GallerySheet): { analysis: MaterialAnalysis; context: AdaptationContext; document: MaterialDocument } {
  const analysis = galleryAnalysis(s);
  const context = galleryContext(s, analysis);
  const document = buildDocument({ analysis, plan: normalizePlan({ decisions: [], summary: [] }, analysis, context), context, generated: null, newBlockId: sequentialIds("g") });
  return { analysis, context, document };
}

const SHEETS: Record<FigureKind, { pdf: () => Promise<Uint8Array>; instruction: string }> = {
  polygon: { pdf: () => polygonSheet(), instruction: POLYGON_INSTRUCTION },
  letters: { pdf: () => lettersSheet(), instruction: LETTERS_INSTRUCTION },
  arrows: { pdf: () => arrowsSheet(), instruction: ARROWS_INSTRUCTION },
};

/** The crop of one of our synthetic original figures, located automatically and cut with the person's recipe (no redrawing). */
export async function figureCrop(kind: FigureKind, n: number): Promise<{ source: AssetSource; pin: PinnedAsset }> {
  const bytes = await SHEETS[kind].pdf();
  const model = (await readPage(bytes, "application/pdf", 1, 100)).model;
  const [located] = locateVisuals(model, [{ id: "vis_1", shape: "figure", activityIds: ["act_1"], marks: expectedMarks(VISUALS[kind], USERS[kind] as never) }], figureActivities(SHEETS[kind].instruction));
  if (!located?.bounds) throw new Error(`La figura sintética ${kind} no se localiza`);
  const page = await renderPage(bytes, "application/pdf", 1, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
  const surface = page.box.kind === "pdf" ? { width: page.box.width_pt, height: page.box.height_pt } : { width: page.width, height: page.height };
  const crop = await cropPng(page, pixelRect(withMargin(located.bounds, surface, VISUAL_CROP_RECIPE.margin), page.width, page.height));
  const png = new Uint8Array(crop.png);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const assetId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const mm = (px: number) => Math.round(((px * 25.4) / VISUAL_CROP_RECIPE.dpi) * 10) / 10;
  return { source: { src: assetRef({ assetId, sha256 }), widthMm: mm(crop.width), heightMm: mm(crop.height) }, pin: { assetId, sha256, mime: "image/png", bytes: png } };
}

/** The render model of a gallery sheet, with its figures resolved to their crops (as the product does with a ready visual). */
export async function galleryModel(s: GallerySheet, design: "claro" | "standard" = "claro"): Promise<{ model: RenderModel; pins: PinnedAsset[]; document: MaterialDocument; analysis: MaterialAnalysis; issues: string[] }> {
  const { analysis, document } = galleryDocument(s);
  const assets: Record<string, AssetSource> = {};
  const pins: PinnedAsset[] = [];
  let n = 0;
  for (const [local, kind] of Object.entries(s.figures ?? {})) {
    const visual = analysis.visuals[Number(local.slice(1)) - 1];
    if (!visual) continue;
    const { source, pin } = await figureCrop(kind, ++n);
    assets[visual.id] = source;
    pins.push(pin);
  }
  const required = analysis.visuals.filter((v) => v.role === "required" && !v.table).map((v) => v.id);
  const { model, validation } = buildRenderModel(document, { mode: "student", design, deferred: [], assets, requiredVisuals: required, subjectLabel: s.input.subjectName });
  return { model, pins, document, analysis, issues: validation.issues.filter((i) => i.severity === "error").map((i) => i.message) };
}
