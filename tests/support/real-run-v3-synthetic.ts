import { buildAdaptationContext } from "@/lib/adaptation/context";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { normalizePlan } from "@/lib/adaptation/plan";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { GeneratedSegments } from "@/lib/schemas/ai-contracts";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";

/**
 * SYNTHETIC equivalents of the eight sheets of the real run v3 («Hacer magia» 2.0). The real sheets and their results stay outside
 * Git (private originals, SHA-256 verified apart); these are our own texts with the SAME structure that broke there: a story with
 * paragraphs and dialogue plus a four-item ordering (04), numbered sentences with Sujeto/Predicado (05), Operaciones y unidades /
 * Respuesta (02), labelled parts A–D of a plant (06), numbered arrows of the water cycle (07), a coordinate map with Escuela/Hospital/Mercado fields (08), an L-shaped figure with measures (03). They are NOT real results and are never
 * presented as such.
 */

type DraftActivity = { id: string; label: string; type: string; instruction: string; context?: string; response: string; answer_area: string; answer_lines?: number; resources?: string[]; answer?: { basis: "source" | "inferred"; value: string } };
type DraftText = { id: string; kind: "reading_text" | "instruction" | "heading" | "other"; text: string };
type DraftVisual = { id: string; kind: string; role: "required" | "informative"; description: string };

function analysisOf(title: string, stage: "primaria" | "eso", grade: string, subject: string, activities: DraftActivity[], texts: DraftText[] = [], visuals: DraftVisual[] = []): MaterialAnalysis {
  const draft = MaterialAnalysisDraftSchema.parse({
    identification: { title, language: "es", stage, grade, subject, topic: title, confidence: { stage: 0.9, grade: 0.9, subject: 0.9, topic: 0.9 } },
    intent: { purpose: `Trabajar ${title.toLowerCase()}.`, objectives: [{ id: "o1", text: `Trabajar ${title.toLowerCase()}` }], knowledge: [], prerequisites: [], difficulty: "medium" },
    sections: [],
    texts: texts.map((t) => ({ ...t, page: 1 })),
    visuals: visuals.map((v) => ({ ...v, page: 1 })),
    admin: [{ type: "student_name", label: "Nombre", page: 1 }],
    activities: activities.map((a) => ({ page: 1, objectives: ["o1"], difficulty: "medium", confidence: 0.9, resources: [], ...a })),
    protected: [],
    uncertainties: [],
    quality: { confidence: 0.9, readability: "good" },
  });
  return normalizeAnalysis(draft, { pageCount: 1 }).analysis;
}

export interface SyntheticSheet {
  id: string;
  /** What broke in the real run (docs/QA_HACER_MAGIA_2.md), in one line. */
  realDefect: string;
  analysis: MaterialAnalysis;
}

export const SYNTHETIC_SHEETS: SyntheticSheet[] = [
  {
    id: "01-fracciones",
    realDefect: "generator_validation tras una única generación",
    analysis: analysisOf("Fracciones del mismo denominador", "primaria", "4-primaria", "Matemáticas", [
      { id: "a1", label: "1", type: "calculation", instruction: "Calcula 3/7 + 2/7 y simplifica si se puede.", response: "calculate", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "5/7" } },
      { id: "a2", label: "2", type: "problem_solving", instruction: "Luis come 2/6 de una tarta y Ana 3/6. ¿Qué fracción de tarta han comido entre los dos?", response: "write_text", answer_area: "lines", answer_lines: 3 },
    ]),
  },
  {
    id: "02-problemas",
    realDefect: "se perdieron «Operaciones y unidades» y «Respuesta»; apoyos duplicados",
    analysis: analysisOf("Problemas de medida", "primaria", "5-primaria", "Matemáticas", [
      { id: "a1", label: "1", type: "problem_solving", instruction: "Una botella tiene 750 ml de zumo. Se sirven 3 vasos de 200 ml. ¿Cuánto zumo queda?", context: "Operaciones y unidades:\nRespuesta:", response: "calculate", answer_area: "box" },
      { id: "a2", label: "2", type: "problem_solving", instruction: "Un tren recorre 84 km en 2 horas. ¿Cuántos km recorre en una hora?", context: "Operaciones y unidades:\nRespuesta:", response: "calculate", answer_area: "box" },
    ]),
  },
  {
    id: "03-geometria",
    realDefect: "figura geométrica (forma en L con medidas) no reconstruida",
    analysis: analysisOf("Perímetros", "primaria", "6-primaria", "Matemáticas", [
      { id: "a1", label: "1", type: "calculation", instruction: "Calcula el perímetro de la figura en forma de L. Usa las medidas del dibujo.", response: "calculate", answer_area: "lines", answer_lines: 3, resources: ["v1"] },
    ], [], [{ id: "v1", kind: "geometric_figure", role: "required", description: "Figura en forma de L con seis lados acotados en centímetros." }]),
  },
  {
    id: "04-lectura",
    realDefect: "párrafos y segmentación perdidos, elementos de ordenación juntos, «01» partido",
    analysis: analysisOf("La excursión al río", "primaria", "3-primaria", "Lengua", [
      { id: "a1", label: "1", type: "sequencing", instruction: "Ordena del 1 al 4 lo que pasó en la excursión.", context: "Comieron junto al puente.\nSubieron al autobús.\nVieron una garza en la orilla.\nVolvieron cantando al colegio.", response: "order", answer_area: "box" },
      { id: "a2", label: "2", type: "open_question", instruction: "¿Por qué crees que Marta quería volver al río? Explícalo.", response: "write_text", answer_area: "lines", answer_lines: 3 },
    ], [
      { id: "t1", kind: "reading_text", text: "El jueves la clase de Marta fue de excursión al río.\nEl autobús salió temprano y todos iban nerviosos.\n—¿Veremos peces? —preguntó Hugo.\n—Si no hacemos ruido, puede que sí —respondió la maestra.\nAl llegar, Marta vio una garza que pescaba entre las piedras." },
    ]),
  },
  {
    id: "05-oraciones",
    realDefect: "tres oraciones unidas, campos Sujeto/Predicado perdidos, definiciones que revelaban lo evaluado",
    analysis: analysisOf("Sujeto y predicado", "primaria", "5-primaria", "Lengua", [
      { id: "a1", label: "1", type: "short_answer", instruction: "Separa el sujeto y el predicado de cada oración.", context: "1. Los niños juegan en el parque.\n2. Mi abuela prepara una sopa.\n3. El perro de Laura duerme en el sofá.\nSujeto:\nPredicado:", response: "write_text", answer_area: "lines" },
      { id: "a2", label: "2", type: "classification", instruction: "Clasifica cada palabra como sustantivo, adjetivo o verbo: casa, rápido, saltar, azul.", response: "write_text", answer_area: "lines", answer_lines: 2 },
    ]),
  },
  {
    id: "06-planta",
    realDefect: "bloqueada por ilustraciones IA desactivadas con un mensaje que culpaba al plan",
    analysis: analysisOf("Las partes de la planta", "primaria", "3-primaria", "Ciencias de la Naturaleza", [
      { id: "a1", label: "1", type: "short_answer", instruction: "Observa el dibujo. Escribe qué parte de la planta indica cada letra.\nA:\nB:\nC:\nD:", response: "write_text", answer_area: "lines", resources: ["v1"] },
    ], [], [{ id: "v1", kind: "diagram", role: "required", description: "Dibujo de una planta con cuatro partes señaladas con las letras A, B, C y D." }]),
  },
  {
    id: "07-ciclo-agua",
    realDefect: "bloqueada por ilustraciones IA desactivadas con un mensaje que culpaba al plan",
    analysis: analysisOf("El ciclo del agua", "primaria", "4-primaria", "Ciencias de la Naturaleza", [
      { id: "a1", label: "1", type: "short_answer", instruction: "Observa el esquema. Escribe qué ocurre en cada flecha numerada del 1 al 4.", response: "write_text", answer_area: "lines", answer_lines: 4, resources: ["v1"] },
    ], [], [{ id: "v1", kind: "diagram", role: "required", description: "Esquema del ciclo del agua con cuatro flechas numeradas." }]),
  },
  {
    id: "08-plano",
    realDefect: "tres generaciones rechazadas por los mismos fallos",
    analysis: analysisOf("El plano del barrio", "primaria", "5-primaria", "Ciencias Sociales", [
      { id: "a1", label: "1", type: "short_answer", instruction: "Busca cada lugar en el plano y escribe sus coordenadas.", context: "Escuela: ____ Hospital: ____ Mercado: ____", response: "write_text", answer_area: "lines", resources: ["v1"] },
    ], [], [{ id: "v1", kind: "diagram", role: "required", description: "Plano con una cuadrícula de columnas A a F y filas 1 a 5." }]),
  },
];

export const sheet = (id: string) => SYNTHETIC_SHEETS.find((s) => s.id === id)!;

export function contextOf(analysis: MaterialAnalysis): AdaptationContext {
  return buildAdaptationContext({ profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: analysis.identification.stage.value === "eso" ? "eso" : "primaria", grade: analysis.identification.grade.value ?? "4-primaria", subject: "matematicas" }, analysis, adaptationType: "accessibility", policy: 2 }).context;
}

export const emptyPlan = (analysis: MaterialAnalysis, context: AdaptationContext): AdaptationPlan => normalizePlan({ decisions: [], summary: [] }, analysis, context);

export function documentOf(s: SyntheticSheet, plan?: AdaptationPlan, generated?: GeneratedSegments): MaterialDocument {
  const context = contextOf(s.analysis);
  return buildDocument({ analysis: s.analysis, plan: plan ?? emptyPlan(s.analysis, context), context, generated: generated ?? null, newBlockId: sequentialIds(s.id.slice(0, 2)) });
}
