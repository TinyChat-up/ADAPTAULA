import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis, type MaterialAnalysisDraftInput } from "@/lib/schemas/material-analysis";

/**
 * Three synthetic MaterialAnalysis v3 fixtures modelled on the materials validated in Fase 3 (same structure and kind of
 * demands, different words and numbers: the real worksheets stay private and out of git). They are what a careful analysis
 * of each sheet looks like, normalised by the real normalizer.
 */

const toAnalysis = (draft: MaterialAnalysisDraftInput, pageCount: number): MaterialAnalysis =>
  normalizeAnalysis(MaterialAnalysisDraftSchema.parse(draft), { pageCount }).analysis;

/** Primaria · fracciones: representation on a figure, equivalences on strips, an addition, an ordering and a short explanation. */
export function fractionsAnalysis(): MaterialAnalysis {
  return toAnalysis(
    {
      identification: { title: "Fracciones: partes de un todo", language: "es", stage: "primaria", grade: "5-primaria", subject: "Matemáticas", topic: "Fracciones y equivalencias", confidence: { stage: 0.95, grade: 0.9, subject: 0.98, topic: 0.9 } },
      intent: {
        purpose: "Representar, comparar, sumar y reconocer fracciones equivalentes con apoyo de figuras.",
        objectives: [
          { id: "o1", text: "Representar una fracción sobre una figura" },
          { id: "o2", text: "Reconocer fracciones equivalentes" },
          { id: "o3", text: "Sumar fracciones de igual denominador" },
          { id: "o4", text: "Comparar y ordenar fracciones" },
        ],
        knowledge: ["Fracción como parte de un todo", "Fracciones equivalentes", "Suma de fracciones"],
        prerequisites: ["Partes iguales de una unidad"],
        difficulty: "medium",
      },
      sections: [{ id: "s1", title: "Fracciones", page_start: 1, page_end: 1 }],
      texts: [{ id: "c1", kind: "instruction", page: 1, text: "Lee cada ejercicio con atención y responde en el espacio indicado." }],
      visuals: [
        { id: "v1", kind: "geometric_figure", page: 1, role: "required", title: "Figura 1", description: "Rectángulo dividido en 4 partes iguales." },
        { id: "v2", kind: "diagram", page: 1, role: "required", title: "Tiras de fracciones", description: "Dos tiras iguales: una dividida en 2 partes y otra en 4." },
        { id: "v3", kind: "decorative", page: 1, role: "decorative", description: "Estrellas y lápices de colores en los márgenes." },
      ],
      admin: [{ type: "student_name", label: "Nombre", page: 1 }],
      activities: [
        { id: "a1", label: "1", page: 1, type: "drawing", instruction: "Colorea 3/4 de la figura 1.", resources: ["v1"], objectives: ["o1"], response: "draw", answer_area: "none", difficulty: "low", confidence: 0.95 },
        { id: "a2", label: "2", page: 1, type: "short_answer", instruction: "Observa las tiras de fracciones y escribe dos fracciones equivalentes a 1/2.", resources: ["v2"], objectives: ["o2"], response: "write_text", answer_area: "line", answer: { basis: "inferred", value: "2/4 y 4/8" }, difficulty: "medium", confidence: 0.9 },
        { id: "a3", label: "3", page: 1, type: "calculation", instruction: "Calcula 2/5 + 1/5 y simplifica el resultado si se puede.", objectives: ["o3"], response: "calculate", answer_area: "lines", answer_lines: 1, answer: { basis: "inferred", value: "3/5" }, difficulty: "low", confidence: 0.97 },
        { id: "a4", label: "4", page: 1, type: "sequencing", instruction: "Ordena de menor a mayor: 3/4, 1/4, 1/2.", objectives: ["o4"], response: "order", answer_area: "line", answer: { basis: "inferred", value: "1/4, 1/2, 3/4" }, difficulty: "low", confidence: 0.95 },
        { id: "a5", label: "5", page: 1, type: "open_question", instruction: "Explica en 3 líneas cómo sabes que 2/4 y 1/2 son equivalentes.", resources: ["v2"], objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.9 },
      ],
      protected: [
        { type: "target_operation", importance: "essential", value: "Suma de fracciones de igual denominador", activities: ["a3"], resources: [] },
        { type: "necessary_visual", importance: "essential", value: "Figura dividida en 4 partes iguales", activities: ["a1"], resources: ["v1"] },
        { type: "necessary_visual", importance: "essential", value: "Tiras de fracciones", activities: ["a2"], resources: ["v2"] },
        { type: "concept", importance: "essential", value: "Fracciones equivalentes", activities: ["a2", "a5"], resources: [] },
        { type: "reasoning_constraint", importance: "essential", value: "Ordenar de menor a mayor", activities: ["a4"], resources: [] },
        { type: "response_constraint", importance: "important", value: "Explicar en 3 líneas", activities: ["a5"], resources: [] },
      ],
      uncertainties: [],
      quality: { confidence: 0.94, readability: "good" },
    },
    1,
  );
}

/** ESO · Geografía: one table, two charts, calculations, a scenario condition and a conclusion with requirements. */
export function geographyAnalysis(): MaterialAnalysis {
  return toAnalysis(
    {
      identification: { title: "Población y movilidad en Valdeloma", language: "es", stage: "eso", grade: "3-eso", subject: "Geografía e Historia", topic: "Demografía y movilidad urbana", confidence: { stage: 0.97, grade: 0.95, subject: 0.97, topic: 0.9 } },
      intent: {
        purpose: "Analizar la evolución de la población, su estructura por edades y los modos de desplazamiento a partir de una tabla y dos gráficos.",
        objectives: [
          { id: "o1", text: "Calcular el crecimiento absoluto y relativo de la población" },
          { id: "o2", text: "Interpretar la estructura por edades y justificar el envejecimiento" },
          { id: "o3", text: "Comparar modos de desplazamiento en puntos porcentuales" },
          { id: "o4", text: "Proponer medidas apoyadas en datos" },
          { id: "o5", text: "Redactar una conclusión que relacione población, edades y movilidad con datos" },
        ],
        knowledge: ["Crecimiento de la población", "Envejecimiento", "Puntos porcentuales", "Movilidad urbana"],
        prerequisites: ["Cálculo de porcentajes", "Lectura de gráficos"],
        difficulty: "medium",
      },
      sections: [
        { id: "s1", title: "Documentos", page_start: 1, page_end: 1 },
        { id: "s2", title: "Actividades", page_start: 2, page_end: 2 },
      ],
      texts: [
        { id: "c1", kind: "reading_text", page: 1, text: "El ayuntamiento de Valdeloma ha reunido estos datos para estudiar cómo cambian su población y la forma en que se desplazan sus vecinos. El municipio es ficticio." },
        { id: "c2", kind: "note", page: 1, text: "Nota: cada persona indica un único modo principal de desplazamiento. Los porcentajes suman 100 %." },
      ],
      visuals: [
        { id: "v1", kind: "table", page: 1, role: "required", title: "Documento 1. Habitantes", description: "", table: { headers: ["Año", "2012", "2017", "2022"], rows: [["Habitantes", "45.200", "48.900", "52.300"]] } },
        { id: "v2", kind: "chart", page: 1, role: "required", title: "Documento 2. Población por edades (2022)", description: "Barras horizontales.", chart: { type: "bar", categories: ["0-14 años", "15-64 años", "65 años o más"], series: [{ name: "Población 2022", values: [13, 63, 24] }], unit: "%" } },
        { id: "v3", kind: "chart", page: 1, role: "required", title: "Documento 3. Modo principal de desplazamiento (2022)", description: "Barras verticales.", chart: { type: "bar", categories: ["Coche", "Autobús", "A pie", "Bicicleta", "Tren"], series: [{ name: "", values: [38, 22, 20, 8, 12] }], unit: "%" } },
        { id: "v4", kind: "decorative", page: 1, role: "decorative", description: "Marco con iconos de edificios." },
      ],
      admin: [
        { type: "student_name", label: "Nombre y apellidos", page: 1 },
        { type: "date", label: "Fecha", page: 1 },
        { type: "student_name", label: "Nombre y apellidos", page: 2 },
      ],
      activities: [
        { id: "a1", label: "1", page: 2, type: "calculation", instruction: "Calcula cuánto creció la población entre 2012 y 2022, primero en habitantes y después en porcentaje aproximado respecto a 2012.", resources: ["v1"], objectives: ["o1"], response: "calculate", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "7.100 habitantes; aproximadamente un 15,7 %" }, difficulty: "medium", confidence: 0.95 },
        { id: "a2", label: "2", page: 2, type: "open_question", instruction: "A partir del documento 2, explica por qué se puede hablar de envejecimiento de la población. No basta con copiar un porcentaje.", resources: ["v2"], objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.93 },
        { id: "a3", label: "3", page: 2, type: "calculation", instruction: "Compara el uso del coche con la movilidad activa (a pie + bicicleta). ¿Qué diferencia hay en puntos porcentuales?", resources: ["v3"], objectives: ["o3"], response: "calculate", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "38 % frente a 28 %: 10 puntos porcentuales" }, difficulty: "low", confidence: 0.95 },
        { id: "a4", label: "4", page: 2, type: "problem_solving", instruction: "El ayuntamiento quiere reducir el uso del coche en 8 puntos porcentuales sin reducir el número total de desplazamientos. Propón una medida concreta y explica qué dato de los documentos la apoya.", resources: ["v3"], objectives: ["o3", "o4"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "high", confidence: 0.9 },
        { id: "a5", label: "5", page: 2, type: "writing", instruction: "Redacta una conclusión de 4-5 líneas que relacione el crecimiento de la población, la estructura por edades y la movilidad. Usa al menos dos datos numéricos de los documentos.", resources: ["v1", "v2", "v3"], objectives: ["o5"], response: "write_text", answer_area: "lines", answer_lines: 5, difficulty: "high", confidence: 0.92 },
      ],
      protected: [
        { type: "target_operation", importance: "essential", value: "Crecimiento absoluto y porcentual entre 2012 y 2022", activities: ["a1"], resources: ["v1"] },
        { type: "reasoning_constraint", importance: "essential", value: "No basta con copiar un porcentaje", activities: ["a2"], resources: [] },
        { type: "units_or_magnitudes", importance: "essential", value: "Diferencia en puntos porcentuales", activities: ["a3"], resources: [] },
        { type: "reasoning_constraint", importance: "essential", value: "Reducir el coche 8 puntos porcentuales sin reducir el número total de desplazamientos", activities: ["a4"], resources: [] },
        { type: "response_constraint", importance: "essential", value: "Una medida concreta y un dato que la apoye", activities: ["a4"], resources: [] },
        { type: "response_constraint", importance: "essential", value: "Conclusión de 4-5 líneas con al menos dos datos numéricos", activities: ["a5"], resources: [] },
        { type: "necessary_visual", importance: "essential", value: "Tabla y gráficos con sus valores", activities: [], resources: ["v1", "v2", "v3"] },
        { type: "required_data", importance: "important", value: "Un único modo principal por persona; los porcentajes suman 100 %", activities: ["a3", "a4"], resources: ["c2"] },
      ],
      uncertainties: [],
      quality: { confidence: 0.93, readability: "good" },
    },
    2,
  );
}

const SOURCE_TEXT = [
  "Durante años se anunció que las bibliotecas públicas desaparecerían con la llegada de internet. Si cualquier libro o artículo puede consultarse desde casa, ¿para qué desplazarse a un edificio lleno de estanterías? Sin embargo, las cifras de visitas en muchas ciudades no han dejado de crecer.",
  "Una biblioteca ya no es solo un almacén de libros. Es un lugar de estudio silencioso para quien no lo tiene en casa, un espacio con conexión gratuita, un punto de encuentro para clubes de lectura y talleres, y un servicio que orienta a quien no sabe por dónde empezar a buscar información fiable.",
  "No obstante, mantener ese papel exige algo más que conservar los fondos. Los horarios, la renovación de los espacios y la formación del personal determinan si una biblioteca sigue siendo útil o se convierte en un lugar al que solo acude un público fiel.",
  "Por eso, la pregunta no es si las bibliotecas tienen sentido en la era digital, sino qué necesitan para seguir cumpliendo una función que ningún buscador sustituye: garantizar que cualquier persona, tenga los recursos que tenga, pueda acceder al conocimiento.",
].join("\n\n");

/** Bachillerato · Lengua: a source text that is itself analysed, comprehension, thesis, connector, register and an argumentative essay. */
export function argumentationAnalysis(): MaterialAnalysis {
  return toAnalysis(
    {
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
        knowledge: ["Resumen", "Tesis y argumentos", "Conectores", "Registro", "Texto argumentativo"],
        prerequisites: ["Comprensión lectora de textos argumentativos"],
        difficulty: "medium",
      },
      sections: [
        { id: "s1", title: "Texto", page_start: 1, page_end: 1 },
        { id: "s2", title: "Escritura argumentativa", page_start: 2, page_end: 2 },
      ],
      texts: [
        { id: "c1", kind: "reading_text", page: 1, text: SOURCE_TEXT },
        { id: "c2", kind: "note", page: 1, text: "Texto elaborado para esta actividad." },
      ],
      visuals: [],
      admin: [
        { type: "student_name", label: "Nombre y apellidos", page: 1 },
        { type: "date", label: "Fecha", page: 1 },
      ],
      activities: [
        { id: "a1", label: "1", page: 1, type: "writing", instruction: "Resume el texto en 60-80 palabras sin copiar frases completas.", resources: ["c1"], objectives: ["o1"], response: "write_text", answer_area: "lines", answer_lines: 4, difficulty: "medium", confidence: 0.95 },
        { id: "a2", label: "2", page: 1, type: "open_question", instruction: "Formula con tus palabras la tesis del texto y señala dos argumentos que la apoyen.", resources: ["c1"], objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.95 },
        { id: "a3", label: "3", page: 1, type: "short_answer", instruction: "Explica qué relación introduce el conector «No obstante» al comienzo del tercer párrafo.", resources: ["c1"], objectives: ["o3"], response: "write_text", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "Oposición o contraste" }, difficulty: "low", confidence: 0.95 },
        { id: "a4", label: "4", page: 2, type: "short_answer", instruction: "Indica si predomina un registro formal o informal y justifícalo con dos rasgos lingüísticos del texto.", resources: ["c1"], objectives: ["o4"], response: "write_text", answer_area: "lines", answer_lines: 2, difficulty: "medium", confidence: 0.95 },
        { id: "a5", label: "5", page: 2, section: "s2", type: "writing", instruction: "Redacta un texto argumentativo de 150-180 palabras sobre esta cuestión: «¿Deberían las bibliotecas abrir también por la noche?». Incluye una tesis, al menos dos argumentos y una conclusión.", objectives: ["o5"], response: "write_text", answer_area: "lines", answer_lines: 12, difficulty: "high", confidence: 0.95 },
      ],
      protected: [
        { type: "response_constraint", importance: "essential", value: "Resumen de 60-80 palabras sin copiar frases completas", activities: ["a1"], resources: [] },
        { type: "response_constraint", importance: "essential", value: "Tesis con palabras propias y dos argumentos", activities: ["a2"], resources: [] },
        { type: "concept", importance: "essential", value: "Conector «No obstante» al inicio del tercer párrafo", activities: ["a3"], resources: [] },
        { type: "response_constraint", importance: "essential", value: "Justificar el registro con dos rasgos lingüísticos", activities: ["a4"], resources: [] },
        { type: "response_constraint", importance: "essential", value: "150-180 palabras con tesis, al menos dos argumentos y conclusión", activities: ["a5"], resources: [] },
        { type: "required_data", importance: "essential", value: "Texto base", activities: ["a1", "a2", "a3", "a4"], resources: ["c1"] },
        { type: "format_requirement", importance: "important", value: "Organizar el texto en párrafos", activities: ["a5"], resources: [] },
        { type: "required_vocabulary", importance: "important", value: "tesis, argumento, conector, registro", activities: ["a2", "a3", "a4"], resources: [] },
      ],
      uncertainties: [],
      quality: { confidence: 0.95, readability: "good" },
    },
    2,
  );
}
