import type { MaterialAnalysisDraftInput } from "@/lib/schemas/material-analysis";

/**
 * Deterministic v3 draft returned by the mock provider for `material_analyzer@v2` (the same fractions worksheet as the v2
 * mock, in the compact shape). It exists so the pipeline, the UI and the E2E suite can run with no API key. It is NEVER a
 * real analysis.
 */
export function mockAnalysisDraftV3(): MaterialAnalysisDraftInput {
  return {
    identification: {
      title: "Fracciones equivalentes",
      language: "es",
      stage: "primaria",
      grade: "5-primaria",
      subject: "Matemáticas",
      topic: "Fracciones equivalentes y suma de fracciones",
      confidence: { stage: 0.85, grade: 0.65, subject: 0.95, topic: 0.85 },
    },
    intent: {
      purpose: "Practicar la equivalencia de fracciones y la suma de fracciones con distinto denominador.",
      objectives: [
        { id: "o1", text: "Reconocer fracciones equivalentes." },
        { id: "o2", text: "Sumar fracciones con denominadores distintos." },
      ],
      knowledge: ["Fracciones", "Equivalencia de fracciones", "Suma de fracciones"],
      prerequisites: ["Concepto de fracción", "Tablas de multiplicar"],
      difficulty: "medium",
    },
    sections: [{ id: "s1", title: "Fracciones equivalentes", page_start: 1, page_end: 1 }],
    texts: [
      { id: "c1", kind: "instruction", page: 1, text: "Lee cada enunciado con atención y resuelve en tu cuaderno." },
      { id: "c2", kind: "example", page: 1, text: "Ejemplo: 1/2 + 1/4 = 2/4 + 1/4 = 3/4" },
    ],
    visuals: [
      {
        id: "v1",
        kind: "table",
        page: 1,
        role: "informative",
        title: "Tabla de equivalencias",
        description: "",
        table: { headers: ["Fracción", "Equivalente"], rows: [["1/2", "2/4"], ["1/3", ""]] },
      },
      { id: "v2", kind: "image", page: 1, role: "informative", description: "Dibujo de una pizza dividida en doce porciones." },
      { id: "v3", kind: "decorative", page: 1, role: "decorative", description: "Marco decorativo alrededor de la ficha." },
    ],
    admin: [
      { type: "student_name", label: "Nombre y apellidos", page: 1 },
      { type: "date", label: "Fecha", page: 1 },
    ],
    activities: [
      {
        id: "a1", label: "1", page: 1, type: "calculation", instruction: "Calcula 2/3 + 1/6.", resources: ["c2"], objectives: ["o2"],
        response: "write_text", answer_area: "lines", answer_lines: 1, answer: { basis: "inferred", value: "5/6" }, difficulty: "medium", confidence: 0.95,
      },
      {
        id: "a2", label: "2", page: 1, type: "multiple_choice", instruction: "Marca la fracción equivalente a 1/2.", context: "a) 2/4  b) 2/3  c) 3/4", resources: ["v1"], objectives: ["o1"],
        response: "select_option", answer_area: "none", answer: { basis: "inferred", value: "a) 2/4" }, difficulty: "low", confidence: 0.95,
      },
      {
        id: "a3", label: "3", page: 1, type: "problem_solving", instruction: "¿Qué fracción de la pizza han comido entre los dos?", context: "Ana come 1/3 de una pizza y Luis 1/4.", resources: ["v2"], objectives: ["o2"],
        response: "write_text", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "7/12" }, difficulty: "medium", confidence: 0.9,
      },
      {
        id: "a4", label: "4", page: 1, type: "open_question", instruction: "Explica con tus palabras por qué 2/4 es igual a 1/2.", resources: [], objectives: ["o1"],
        response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.9,
      },
    ],
    protected: [
      { type: "target_operation", importance: "essential", value: "Suma de fracciones con distinto denominador", activities: ["a1", "a3"], resources: [] },
      { type: "concept", importance: "essential", value: "Equivalencia de fracciones", activities: ["a2", "a4"], resources: [] },
      { type: "reasoning_constraint", importance: "important", value: "Explica con tus palabras", activities: ["a4"], resources: [] },
    ],
    uncertainties: [{ kind: "ambiguous", targets: ["a3"], note: "El dibujo de la pizza no coincide exactamente con las fracciones del enunciado.", confidence: 0.6 }],
    quality: { confidence: 0.88, readability: "good" },
  };
}
