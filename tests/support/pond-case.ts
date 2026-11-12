import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis } from "@/lib/schemas/material-analysis";

/**
 * «Un estanque en equilibrio» (5.º de Primaria, Ciencias): the analysis of the real sheet that «Hacer magia» delivered badly ordered
 * (final review before the activities, «Lee el texto con atención» after the reading, the components of activity 2 alone on page 1,
 * the statement of activity 5 printed twice, 4a and 4b on different pages). Same ids, pages, sections, links and words as the stored
 * analysis; the answers stay out (`not_inferable`), as in the real one. It is the teacher's own test sheet, not a student's data.
 */
const COMPONENTS = "Algas · Agua · Larvas de insectos · Luz solar · Garzas · Temperatura";
const STATEMENT = "«Si disminuye el agua del estanque, todos sus seres vivos se ven afectados exactamente de la misma manera».";
const READING =
  "En un estanque situado junto al pueblo viven algas, plantas acuáticas, larvas de insectos, ranas y garzas. La luz del sol permite que las algas y las plantas crezcan. Algunas larvas se alimentan de algas; las ranas comen insectos y sus larvas; y las garzas pueden alimentarse de ranas. El agua, la luz y la temperatura también influyen en la vida del estanque.\n\n" +
  "En mayo, la profundidad del agua en una zona del estanque era de 30 centímetros. Después de varias semanas sin lluvia, en junio bajó a 18 centímetros. Algunas plantas quedaron fuera del agua, hubo menos lugares donde refugiarse y se observaron menos larvas en la orilla.\n\n" +
  "Un grupo de estudiantes quiere averiguar cómo afecta ese cambio a los seres vivos. Para ello, observa el estanque, compara datos y piensa en posibles relaciones entre sus componentes.";

type Activity = MaterialAnalysis["activities"][number];
const base = { confidence: 0.93, difficulty: "medium" as const, response: "write_text" as const, answer_area: "lines" as const, answer_lines: 2 };

export function pondAnalysis(): MaterialAnalysis {
  const draft = MaterialAnalysisDraftSchema.parse({
    identification: { title: "Un estanque en equilibrio", language: "es", stage: "primaria", grade: "5-primaria", subject: "Ciencias de la Naturaleza", topic: "Seres vivos y cambios en un ecosistema", confidence: { stage: 0.95, grade: 0.95, subject: 0.95, topic: 0.9 } },
    intent: {
      purpose: "Leer, clasificar, interpretar relaciones y razonar con datos científicos del estanque.",
      objectives: [
        { id: "o1", text: "Identificar cambios a partir del texto" },
        { id: "o2", text: "Clasificar componentes del estanque" },
        { id: "o3", text: "Interpretar relaciones alimentarias y sus consecuencias" },
        { id: "o4", text: "Calcular una variación con datos" },
        { id: "o5", text: "Valorar afirmaciones y proponer una medida" },
      ],
      knowledge: ["Seres vivos y elementos no vivos", "Cadenas alimentarias"],
      prerequisites: [],
      difficulty: "medium",
    },
    sections: [
      { id: "s1", title: "Lee el texto con atención", page_start: 1, page_end: 1 },
      { id: "s2", title: "Actividades de lectura y clasificación", page_start: 1, page_end: 1 },
      { id: "s3", title: "Aplica lo aprendido: Relaciones y cambios en el estanque", page_start: 2, page_end: 2 },
    ],
    texts: [
      { id: "t1", kind: "reading_text", page: 1, text: READING, section: "s1" },
      { id: "t2", kind: "instruction", page: 1, text: "Lee el texto con atención", section: "s1" },
      { id: "t3", kind: "other", page: 1, text: COMPONENTS, section: "s2" },
      { id: "t4", kind: "instruction", page: 2, text: "Continúa trabajando a partir de la lectura de la página anterior.", section: "s3" },
      { id: "t5", kind: "other", page: 2, text: STATEMENT, section: "s3" },
    ],
    visuals: [
      { id: "v1", kind: "table", page: 1, role: "required", title: "Clasificación de componentes", description: "Tabla de dos columnas con tres filas vacías para clasificar los componentes.", section: "s2", table: { headers: ["SERES VIVOS", "ELEMENTOS NO VIVOS"], rows: [["", ""], ["", ""], ["", ""]] } },
      { id: "v2", kind: "diagram", page: 2, role: "required", title: "Relación alimentaria del estanque", description: "Esquema de cuatro recuadros unidos por flechas: Algas → Larvas de insectos → Ranas → Garzas.", text: "ALGAS → LARVAS DE INSECTOS → RANAS → GARZAS", section: "s3" },
      { id: "v3", kind: "table", page: 2, role: "required", title: "Nivel del agua", description: "Tabla que compara la profundidad del agua en mayo y junio.", section: "s3", table: { headers: ["MAYO", "JUNIO"], rows: [["30 cm de profundidad", "18 cm de profundidad"]] } },
    ],
    admin: [{ type: "student_name", label: "Nombre", page: 1 }, { type: "date", label: "Fecha", page: 1 }],
    activities: [
      { id: "a1", label: "1", page: 1, type: "short_answer", instruction: "Identifica dos cambios ocurridos en el estanque entre mayo y junio. Escribe cada cambio y señala qué información del texto te ha permitido identificarlo.", resources: ["t1"], objectives: ["o1"], section: "s2", ...base, answer_lines: 4, confidence: 0.95 },
      { id: "a2", label: "2", page: 1, type: "classification", instruction: "Clasifica estos componentes del estanque.", context: COMPONENTS, resources: ["v1", "t3"], objectives: ["o2"], section: "s2", ...base, answer_area: "table_cells", difficulty: "low", confidence: 0.95 },
      { id: "a3", label: "3a", page: 2, type: "short_answer", instruction: "Explica qué indican las flechas del esquema.", resources: ["v2"], objectives: ["o3"], section: "s3", ...base },
      { id: "a4", label: "3b", page: 2, type: "open_question", instruction: "¿Qué podría ocurrir con las ranas si disminuyeran mucho las larvas? Justifica tu predicción.", resources: ["v2", "t1"], objectives: ["o3"], section: "s3", ...base },
      { id: "a5", label: "4a", page: 2, type: "calculation", instruction: "¿Cuántos centímetros descendió el nivel del agua? Escribe la operación.", resources: ["v3"], objectives: ["o4"], section: "s3", ...base, response: "calculate", answer_area: "line", answer_lines: 1, difficulty: "low", confidence: 0.95 },
      { id: "a6", label: "4b", page: 2, type: "open_question", instruction: "Explica una consecuencia posible de ese descenso para los seres vivos del estanque.", resources: ["t1", "v3"], objectives: ["o3"], section: "s3", ...base },
      { id: "a7", label: "5", page: 2, type: "open_question", instruction: "Valora esta afirmación y justifica tu respuesta. ¿Estás de acuerdo? Usa información del texto para defender tu respuesta.", context: STATEMENT, resources: ["t1", "t5"], objectives: ["o5"], section: "s3", ...base, difficulty: "high", confidence: 0.92 },
      { id: "a8", label: "6", page: 2, type: "open_question", instruction: "Propón una medida para proteger el estanque. Explica cómo podría ayudar a algún ser vivo y a un elemento no vivo del ecosistema.", resources: [], objectives: ["o5"], section: "s3", ...base, difficulty: "high", confidence: 0.92 },
    ],
    protected: [
      { type: "concept", importance: "essential", value: "Significado de las flechas en una cadena alimentaria", activities: ["a3"], resources: ["v2"] },
      { type: "target_operation", importance: "essential", value: "Restar los niveles del agua de mayo y junio", activities: ["a5"], resources: ["v3"] },
    ],
    uncertainties: [],
    quality: { confidence: 0.94, readability: "good" },
  });
  return normalizeAnalysis(draft, { pageCount: 2 }).analysis;
}

export const POND = { COMPONENTS, STATEMENT, READING } as const;
export type PondActivity = Activity;
