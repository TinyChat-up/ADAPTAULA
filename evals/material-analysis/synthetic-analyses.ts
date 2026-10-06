import type { MaterialAnalysisDraftInput } from "@/lib/schemas/material-analysis";
import type { MaterialAnalysisDraft as MaterialAnalysisDraftV2 } from "@/lib/schemas/material-analysis-v2";

/**
 * A synthetic worksheet (invented content, no real material) written twice: as `material_analyzer@v1` would have returned it
 * (draft v2, WITH the defects seen in a real analysis: administrative lines inside a heading, a table stored both as content
 * and as a `table_image`, an asymmetric activity ↔ visual link, `content` repeating `instruction`, constraints left
 * unprotected) and as `material_analyzer@v2` should return it (draft v3). Both describe the same two-page "documents +
 * questions" worksheet. They are the reproducible input of the size benchmark and of the v2 → v3 tests: the real analyses
 * of private worksheets never enter the repository.
 */

const INSTRUCTIONS = {
  a1: "Calcula cuánto aumentó la recogida de envases entre 2019 y 2023, primero en toneladas y después en porcentaje aproximado respecto a 2019.",
  a2: "A partir del documento 2, explica por qué puede afirmarse que el residuo orgánico es el más abundante. No basta con copiar un porcentaje.",
  a3: "Compara el destino vertedero con el conjunto de reciclado y compostaje. ¿Qué diferencia hay en puntos porcentuales?",
  a4: "Propón dos consecuencias que tendría reducir el vertedero para el servicio de limpieza del municipio. Justifica cada una.",
  a5: "El ayuntamiento quiere reducir el vertedero en 10 puntos porcentuales sin reducir la cantidad total de residuos. Propón una medida concreta y explica qué dato de los documentos apoya tu propuesta.",
  a6: "Redacta una conclusión de 4-5 líneas que relacione la evolución de la recogida, la composición de los residuos y su destino. Debe utilizar al menos dos datos numéricos de los documentos.",
} as const;

const INTRO = "El ayuntamiento de Valdearroyo ha publicado estos datos para analizar la gestión de residuos. El municipio es ficticio, pero los datos siguen patrones plausibles.";

/** What v1 returned (draft v2), defects included. */
export function worksheetDraftV2(): MaterialAnalysisDraftV2 {
  const act = (n: number, key: keyof typeof INSTRUCTIONS, extra: Partial<MaterialAnalysisDraftV2["activities"][number]>): MaterialAnalysisDraftV2["activities"][number] => ({
    id: `a${n}`, section_id: "s2", page: 2, label: String(n), type: "open_question", instruction: INSTRUCTIONS[key], content: INSTRUCTIONS[key],
    response_format: "write_text", has_answer_space: true, expected_answer: { value: "", basis: "not_inferable", confidence: 0.3 },
    difficulty: "medium", knowledge_required: [], objective_ids: [], visual_ids: [], confidence: 0.95, ...extra,
  });
  return {
    identification: {
      title: { value: "Reciclaje en una ciudad mediana", confidence: 0.98 },
      stage: { value: "eso", confidence: 0.97 },
      grade: { value: "2-eso", confidence: 0.97 },
      subject: { value: "Biología y Geología", confidence: 0.95 },
      topic: { value: "Gestión de residuos a partir de datos", confidence: 0.85 },
      language: { value: "es", confidence: 0.99 },
    },
    pedagogical_intent: {
      purpose: "Analizar datos de recogida, composición y destino de los residuos de un municipio ficticio con una tabla y dos gráficos de barras, calculando variaciones, interpretando datos y argumentando medidas.",
      learning_objectives: [
        { id: "o1", text: "Calcular el aumento absoluto y relativo de una magnitud a partir de una tabla.", confidence: 0.9 },
        { id: "o2", text: "Interpretar la composición de los residuos y justificar una afirmación sin copiar un dato.", confidence: 0.88 },
        { id: "o3", text: "Comparar porcentajes y calcular diferencias en puntos porcentuales.", confidence: 0.88 },
        { id: "o4", text: "Razonar consecuencias de una medida sobre los servicios municipales.", confidence: 0.8 },
        { id: "o5", text: "Proponer una medida apoyada en datos y redactar una conclusión que los relacione.", confidence: 0.82 },
      ],
      knowledge_involved: ["Lectura de tablas y gráficos de barras", "Variación absoluta y porcentual", "Puntos porcentuales", "Gestión de residuos", "Argumentación con datos"],
      prerequisites: ["Cálculo de porcentajes", "Interpretación de gráficos", "Distinción entre porcentaje y punto porcentual"],
      difficulty: "medium",
      difficulty_rationale: "Combina cálculo sencillo con varias preguntas de razonamiento y redacción que exigen usar datos de distintos documentos.",
      complexity: 0.5,
    },
    sections: [
      { id: "s1", title: "Documentos", page_start: 1, page_end: 1, summary: "Introducción y tres documentos de datos: una tabla y dos gráficos." },
      { id: "s2", title: "Actividades", page_start: 2, page_end: 2, summary: "Seis actividades de cálculo, explicación, comparación, argumentación y redacción." },
    ],
    contents: [
      { id: "c1", section_id: "s1", page: 1, kind: "heading", text: "Reciclaje en una ciudad mediana\n2.º de ESO · Biología y Geología\nNombre y apellidos: ____ Fecha: ____", table_headers: [], table_rows: [], legible: true },
      { id: "c2", section_id: "s1", page: 1, kind: "reading_text", text: INTRO, table_headers: [], table_rows: [], legible: true },
      { id: "c3", section_id: "s1", page: 1, kind: "heading", text: "Documento 1. Recogida de envases", table_headers: [], table_rows: [], legible: true },
      { id: "c4", section_id: "s1", page: 1, kind: "table", text: "Documento 1: toneladas de envases por año", table_headers: ["Año", "2019", "2021", "2023"], table_rows: [["Envases (t)", "410", "470", "520"]], legible: true },
      { id: "c5", section_id: "s1", page: 1, kind: "heading", text: "Documento 2. Composición de los residuos (2023)", table_headers: [], table_rows: [], legible: true },
      { id: "c6", section_id: "s1", page: 1, kind: "heading", text: "Documento 3. Destino de los residuos (2023)", table_headers: [], table_rows: [], legible: true },
      { id: "c7", section_id: "s1", page: 1, kind: "note", text: "Nota: cada hogar indica un único destino principal. Los porcentajes suman 100 %.", table_headers: [], table_rows: [], legible: true },
      { id: "c8", section_id: "s2", page: 2, kind: "heading", text: "Actividades\n2.º de ESO · Biología y Geología\nNombre y apellidos: ____ Fecha: ____", table_headers: [], table_rows: [], legible: true },
      { id: "c9", section_id: "s2", page: 2, kind: "note", text: "Página 2 de 2", table_headers: [], table_rows: [], legible: true },
    ],
    activities: [
      act(1, "a1", { type: "calculation", response_format: "calculate", expected_answer: { value: "Aumento de 110 toneladas (520 − 410); aproximadamente un 26,8 % respecto a 2019.", basis: "inferred", confidence: 0.95 }, difficulty: "low", knowledge_required: ["Resta", "Porcentaje de variación"], objective_ids: ["o1"], visual_ids: [] }),
      act(2, "a2", { knowledge_required: ["Composición de residuos", "Comparación de porcentajes"], objective_ids: ["o2"], visual_ids: ["v2"] }),
      act(3, "a3", { type: "calculation", expected_answer: { value: "Reciclado + compostaje = 35 % + 20 % = 55 %; vertedero 45 %; diferencia de 10 puntos porcentuales.", basis: "inferred", confidence: 0.95 }, difficulty: "low", knowledge_required: ["Suma de porcentajes", "Puntos porcentuales"], objective_ids: ["o3"], visual_ids: ["v3"] }),
      act(4, "a4", { knowledge_required: ["Servicios públicos", "Argumentación"], objective_ids: ["o4"], visual_ids: ["v3"] }),
      act(5, "a5", { type: "problem_solving", difficulty: "high", knowledge_required: ["Puntos porcentuales", "Uso de datos para justificar"], objective_ids: ["o3", "o5"], visual_ids: ["v3"], confidence: 0.93 }),
      act(6, "a6", { type: "writing", difficulty: "high", knowledge_required: ["Síntesis", "Redacción"], objective_ids: ["o5"], visual_ids: ["v1", "v2", "v3"] }),
    ],
    visual_elements: [
      { id: "v1", page: 1, kind: "table_image", description: "Tabla del Documento 1 con las toneladas de envases en 2019, 2021 y 2023.", pedagogical_function: "required_for_task", necessary_to_solve: true, activity_ids: ["a1", "a6"], text_in_image: "Año 2019 2021 2023; Envases (t) 410 470 520", confidence: 0.97 },
      { id: "v2", page: 1, kind: "chart_or_graph", description: "Gráfico de barras horizontales de la composición de los residuos en 2023 con porcentajes.", pedagogical_function: "required_for_task", necessary_to_solve: true, activity_ids: ["a2", "a6"], text_in_image: "Papel 28%; Vidrio 12%; Envases 20%; Orgánico 40%", confidence: 0.95 },
      { id: "v3", page: 1, kind: "chart_or_graph", description: "Gráfico de barras verticales del destino de los residuos en 2023.", pedagogical_function: "required_for_task", necessary_to_solve: true, activity_ids: ["a3", "a4", "a5", "a6"], text_in_image: "Reciclado 35%; Vertedero 45%; Compostaje 20%", confidence: 0.95 },
      { id: "v4", page: 1, kind: "decorative_border", description: "Recuadros redondeados que enmarcan las actividades.", pedagogical_function: "decorative", necessary_to_solve: false, activity_ids: [], text_in_image: "", confidence: 0.8 },
    ],
    protected_elements: [
      { id: "p1", kind: "target_operation", description: "Cálculo del aumento absoluto y porcentual de envases 2019-2023.", rationale: "Es la operación objetivo de la actividad 1; los datos de la tabla deben conservarse.", activity_ids: ["a1"], visual_ids: ["v1"], importance: "essential" },
      { id: "p2", kind: "units_or_magnitudes", description: "Distinción entre porcentaje y puntos porcentuales.", rationale: "Las actividades 3 y 5 evalúan este concepto y los valores del gráfico.", activity_ids: ["a3", "a5"], visual_ids: ["v3"], importance: "essential" },
      { id: "p3", kind: "concept", description: "Composición de los residuos y justificación de una afirmación.", rationale: "Concepto central de las actividades 2 y 4.", activity_ids: ["a2", "a4"], visual_ids: ["v2"], importance: "essential" },
      { id: "p4", kind: "necessary_figure", description: "Los tres documentos (tabla y dos gráficos) con sus valores.", rationale: "Todas las actividades dependen de sus datos.", activity_ids: ["a1", "a2", "a3", "a5", "a6"], visual_ids: ["v1", "v2", "v3"], importance: "essential" },
      { id: "p5", kind: "other", description: "Requisitos de producción: 4-5 líneas y al menos dos datos numéricos.", rationale: "Son criterios de logro de las actividades 4 y 6.", activity_ids: ["a4", "a6"], visual_ids: [], importance: "important" },
    ],
    uncertainties: [
      { id: "u1", kind: "answer_not_inferable", page: 2, description: "Las actividades 2, 4, 5 y 6 son abiertas y no tienen respuesta única.", activity_ids: ["a2", "a4", "a5", "a6"], confidence: 0.9 },
      { id: "u2", kind: "ambiguous", page: 2, description: "En la actividad 5, el dato de apoyo y la medida dependen del criterio del alumno.", activity_ids: ["a5"], confidence: 0.6 },
    ],
    quality: { overall_confidence: 0.94, readability: "good" },
  };
}

/** What material_analyzer@v2 should return for the same worksheet (draft v3), with the information v2 could not hold. */
export function worksheetDraftV3(): MaterialAnalysisDraftInput {
  return {
    identification: {
      title: "Reciclaje en una ciudad mediana",
      language: "es",
      stage: "eso",
      grade: "2-eso",
      subject: "Biología y Geología",
      topic: "Gestión de residuos a partir de datos",
      confidence: { stage: 0.97, grade: 0.97, subject: 0.95, topic: 0.85 },
    },
    intent: {
      purpose: "Analizar datos de recogida, composición y destino de los residuos de un municipio ficticio con una tabla y dos gráficos de barras, calculando, interpretando y argumentando.",
      objectives: [
        { id: "o1", text: "Calcular el aumento absoluto y relativo de una magnitud a partir de una tabla." },
        { id: "o2", text: "Interpretar la composición de los residuos y justificar una afirmación sin copiar un dato." },
        { id: "o3", text: "Comparar porcentajes y calcular diferencias en puntos porcentuales." },
        { id: "o4", text: "Razonar consecuencias de una medida sobre los servicios municipales." },
        { id: "o5", text: "Proponer una medida apoyada en datos y redactar una conclusión que los relacione." },
      ],
      knowledge: ["Lectura de tablas y gráficos de barras", "Variación absoluta y porcentual", "Puntos porcentuales", "Gestión de residuos", "Argumentación con datos"],
      prerequisites: ["Cálculo de porcentajes", "Interpretación de gráficos", "Porcentaje frente a punto porcentual"],
      difficulty: "medium",
    },
    sections: [
      { id: "s1", title: "Documentos", page_start: 1, page_end: 1 },
      { id: "s2", title: "Actividades", page_start: 2, page_end: 2 },
    ],
    texts: [
      { id: "c1", kind: "reading_text", page: 1, text: INTRO },
      { id: "c2", kind: "note", page: 1, text: "Cada hogar indica un único destino principal. Los porcentajes suman 100 %." },
    ],
    visuals: [
      { id: "v1", kind: "table", page: 1, role: "required", title: "Documento 1. Recogida de envases", description: "", table: { headers: ["Año", "2019", "2021", "2023"], rows: [["Envases", "410", "470", "520"]], unit: "toneladas" } },
      { id: "v2", kind: "chart", page: 1, role: "required", title: "Documento 2. Composición de los residuos (2023)", description: "Barras horizontales.", chart: { type: "bar", categories: ["Papel", "Vidrio", "Envases", "Orgánico"], series: [{ name: "", values: [28, 12, 20, 40] }], unit: "%" } },
      { id: "v3", kind: "chart", page: 1, role: "required", title: "Documento 3. Destino de los residuos (2023)", description: "Barras verticales.", chart: { type: "bar", categories: ["Reciclado", "Vertedero", "Compostaje"], series: [{ name: "", values: [35, 45, 20] }], unit: "%" } },
      { id: "v4", kind: "decorative", page: 1, role: "decorative", description: "Recuadros redondeados que enmarcan las actividades." },
    ],
    admin: [
      { type: "student_name", label: "Nombre y apellidos", page: 1 },
      { type: "date", label: "Fecha", page: 1 },
    ],
    activities: [
      { id: "a1", label: "1", page: 2, type: "calculation", instruction: INSTRUCTIONS.a1, resources: ["v1"], objectives: ["o1"], response: "calculate", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "110 toneladas; aproximadamente un 26,8 %" }, difficulty: "low", confidence: 0.97 },
      { id: "a2", label: "2", page: 2, type: "open_question", instruction: INSTRUCTIONS.a2, resources: ["v2"], objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.95 },
      { id: "a3", label: "3", page: 2, type: "calculation", instruction: INSTRUCTIONS.a3, resources: ["v3"], objectives: ["o3"], response: "write_text", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "10 puntos porcentuales (55 % frente a 45 %)" }, difficulty: "low", confidence: 0.95 },
      { id: "a4", label: "4", page: 2, type: "open_question", instruction: INSTRUCTIONS.a4, resources: ["v3"], objectives: ["o4"], response: "write_text", answer_area: "lines", answer_lines: 4, difficulty: "medium", confidence: 0.95 },
      { id: "a5", label: "5", page: 2, type: "problem_solving", instruction: INSTRUCTIONS.a5, resources: ["v3"], objectives: ["o3", "o5"], response: "write_text", answer_area: "lines", answer_lines: 4, difficulty: "high", confidence: 0.93 },
      { id: "a6", label: "6", page: 2, type: "writing", instruction: INSTRUCTIONS.a6, resources: ["v1", "v2", "v3"], objectives: ["o5"], response: "write_text", answer_area: "lines", answer_lines: 5, difficulty: "high", confidence: 0.95 },
    ],
    protected: [
      { type: "target_operation", importance: "essential", value: "Aumento absoluto y porcentual entre dos años", activities: ["a1"], resources: ["v1"] },
      { type: "units_or_magnitudes", importance: "essential", value: "Porcentaje frente a punto porcentual", activities: ["a3", "a5"], resources: [] },
      { type: "reasoning_constraint", importance: "essential", value: "No basta con copiar un porcentaje", activities: ["a2"], resources: [] },
      { type: "reasoning_constraint", importance: "essential", value: "Sin reducir la cantidad total de residuos", activities: ["a5"], resources: [] },
      { type: "response_constraint", importance: "essential", value: "Conclusión de 4-5 líneas con al menos dos datos numéricos", activities: ["a6"], resources: [] },
      { type: "response_constraint", importance: "important", value: "Justificar cada consecuencia", activities: ["a4"], resources: [] },
      { type: "necessary_visual", importance: "essential", value: "Tabla y gráficos con sus valores", activities: [], resources: ["v1", "v2", "v3"] },
      { type: "required_vocabulary", importance: "important", value: "envejecimiento, residuo orgánico, puntos porcentuales", activities: ["a2", "a3"], resources: [] },
      { type: "other", importance: "important", value: "Nota: cada hogar indica un único destino principal; los porcentajes suman 100 %", activities: [], resources: ["v3"] },
    ],
    uncertainties: [{ kind: "ambiguous", targets: ["a5"], note: "No está claro qué dato de apoyo se espera citar.", confidence: 0.6 }],
    quality: { confidence: 0.94, readability: "good" },
  };
}

/**
 * A good (hand-authored) draft v3 for the eval case `esp-condiciones-escenario`: an informative introduction, a price table, and three
 * activities whose conditions define the problem ("exclusivamente…", "sin reducir…", "como máximo… e incluye…"). It is what a
 * careful analysis of that sheet looks like, so the tests can check the scoring against a known-good and known-degraded analysis.
 */
export function conditionsDraftV3(): MaterialAnalysisDraftInput {
  return {
    identification: { title: "Presupuesto de una excursión", language: "es", stage: "eso", grade: "3-eso", subject: "Matemáticas", topic: "Presupuesto y ajuste del gasto", confidence: { stage: 0.9, grade: 0.9, subject: 0.7, topic: 0.85 } },
    intent: {
      purpose: "Calcular un coste a partir de una tabla de precios y proponer, con datos, un ajuste del gasto que respete unas condiciones.",
      objectives: [
        { id: "o1", text: "Calcular un coste total a partir de precios unitarios" },
        { id: "o2", text: "Proponer y justificar un ajuste del gasto respetando condiciones" },
      ],
      knowledge: ["Multiplicación y suma de precios", "Presupuesto y gasto"],
      prerequisites: ["Operaciones con decimales", "Lectura de tablas"],
      difficulty: "medium",
    },
    sections: [{ id: "s1", title: "Presupuesto de una excursión", page_start: 1, page_end: 1 }],
    texts: [{ id: "c1", kind: "reading_text", page: 1, text: "Un grupo de 3.º de ESO organiza una excursión con un presupuesto limitado. Los precios por persona de cada servicio figuran en la tabla." }],
    visuals: [{ id: "v1", kind: "table", page: 1, role: "required", description: "", table: { headers: ["Servicio", "Precio por persona (euros)"], rows: [["Autobús", "12"], ["Entrada al museo", "8"], ["Comida", "10"]] } }],
    admin: [],
    activities: [
      { id: "a1", label: "1", page: 1, type: "calculation", instruction: "Calcula el coste total para 25 alumnos usando exclusivamente los precios de la tabla.", resources: ["v1"], objectives: ["o1"], response: "calculate", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "750 euros" }, difficulty: "low", confidence: 0.95 },
      { id: "a2", label: "2", page: 1, type: "problem_solving", instruction: "Propón un ajuste que reduzca el gasto total en 50 euros sin reducir el número de alumnos que viajan.", resources: ["c1", "v1"], objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.93 },
      { id: "a3", label: "3", page: 1, type: "writing", instruction: "Justifica tu ajuste en como máximo 5 líneas e incluye al menos un dato de la tabla.", resources: ["v1"], objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 5, difficulty: "medium", confidence: 0.93 },
    ],
    protected: [
      { type: "required_data", importance: "essential", value: "Precios por persona de la tabla", activities: [], resources: ["v1"] },
      { type: "target_operation", importance: "essential", value: "Coste total para 25 alumnos", activities: ["a1"], resources: [] },
      { type: "reasoning_constraint", importance: "essential", value: "Usar exclusivamente los precios de la tabla", activities: ["a1"], resources: [] },
      { type: "reasoning_constraint", importance: "essential", value: "Sin reducir el número de alumnos que viajan", activities: ["a2"], resources: [] },
      { type: "response_constraint", importance: "important", value: "Como máximo 5 líneas", activities: ["a3"], resources: [] },
      { type: "response_constraint", importance: "essential", value: "Incluir al menos un dato de la tabla", activities: ["a3"], resources: [] },
      { type: "required_vocabulary", importance: "important", value: "presupuesto, gasto total", activities: ["a2"], resources: [] },
      { type: "format_requirement", importance: "optional", value: "Tabla de precios en dos columnas", activities: [], resources: ["v1"] },
    ],
    uncertainties: [],
    quality: { confidence: 0.95, readability: "good" },
  };
}
