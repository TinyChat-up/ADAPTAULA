import { readFileSync } from "node:fs";
import path from "node:path";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { normalizePlan } from "@/lib/adaptation/plan";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, DraftAdaptationPlan } from "@/lib/schemas/adaptation-plan";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis, type MaterialAnalysisDraftInput } from "@/lib/schemas/material-analysis";
import { PLAN_REVIEW_SCHEMA_VERSION, type PlanReview } from "@/lib/schemas/plan-review";

/**
 * Fixtures of the generator eval. `mobilityAnalysis` has the structure of the Geografía worksheet validated in Fase 3 (one
 * table, two charts, six activities with the same kinds of demands) but other words and numbers: the real worksheet stays
 * private. `MOBILITY_PLAN_DRAFT` reproduces the SHAPE of what the real planner produced for it (8 decisions, same targets,
 * strategies and supports) so the offline tests exercise the same review. `evalReviewFor` is the human review of the experiment.
 */

const draft = (): MaterialAnalysisDraftInput => ({
  identification: { title: "Población, envejecimiento y movilidad en Villaverde", language: "es", stage: "eso", grade: "3-eso", subject: "Geografía e Historia", topic: "Demografía y movilidad urbana", confidence: { stage: 0.97, grade: 0.97, subject: 0.97, topic: 0.9 } },
  intent: {
    purpose: "Analizar el crecimiento de la población, su estructura por edades y los modos de desplazamiento a partir de una tabla y dos gráficos.",
    objectives: [
      { id: "o1", text: "Calcular el aumento absoluto y relativo de la población" },
      { id: "o2", text: "Interpretar la estructura por edades y justificar el envejecimiento" },
      { id: "o3", text: "Comparar modos de desplazamiento en puntos porcentuales" },
      { id: "o4", text: "Proponer consecuencias y medidas apoyadas en datos" },
      { id: "o5", text: "Redactar una conclusión que relacione población, edades y movilidad con datos" },
    ],
    knowledge: ["Crecimiento de la población", "Envejecimiento", "Puntos porcentuales", "Movilidad urbana"],
    prerequisites: ["Cálculo de porcentajes", "Lectura de gráficos de barras"],
    difficulty: "medium",
  },
  sections: [
    { id: "s1", title: "Documentos", page_start: 1, page_end: 1 },
    { id: "s2", title: "Actividades", page_start: 2, page_end: 2 },
  ],
  texts: [
    { id: "c1", kind: "reading_text", page: 1, text: "El ayuntamiento de Villaverde ha publicado estos datos para analizar los cambios demográficos y de movilidad. El municipio es ficticio, pero los datos siguen patrones plausibles de una ciudad española de tamaño medio." },
    { id: "c2", kind: "note", page: 1, text: "Nota: cada persona indica un único modo principal de desplazamiento. Los porcentajes suman 100 %." },
  ],
  visuals: [
    { id: "v1", kind: "table", page: 1, role: "required", title: "Documento 1. Evolución de la población", description: "", table: { headers: ["Año", "2010", "2015", "2020", "2025"], rows: [["Habitantes", "31.200", "33.500", "35.100", "37.900"]] } },
    { id: "v2", kind: "chart", page: 1, role: "required", title: "Documento 2. Estructura por edades en 2025", description: "Barras horizontales.", chart: { type: "bar", categories: ["0-14 años", "15-64 años", "65 años o más"], series: [{ name: "Población 2025", values: [12, 62, 26] }], unit: "%" } },
    { id: "v3", kind: "chart", page: 1, role: "required", title: "Documento 3. Desplazamiento principal al centro de estudio o trabajo (2025)", description: "Barras verticales.", chart: { type: "bar", categories: ["Coche", "Autobús", "A pie", "Metro/tranvía", "Bicicleta"], series: [{ name: "", values: [36, 24, 20, 8, 12] }], unit: "%" } },
  ],
  admin: [
    { type: "student_name", label: "Nombre y apellidos", page: 1 },
    { type: "date", label: "Fecha", page: 1 },
    { type: "student_name", label: "Nombre y apellidos", page: 2 },
    { type: "date", label: "Fecha", page: 2 },
  ],
  activities: [
    { id: "a1", label: "1", page: 2, section: "s2", type: "calculation", instruction: "Calcula cuánto aumentó la población entre 2010 y 2025, primero en habitantes y después en porcentaje aproximado respecto a 2010.", resources: ["v1"], objectives: ["o1"], response: "write_number", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "6.700 habitantes; aproximadamente un 21,5 % respecto a 2010" }, difficulty: "medium", confidence: 0.95 },
    { id: "a2", label: "2", page: 2, section: "s2", type: "open_question", instruction: "A partir del documento 2, explica por qué puede afirmarse que Villaverde presenta un envejecimiento demográfico. No basta con copiar un porcentaje.", resources: ["v2"], objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.93 },
    { id: "a3", label: "3", page: 2, section: "s2", type: "calculation", instruction: "Compara el uso del coche con el conjunto de modos de movilidad activa (a pie + bicicleta). ¿Qué diferencia hay en puntos porcentuales?", resources: ["v3"], objectives: ["o3"], response: "write_number", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "Coche 36 % frente a 32 % de movilidad activa (20 + 12): diferencia de 4 puntos porcentuales" }, difficulty: "medium", confidence: 0.95 },
    { id: "a4", label: "4", page: 2, section: "s2", type: "open_question", instruction: "Propón dos consecuencias que el envejecimiento de la población podría tener sobre los servicios municipales. Justifica cada una.", resources: ["v2"], objectives: ["o4"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.9 },
    { id: "a5", label: "5", page: 2, section: "s2", type: "problem_solving", instruction: "El ayuntamiento quiere reducir el uso del coche en 10 puntos porcentuales sin reducir el número total de desplazamientos. Propón una medida concreta y explica qué dato de los documentos apoya tu propuesta.", resources: ["v3"], objectives: ["o3", "o4"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "high", confidence: 0.9 },
    { id: "a6", label: "6", page: 2, section: "s2", type: "writing", instruction: "Redacta una conclusión de 4-5 líneas que relacione crecimiento de población, estructura por edades y movilidad. Debe utilizar al menos dos datos numéricos de los documentos.", resources: ["v1", "v2", "v3"], objectives: ["o5"], response: "write_text", answer_area: "lines", answer_lines: 4, difficulty: "high", confidence: 0.92 },
  ],
  protected: [
    { type: "target_operation", importance: "essential", value: "Calcular aumento en habitantes y después en porcentaje aproximado respecto a 2010", activities: ["a1"], resources: ["v1"] },
    { type: "reasoning_constraint", importance: "essential", value: "No basta con copiar un porcentaje; explicar el envejecimiento", activities: ["a2"], resources: ["v2"] },
    { type: "target_operation", importance: "essential", value: "Comparar coche con movilidad activa (a pie + bicicleta) en puntos porcentuales", activities: ["a3"], resources: ["v3"] },
    { type: "response_constraint", importance: "essential", value: "Dos consecuencias, cada una justificada", activities: ["a4"], resources: [] },
    { type: "reasoning_constraint", importance: "essential", value: "Reducir coche 10 puntos porcentuales sin reducir el total de desplazamientos", activities: ["a5"], resources: ["v3"] },
    { type: "response_constraint", importance: "essential", value: "Medida concreta y dato de los documentos que la apoye", activities: ["a5"], resources: [] },
    { type: "response_constraint", importance: "essential", value: "Conclusión de 4-5 líneas con al menos dos datos numéricos", activities: ["a6"], resources: [] },
    { type: "concept", importance: "essential", value: "Relacionar crecimiento de población, estructura por edades y movilidad", activities: ["a6"], resources: [] },
    { type: "necessary_visual", importance: "essential", value: "Documentos 1, 2 y 3 (tabla y gráficos con sus datos)", activities: [], resources: ["v1", "v2", "v3"] },
    { type: "required_data", importance: "important", value: "Cada persona indica un único modo principal; los porcentajes suman 100 %", activities: ["a3", "a5"], resources: ["c2"] },
    { type: "units_or_magnitudes", importance: "important", value: "Distinción entre porcentaje y puntos porcentuales", activities: ["a3", "a5"], resources: [] },
  ],
  uncertainties: [],
  quality: { confidence: 0.93, readability: "good" },
});

export function mobilityAnalysis(): MaterialAnalysis {
  return normalizeAnalysis(MaterialAnalysisDraftSchema.parse(draft()), { pageCount: 2 }).analysis;
}

const support = (kind: string) => ({ kind, uses_task_data: false });
const decision = (d: Record<string, unknown>) => ({ strategies: [], dimensions: [], intensity: "moderate", preserves: [], supports: [], flags: [], ...d });

/** The eight decisions the real planner produced for the executive-function profile, as a draft (same shape, same targets). */
export const MOBILITY_PLAN_DRAFT = {
  decisions: [
    decision({ target: "document", action: "add_support", strategies: ["task_sequencing", "planning_support"], dimensions: ["predictable_structure", "explicit_expectations", "checklist_support"], supports: [support("checklist")], note: "Estructura fija por actividad: documento, qué hacer, dónde responder. Casilla de 'hecho' por actividad." }),
    decision({ target: "document", action: "reorganize", strategies: ["spatial_organization", "attention_focus"], dimensions: ["number_of_visible_tasks", "predictable_structure"], preserves: ["prt_9"], note: "Mostrar pocas actividades a la vez, cada una junto a su documento. Documentos 1-3 íntegros." }),
    decision({ target: "act_1", action: "segment", strategies: ["task_sequencing", "instruction_clarification"], dimensions: ["instruction_chunking", "operation_steps"], intensity: "substantial", preserves: ["prt_1", "prt_9"], supports: [support("step_list")], note: "Separar en dos pasos numerados: aumento en habitantes y luego porcentaje respecto a 2010. Sin resultados." }),
    decision({ target: "act_2", action: "segment", strategies: ["task_sequencing", "instruction_clarification"], dimensions: ["instruction_chunking", "working_memory_support"], intensity: "substantial", preserves: ["prt_2", "prt_9"], supports: [support("guiding_questions")], note: "Mantener la condición de no copiar un porcentaje. Preguntas guía genéricas, sin contenido de respuesta." }),
    decision({ target: "act_3", action: "segment", strategies: ["task_sequencing", "instruction_clarification"], dimensions: ["instruction_chunking", "working_memory_support"], intensity: "substantial", preserves: ["prt_3", "prt_10", "prt_11", "prt_9"], supports: [support("step_list"), support("reminder")], note: "Pasos: identificar valores, sumar los modos activos, comparar. Recordatorio sobre puntos porcentuales y nota de que los porcentajes suman 100 %." }),
    decision({ target: "act_4", action: "segment", strategies: ["task_sequencing", "instruction_clarification"], dimensions: ["instruction_chunking", "planning_support"], intensity: "substantial", preserves: ["prt_4", "prt_9"], supports: [support("planner")], note: "Planificador con dos bloques: consecuencia y justificación, para cada una. Vacío." }),
    decision({ target: "act_5", action: "segment", strategies: ["task_sequencing", "instruction_clarification"], dimensions: ["instruction_chunking", "planning_support", "working_memory_support"], intensity: "substantial", preserves: ["prt_5", "prt_6", "prt_10", "prt_11", "prt_9"], supports: [support("planner"), support("reminder")], note: "Separar condiciones: 10 puntos porcentuales, mismo total de desplazamientos, medida concreta, dato de apoyo." }),
    decision({ target: "act_6", action: "add_support", strategies: ["planning_support", "task_sequencing"], dimensions: ["planning_support", "checklist_support", "working_memory_support"], intensity: "substantial", preserves: ["prt_7", "prt_8", "prt_9"], supports: [support("planner"), support("checklist"), support("sentence_starters")], note: "Secuenciar planificar, redactar, revisar. El producto sigue siendo un único texto de 4-5 líneas con dos datos numéricos." }),
  ],
  summary: ["Estructura fija y repetida en cada actividad, con casilla de 'hecho'.", "Actividades 1-5 divididas en pasos numerados, conservando operaciones y condiciones.", "Actividad 6: proceso secuenciado, pero un único texto final con todos sus requisitos."],
} as unknown as DraftAdaptationPlan;

export function mobilityRawPlan(analysis: MaterialAnalysis, context: AdaptationContext): AdaptationPlan {
  return normalizePlan(MOBILITY_PLAN_DRAFT, analysis, context);
}

const EXPECTED_TARGETS: Record<string, string> = { dec_1: "document", dec_2: "document", dec_3: "act_1", dec_4: "act_2", dec_5: "act_3", dec_6: "act_4", dec_7: "act_5", dec_8: "act_6" };

/**
 * The human review of the experiment (docs/ADAPTATION.md): approve dec_1, dec_6, dec_7; approve dec_4 with restrictions;
 * edit dec_8 (remove `sentence_starters`); reject dec_2 (duplicates `presentation.max_tasks_per_page`), dec_3 (blocked by the
 * validator) and dec_5 (guides the maths procedure too much for this test). It refuses to apply to a plan whose decisions
 * are not the ones it was written for.
 */
export function evalReviewFor(plan: AdaptationPlan, reviewedAt = "2026-10-05T12:00:00Z"): PlanReview {
  for (const [id, target] of Object.entries(EXPECTED_TARGETS)) {
    if (plan.decisions.find((d) => d.id === id)?.target !== target) throw new Error(`La revisión del eval espera ${id} sobre ${target}.`);
  }
  return {
    schema_version: PLAN_REVIEW_SCHEMA_VERSION,
    plan_fingerprint: fingerprint(plan),
    reviewer: { kind: "eval", label: "eval-fixture" },
    reviewed_at: reviewedAt,
    entries: [
      { decision_id: "dec_1", action: "approved", reason: "Estructura y casilla de «hecho»: organiza y permite revisar sin tocar contenido." },
      { decision_id: "dec_2", action: "rejected", reason: "Duplica lo que ya resuelve presentation.max_tasks_per_page." },
      { decision_id: "dec_3", action: "rejected", reason: "Bloqueada por el validador: cita una dimensión que el perfil no tiene." },
      {
        decision_id: "dec_4",
        action: "approved",
        reason: "Segmentar y separar qué mirar y qué responder, con preguntas guía ejecutivas.",
        restrictions: ["No aportar la interpretación del gráfico.", "No sugerir la conclusión ni incluir una respuesta parcial.", "Las preguntas guía son ejecutivas (qué mirar, qué responder), nunca de contenido."],
      },
      { decision_id: "dec_5", action: "rejected", reason: "Guía demasiado el procedimiento matemático; contaminaría la prueba del generador." },
      { decision_id: "dec_6", action: "approved", reason: "Dos consecuencias, cada una con su justificación." },
      { decision_id: "dec_7", action: "approved", reason: "Separa condiciones y petición conservando las cuatro exigencias." },
      {
        decision_id: "dec_8",
        action: "edited",
        reason: "Sin inicios de frase: solo apoyos ejecutivos que no escriben contenido.",
        restrictions: ["No escribir tesis, argumentos ni la relación concreta que debe concluir.", "No escribir comienzos de frase.", "Sigue siendo una producción integrada de 4-5 líneas con al menos dos datos numéricos."],
        edits: { supports: [{ kind: "planner", uses_task_data: false }, { kind: "checklist", uses_task_data: false }] },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Bachillerato mirror: the structure of the real worksheet (three sections, the duplicated statement of activity 5 as ctt_3 and
// ctt_4, a textual inferred answer in activity 3) with other words. Used by the v1/v2 offline A/B and the ordering test.
// ---------------------------------------------------------------------------------------------------------------------

const BACH_TEXT = [
  "Durante años se anunció que las bibliotecas públicas desaparecerían con la llegada de internet. Si cualquier libro puede consultarse desde casa, ¿para qué desplazarse a un edificio lleno de estanterías? Sin embargo, las cifras de visitas en muchas ciudades no han dejado de crecer.",
  "Una biblioteca ya no es solo un almacén de libros. Es un lugar de estudio silencioso, un espacio con conexión gratuita y un punto de encuentro para clubes de lectura y talleres.",
  "No obstante, mantener ese papel exige algo más que conservar los fondos. Los horarios, la renovación de los espacios y la formación del personal determinan si una biblioteca sigue siendo útil.",
  "Por eso, la pregunta no es si las bibliotecas tienen sentido en la era digital, sino qué necesitan para garantizar que cualquier persona pueda acceder al conocimiento.",
].join("\n\n");

export function bachilleratoMirrorAnalysis(): MaterialAnalysis {
  const d: MaterialAnalysisDraftInput = {
    identification: { title: "Comprensión y argumentación: las bibliotecas públicas", language: "es", stage: "bachillerato", grade: "1-bachillerato", subject: "Lengua Castellana y Literatura", topic: "Texto argumentativo", confidence: { stage: 0.98, grade: 0.96, subject: 0.98, topic: 0.9 } },
    intent: {
      purpose: "Comprender un texto argumentativo y producir uno propio.",
      objectives: [
        { id: "o1", text: "Resumir un texto con palabras propias respetando una extensión" },
        { id: "o2", text: "Identificar la tesis y los argumentos de un texto" },
        { id: "o3", text: "Reconocer la función de un conector discursivo" },
        { id: "o4", text: "Determinar el registro y justificarlo" },
        { id: "o5", text: "Redactar un texto argumentativo con tesis, argumentos y conclusión" },
      ],
      knowledge: ["Resumen", "Tesis y argumentos", "Conectores", "Registro"],
      prerequisites: ["Comprensión lectora de textos argumentativos"],
      difficulty: "medium",
    },
    sections: [
      { id: "s1", title: "Texto", page_start: 1, page_end: 1 },
      { id: "s2", title: "Actividades de comprensión", page_start: 1, page_end: 2 },
      { id: "s3", title: "Escritura argumentativa", page_start: 2, page_end: 2 },
    ],
    texts: [
      { id: "c1", kind: "reading_text", page: 1, section: "s1", text: BACH_TEXT },
      { id: "c2", kind: "note", page: 1, section: "s1", text: "Texto elaborado para esta actividad." },
      { id: "c3", kind: "instruction", page: 2, section: "s3", text: "Redacta un texto argumentativo de 150-180 palabras sobre esta cuestión:" },
      { id: "c4", kind: "note", page: 2, section: "s3", text: "Extensión orientativa: 150-180 palabras. Escribe de forma legible y organiza el texto en párrafos." },
    ],
    visuals: [],
    admin: [
      { type: "student_name", label: "Nombre y apellidos", page: 1 },
      { type: "date", label: "Fecha", page: 1 },
    ],
    activities: [
      { id: "a1", label: "1", page: 1, section: "s2", type: "writing", instruction: "Resume el texto en 60-80 palabras, sin copiar frases completas.", resources: ["c1"], objectives: ["o1"], response: "write_text", answer_area: "lines", answer_lines: 2, difficulty: "medium", confidence: 0.95 },
      { id: "a2", label: "2", page: 1, section: "s2", type: "open_question", instruction: "Formula con tus palabras la tesis principal del texto y señala dos argumentos que la apoyen.", resources: ["c1"], objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 2, difficulty: "medium", confidence: 0.95 },
      { id: "a3", label: "3", page: 1, section: "s2", type: "short_answer", instruction: "Explica qué relación introduce el conector «No obstante» al inicio del tercer párrafo.", resources: ["c1"], objectives: ["o3"], response: "write_text", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "Una relación de oposición o contraste con lo expuesto en el párrafo anterior (adversativa)." }, difficulty: "low", confidence: 0.95 },
      { id: "a4", label: "4", page: 2, section: "s2", type: "short_answer", instruction: "Indica si predomina un registro formal o informal. Justifica la respuesta con dos rasgos lingüísticos del texto.", resources: ["c1"], objectives: ["o4"], response: "write_text", answer_area: "lines", answer_lines: 2, difficulty: "medium", confidence: 0.95 },
      { id: "a5", label: "5", page: 2, section: "s3", type: "writing", instruction: "Redacta un texto argumentativo de 150-180 palabras sobre esta cuestión: «¿Deberían las bibliotecas abrir también por la noche durante el verano?» Incluye una tesis, al menos dos argumentos y una conclusión.", resources: ["c3", "c4"], objectives: ["o5"], response: "write_text", answer_area: "lines", answer_lines: 12, difficulty: "high", confidence: 0.95 },
    ],
    protected: [
      { type: "response_constraint", importance: "essential", value: "Resumen de 60-80 palabras, sin copiar frases completas", activities: ["a1"], resources: [] },
      { type: "response_constraint", importance: "essential", value: "Tesis con palabras propias y dos argumentos que la apoyen", activities: ["a2"], resources: [] },
      { type: "required_vocabulary", importance: "important", value: "Conector «No obstante» al inicio del tercer párrafo", activities: ["a3"], resources: [] },
      { type: "response_constraint", importance: "essential", value: "Justificar el registro con dos rasgos lingüísticos del texto", activities: ["a4"], resources: [] },
      { type: "response_constraint", importance: "essential", value: "Texto argumentativo de 150-180 palabras con tesis, al menos dos argumentos y conclusión", activities: ["a5"], resources: [] },
      { type: "format_requirement", importance: "important", value: "Escribir de forma legible y organizar el texto en párrafos", activities: ["a5"], resources: [] },
      { type: "necessary_visual", importance: "essential", value: "Texto base necesario para las actividades 1-4", activities: ["a1", "a2", "a3", "a4"], resources: ["c1"] },
      { type: "required_data", importance: "essential", value: "Cuestión: «¿Deberían las bibliotecas abrir también por la noche durante el verano?»", activities: ["a5"], resources: [] },
    ],
    uncertainties: [],
    quality: { confidence: 0.95, readability: "good" },
  };
  return normalizeAnalysis(MaterialAnalysisDraftSchema.parse(d), { pageCount: 2 }).analysis;
}

/** The eight decisions the real planner produced for Bachillerato, as a draft (same shape, same targets). */
export const BACH_PLAN_DRAFT = {
  decisions: [
    decision({ target: "document", action: "reorganize", strategies: ["spatial_organization", "attention_focus"], dimensions: ["number_of_visible_tasks", "predictable_structure"], note: "Mostrar pocas actividades por página (máx. 3), con el mismo esquema en cada una: instrucción, requisitos, espacio de respuesta." }),
    decision({ target: "document", action: "add_support", strategies: ["instruction_clarification"], dimensions: ["explicit_expectations", "predictable_structure"], intensity: "light", supports: [support("step_list")], note: "Breve guía inicial con el orden de trabajo." }),
    decision({ target: "act_1", action: "segment", strategies: ["task_sequencing", "instruction_clarification", "planning_support"], dimensions: ["instruction_chunking", "planning_support", "working_memory_support", "checklist_support"], intensity: "substantial", preserves: ["prt_1", "prt_7"], supports: [support("step_list"), support("checklist")], note: "Secuenciar: localizar ideas, redactar con palabras propias, comprobar extensión. Mantener un único resumen." }),
    decision({ target: "act_2", action: "segment", strategies: ["task_sequencing", "instruction_clarification"], dimensions: ["instruction_chunking", "working_memory_support", "explicit_expectations"], preserves: ["prt_2", "prt_7"], supports: [support("reminder")], note: "Separar visualmente los dos pedidos. Sin pistas sobre el contenido." }),
    decision({ target: "act_3", action: "rephrase", strategies: ["instruction_clarification"], dimensions: ["instruction_chunking", "explicit_expectations"], intensity: "light", preserves: ["prt_3", "prt_7"], note: "Mantener el conector y la referencia al tercer párrafo; indicar claramente qué se pide explicar." }),
    decision({ target: "act_4", action: "segment", strategies: ["task_sequencing", "instruction_clarification"], dimensions: ["instruction_chunking", "working_memory_support", "checklist_support"], preserves: ["prt_4", "prt_7"], supports: [support("checklist")], note: "Dos pasos: indicar el registro y justificarlo. Lista de comprobación sin nombrar rasgos concretos." }),
    decision({ target: "act_5", action: "segment", strategies: ["task_sequencing", "planning_support", "working_memory_support"], dimensions: ["instruction_chunking", "planning_support", "working_memory_support", "checklist_support"], intensity: "substantial", preserves: ["prt_5", "prt_6", "prt_8"], supports: [support("planner"), support("step_list"), support("checklist")], note: "Fases: planificar, redactar, revisar. Planificador sin contenido." }),
    decision({ target: "ctt_3", action: "keep", strategies: ["instruction_clarification"], dimensions: ["explicit_expectations"], intensity: "light", note: "Integrar la instrucción y la nota de extensión junto a act_5 sin duplicarla." }),
  ],
  summary: ["Estructura repetida y pocas tareas por página.", "Planificador para la redacción final.", "Los requisitos evaluados se mantienen intactos."],
} as unknown as DraftAdaptationPlan;

/** The review of the Bachillerato experiment (`evidence/review-bachillerato.json`), re-bound to this plan's fingerprint. */
export function bachReviewFor(plan: AdaptationPlan): PlanReview {
  const frozen = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "evidence/review-bachillerato.json"), "utf8")) as PlanReview;
  return { ...frozen, plan_fingerprint: fingerprint(plan) };
}
