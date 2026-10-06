import type { MaterialAnalysisDraft } from "@/lib/schemas/material-analysis-v2";

/**
 * Deterministic analysis returned by the mock provider (a fractions worksheet). It exists so the whole
 * pipeline, the UI and the E2E suite can run with no API key. It is NEVER a real analysis.
 */
export function mockAnalysisDraft(): MaterialAnalysisDraft {
  return {
    identification: {
      title: { value: "Fracciones equivalentes", confidence: 0.9 },
      stage: { value: "primaria", confidence: 0.85 },
      grade: { value: "5-primaria", confidence: 0.65 },
      subject: { value: "Matemáticas", confidence: 0.95 },
      topic: { value: "Fracciones equivalentes y suma de fracciones", confidence: 0.85 },
      language: { value: "es", confidence: 0.99 },
    },
    pedagogical_intent: {
      purpose: "Practicar la equivalencia de fracciones y la suma de fracciones con distinto denominador.",
      learning_objectives: [
        { id: "o1", text: "Reconocer fracciones equivalentes.", confidence: 0.9 },
        { id: "o2", text: "Sumar fracciones con denominadores distintos.", confidence: 0.85 },
      ],
      knowledge_involved: ["Fracciones", "Equivalencia de fracciones", "Suma de fracciones"],
      prerequisites: ["Concepto de fracción", "Tablas de multiplicar"],
      difficulty: "medium",
      difficulty_rationale: "Exige buscar denominadores comunes y razonar con dos pasos.",
      complexity: 0.35,
    },
    sections: [{ id: "s1", title: "Fracciones equivalentes", page_start: 1, page_end: 1, summary: "Ejemplo resuelto y cuatro actividades." }],
    contents: [
      { id: "c1", section_id: "s1", page: 1, kind: "general_instruction", text: "Lee cada enunciado con atención y resuelve en tu cuaderno.", table_headers: [], table_rows: [], legible: true },
      { id: "c2", section_id: "s1", page: 1, kind: "example", text: "Ejemplo: 1/2 + 1/4 = 2/4 + 1/4 = 3/4", table_headers: [], table_rows: [], legible: true },
      {
        id: "c3",
        section_id: "s1",
        page: 1,
        kind: "table",
        text: "Tabla de equivalencias",
        table_headers: ["Fracción", "Equivalente"],
        table_rows: [["1/2", "2/4"], ["1/3", ""]],
        legible: true,
      },
    ],
    activities: [
      {
        id: "a1", section_id: "s1", page: 1, label: "1", type: "calculation",
        instruction: "Calcula.", content: "Calcula 2/3 + 1/6.", response_format: "write_text", has_answer_space: true,
        expected_answer: { value: "5/6", basis: "inferred", confidence: 0.9 },
        difficulty: "medium", knowledge_required: ["Suma de fracciones", "Denominador común"], objective_ids: ["o2"], visual_ids: [], confidence: 0.95,
      },
      {
        id: "a2", section_id: "s1", page: 1, label: "2", type: "multiple_choice",
        instruction: "Marca la respuesta correcta.", content: "¿Qué fracción es equivalente a 1/2? a) 2/4  b) 2/3  c) 3/4", response_format: "select_option", has_answer_space: false,
        expected_answer: { value: "a) 2/4", basis: "inferred", confidence: 0.95 },
        difficulty: "low", knowledge_required: ["Equivalencia de fracciones"], objective_ids: ["o1"], visual_ids: [], confidence: 0.95,
      },
      {
        id: "a3", section_id: "s1", page: 1, label: "3", type: "problem_solving",
        instruction: "Resuelve el problema.", content: "Ana come 1/3 de una pizza y Luis 1/4. ¿Qué fracción de la pizza han comido entre los dos?", response_format: "write_text", has_answer_space: true,
        expected_answer: { value: "7/12", basis: "inferred", confidence: 0.9 },
        difficulty: "medium", knowledge_required: ["Suma de fracciones", "Interpretar enunciados"], objective_ids: ["o2"], visual_ids: ["v1"], confidence: 0.9,
      },
      {
        id: "a4", section_id: "s1", page: 1, label: "4", type: "open_question",
        instruction: "Explica con tus palabras.", content: "Explica con tus palabras por qué 2/4 es igual a 1/2.", response_format: "write_text", has_answer_space: true,
        expected_answer: { value: "", basis: "not_inferable", confidence: 0.5 },
        difficulty: "medium", knowledge_required: ["Equivalencia de fracciones"], objective_ids: ["o1"], visual_ids: [], confidence: 0.9,
      },
    ],
    visual_elements: [
      {
        id: "v1", page: 1, kind: "illustration", description: "Dibujo de una pizza dividida en doce porciones.", pedagogical_function: "informative", necessary_to_solve: false,
        activity_ids: ["a3"], text_in_image: "", confidence: 0.85,
      },
      {
        id: "v2", page: 1, kind: "decorative_border", description: "Marco decorativo alrededor de la ficha.", pedagogical_function: "decorative", necessary_to_solve: false,
        activity_ids: [], text_in_image: "", confidence: 0.9,
      },
    ],
    protected_elements: [
      { id: "p1", kind: "target_operation", description: "Suma de fracciones con distinto denominador.", rationale: "Es el objetivo que se practica en dos actividades.", activity_ids: ["a1", "a3"], visual_ids: [], importance: "essential" },
      { id: "p2", kind: "concept", description: "Equivalencia de fracciones.", rationale: "Es el concepto que se evalúa en las actividades 2 y 4.", activity_ids: ["a2", "a4"], visual_ids: [], importance: "essential" },
    ],
    uncertainties: [
      { id: "u1", kind: "answer_not_inferable", page: 1, description: "La actividad 4 pide una explicación abierta: no hay una única respuesta esperable.", activity_ids: ["a4"], confidence: 0.5 },
    ],
    quality: { overall_confidence: 0.88, readability: "good" },
  };
}
