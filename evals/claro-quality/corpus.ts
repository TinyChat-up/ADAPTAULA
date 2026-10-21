import { MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { VisualSpec } from "@/lib/visuals/spec";

const trace = { origin: "original" as const, source_refs: [], decision_ids: [] };
const activity = (id: string, label: string, prompt: string, lines: number, refs: string[] = []): Block => ({ id, type: "activity", label, prompt, response: { kind: "lines", lines }, resource_block_ids: refs, trace });
const figure = (id: string, spec: VisualSpec): Block => ({ id, type: "image", source: { kind: "figure", provenance: "reconstruction", spec }, alt_text: "Figura de la actividad", trace });
const table = (id: string, headers: string[], rows: string[][], unit?: string): Block => ({ id, type: "table", headers, rows, ...(unit ? { unit } : {}), trace });
const title = (text: string): Block => ({ id: "blk_title", type: "heading", level: 1, text, trace });
const section = (text: string): Block => ({ id: "blk_section", type: "heading", level: 2, text, trace });

export interface QualityCase {
  id: string;
  split: "development" | "reserve";
  objective: string;
  document: MaterialDocument;
  /** Manually authored oracle, never inferred from the generated document or its alt text. */
  reference: {
    tasks: { id: string; instruction: string; resources: string[]; lines: number }[];
    figures: { id: string; spec?: VisualSpec; markers?: string[]; pixelCheck?: string }[];
    tables: { id: string; unit?: string; headers: string[]; rows: string[][] }[];
    preserved: string[];
    forbidden: string[];
    humanReview: string;
  };
}
function document(name: string, grade: number, subject: string, blocks: Block[], answers: string[]): MaterialDocument {
  const tasks = blocks.filter(b => b.type === "activity");
  return MaterialDocumentSchema.parse({ schema_version: 1,
    meta: { title: name, language: "es", stage: "primaria", grade: `${grade}-primaria`, subject, topic: name },
    presentation: { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "high", decoration: "none", max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: false },
    admin_fields: [{ type: "student_name", label: "Nombre" }, { type: "date", label: "Fecha" }],
    pages: [{ blocks: [title(name), ...blocks] }],
    answer_key: answers.map((value, i) => ({ block_id: tasks[i]!.id, basis: "source", value })),
    teacher_notes: "Caso sintético original, escrito a mano. Pendiente de evaluación por un docente."
  });
}

// Freeze these eight cases before changing rules. Reserve cases are run only after implementation is frozen.
export const qualityCorpus: QualityCase[] = [
  { id: "01-fracciones", split: "development", objective: "Leer fracciones como partes iguales de un todo y justificar una comparación.",
    document: document("Compartimos una barra", 3, "matematicas", [
      figure("blk_bar1", { spec_version: 1, kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] }),
      section("Observa las partes iguales"),
      activity("blk_task1", "1", "Observa la barra. Escribe la fracción sombreada y explica qué indican sus dos números.", 4, ["blk_bar1"]),
      activity("blk_task2", "2", "Sin colorear la barra, explica si la parte sombreada es menor, igual o mayor que la mitad. Justifica tu respuesta.", 4),
    ], ["La fracción sombreada es 3/8.", "Es menor que la mitad porque tres partes son menos que cuatro."]),
    reference: { tasks: [
      { id: "blk_task1", instruction: "Observa la barra. Escribe la fracción sombreada y explica qué indican sus dos números.", resources: ["blk_bar1"], lines: 4 },
      { id: "blk_task2", instruction: "Sin colorear la barra, explica si la parte sombreada es menor, igual o mayor que la mitad. Justifica tu respuesta.", resources: [], lines: 4 }],
      figures: [{ id: "blk_bar1", spec: { spec_version: 1, kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } }], tables: [], preserved: ["mitad"], forbidden: ["La fracción sombreada es 3/8.", "Es menor que la mitad porque"], humanReview: "Adecuación de la explicación y del espacio para 3.º; no se resuelve la comparación." } },
  { id: "02-problemas", split: "reserve", objective: "Organizar datos, decidir operaciones y expresar resultados con unidades.",
    document: document("Material para el huerto", 4, "matematicas", [
      { id: "blk_data", type: "paragraph", text: "El grupo tiene 6 bolsas de tierra de 12 kg cada una. Utiliza 45 kg para preparar los bancales. Para regar dispone de una garrafa con 18 L y otra con 7 L.", trace },
      activity("blk_task1", "1", "¿Cuánta tierra queda después de preparar los bancales? Anota los datos necesarios, decide las operaciones y explica tu razonamiento con unidades.", 6, ["blk_data"]),
      activity("blk_task2", "2", "Se necesitan 30 L para el primer riego. ¿Basta con el agua disponible? Justifica tu decisión e indica la cantidad que sobra o falta.", 5),
    ], ["Quedan 27 kg de tierra.", "Faltan 5 L de agua."]),
    reference: { tasks: [
      { id: "blk_task1", instruction: "¿Cuánta tierra queda después de preparar los bancales? Anota los datos necesarios, decide las operaciones y explica tu razonamiento con unidades.", resources: ["blk_data"], lines: 6 },
      { id: "blk_task2", instruction: "Se necesitan 30 L para el primer riego. ¿Basta con el agua disponible? Justifica tu decisión e indica la cantidad que sobra o falta.", resources: [], lines: 5 }], figures: [], tables: [], preserved: ["6 bolsas", "12 kg", "45 kg", "18 L", "7 L", "30 L"], forbidden: ["Quedan 27 kg", "Faltan 5 L"], humanReview: "Demanda de razonamiento y claridad de los datos; la revisión automática no juzga estrategias." } },
  { id: "03-rectas", split: "development", objective: "Interpretar intervalos iguales y distancias sin alterar escala ni unidades.",
    document: document("Medimos un recorrido", 5, "matematicas", [
      figure("blk_line", { spec_version: 1, kind: "number_line", start: { n: 100, d: 1 }, end: { n: 124, d: 1 }, divisions: 24, labels: Array.from({ length: 25 }, (_, tick) => ({ tick, text: String(100 + tick) })) }),
      activity("blk_task1", "1", "La recta representa metros desde la salida. ¿Qué distancia hay entre las marcas 103 y 117? Explica cómo lo sabes.", 4, ["blk_line"]),
      activity("blk_task2", "2", "Un corredor está en la marca 108 y avanza 9 m. Indica en qué marca termina y describe el recorrido.", 4),
    ], ["La distancia es 14 m.", "Termina en la marca 117."]),
    reference: { tasks: [
      { id: "blk_task1", instruction: "La recta representa metros desde la salida. ¿Qué distancia hay entre las marcas 103 y 117? Explica cómo lo sabes.", resources: ["blk_line"], lines: 4 },
      { id: "blk_task2", instruction: "Un corredor está en la marca 108 y avanza 9 m. Indica en qué marca termina y describe el recorrido.", resources: [], lines: 4 }], figures: [{ id: "blk_line", spec: { spec_version: 1, kind: "number_line", start: { n: 100, d: 1 }, end: { n: 124, d: 1 }, divisions: 24, labels: Array.from({ length: 25 }, (_, i) => ({ tick: i, text: `${100 + i}` })) } }], tables: [], preserved: ["metros", "103", "117", "108", "9 m"], forbidden: ["La distancia es 14 m.", "Termina en la marca 117."], humanReview: "Legibilidad de la escala densa y pertinencia curricular; no confundir un valor de escala con una respuesta revelada." } },
  { id: "04-lectura", split: "reserve", objective: "Localizar información, ordenar hechos e inferir una intención apoyándose en el relato.",
    document: document("La caja de semillas", 3, "lengua", [
      { id: "blk_story", type: "reading_text", literal: true, paragraphs: [
        "El martes, Nora llevó al aula una caja de semillas que había guardado durante el verano. Quería sembrarlas en el patio, pero la tierra estaba seca y dura. Antes de abrir la caja, pidió al grupo que observara el terreno.",
        "Álex propuso hacer agujeros enseguida. Nora señaló las grietas y buscó una regadera. Entre todos humedecieron la tierra y esperaron hasta después del recreo. Entonces pudieron removerla sin esfuerzo.",
        "Cada pareja sembró tres semillas. Nora dejó algunas en la caja y escribió la fecha en una etiqueta. Cuando Álex preguntó por qué no las habían usado todas, ella miró el cielo nublado y respondió: «Nos vendrán bien si tenemos que volver a intentarlo».",
      ], trace },
      activity("blk_task1", "1", "¿Qué hizo el grupo antes de remover la tierra? Escribe dos acciones en el orden en que sucedieron.", 3, ["blk_story"]),
      activity("blk_task2", "2", "¿Por qué crees que Nora guardó algunas semillas? Explica tu idea y señala una frase del relato que la apoye.", 5),
    ], ["Primero humedecieron la tierra y después esperaron.", "Nora se preparó para una posible nueva siembra."]),
    reference: { tasks: [
      { id: "blk_task1", instruction: "¿Qué hizo el grupo antes de remover la tierra? Escribe dos acciones en el orden en que sucedieron.", resources: ["blk_story"], lines: 3 },
      { id: "blk_task2", instruction: "¿Por qué crees que Nora guardó algunas semillas? Explica tu idea y señala una frase del relato que la apoye.", resources: [], lines: 5 }], figures: [], tables: [], preserved: ["El martes, Nora", "Cada pareja sembró tres semillas.", "Nos vendrán bien si tenemos que volver a intentarlo"], forbidden: ["Primero humedecieron la tierra y después esperaron.", "Nora se preparó para una posible nueva siembra."], humanReview: "Relato íntegro, inferencia abierta y ausencia de pistas que anticipen la conclusión." } },
  { id: "05-clasificacion", split: "development", objective: "Distinguir sustantivos, adjetivos y verbos a partir de su uso en una oración.",
    document: document("Las palabras en contexto", 5, "lengua", [
      { id: "blk_sentence", type: "paragraph", text: "La jardinera paciente cuida las flores pequeñas. Los pájaros cantan y el viento suave mueve las hojas.", trace },
      table("blk_table", ["Sustantivos", "Adjetivos", "Verbos"], [["", "", ""], ["", "", ""], ["", "", ""]]),
      { id: "blk_task1", type: "activity", label: "1", prompt: "Clasifica estas palabras según su uso en el texto: jardinera, paciente, cuida, flores, pequeñas, cantan, viento, suave, mueve. Escribe cada palabra una sola vez en la tabla.", resource_block_ids: ["blk_table"], response: { kind: "table_cells" }, trace },
      activity("blk_task2", "2", "Elige una palabra de cada columna y explica qué aporta a la oración en la que aparece.", 5),
    ], ["Sustantivos: jardinera, flores, viento.", "La clasificación debe justificarse por el contexto."]),
    reference: { tasks: [
      { id: "blk_task1", instruction: "Clasifica estas palabras según su uso en el texto: jardinera, paciente, cuida, flores, pequeñas, cantan, viento, suave, mueve. Escribe cada palabra una sola vez en la tabla.", resources: ["blk_table"], lines: 0 },
      { id: "blk_task2", instruction: "Elige una palabra de cada columna y explica qué aporta a la oración en la que aparece.", resources: [], lines: 5 }], figures: [], tables: [{ id: "blk_table", headers: ["Sustantivos", "Adjetivos", "Verbos"], rows: [["", "", ""], ["", "", ""], ["", "", ""]] }], preserved: ["La jardinera paciente cuida las flores pequeñas.", "jardinera, paciente, cuida, flores, pequeñas, cantan, viento, suave, mueve"], forbidden: ["Sustantivos: jardinera, flores, viento."], humanReview: "Adecuación lingüística y espacio real para escribir tres palabras por categoría." } },
  { id: "06-planta", split: "development", objective: "Identificar raíz, tallo y hojas y explicar una función sin rótulos resolutivos.",
    document: document("Observamos una planta", 3, "ciencias-naturales", [
      { id: "blk_plant", type: "image", source: { kind: "original", visual_ref: "vis_1" }, alt_text: "Esquema de una planta", trace },
      activity("blk_task1", "1", "Observa el esquema de la planta. Escribe el nombre de las partes señaladas con los números 1, 2 y 3.", 3, ["blk_plant"]),
      activity("blk_task2", "2", "Elige una de esas partes. Explica para qué le sirve a la planta y qué podría ocurrir si se dañara.", 5),
    ], ["1: hojas; 2: tallo; 3: raíz.", "La función debe relacionarse con la parte elegida."]),
    reference: { tasks: [
      { id: "blk_task1", instruction: "Observa el esquema de la planta. Escribe el nombre de las partes señaladas con los números 1, 2 y 3.", resources: ["blk_plant"], lines: 3 },
      { id: "blk_task2", instruction: "Elige una de esas partes. Explica para qué le sirve a la planta y qué podría ocurrir si se dañara.", resources: [], lines: 5 }], figures: [{ id: "blk_plant", markers: ["1", "2", "3"], pixelCheck: "Comprobar visualmente que 1 termina en hoja, 2 en tallo y 3 en raíz. El PNG no es una prueba estructural." }], tables: [], preserved: ["1, 2 y 3"], forbidden: ["1: hojas", "2: tallo", "3: raíz"], humanReview: "Identidad botánica, destino de las líneas y claridad de los marcadores: siempre sin verificar automáticamente." } },
  { id: "07-informacion", split: "reserve", objective: "Leer una tabla de distancias y justificar decisiones sin confundir unidades.",
    document: document("Recorridos por el municipio", 4, "ciencias-sociales", [
      table("blk_distances", ["Destino desde la escuela", "Distancia"], [["Biblioteca", "450"], ["Centro de salud", "800"], ["Parque", "650"]], "m"),
      activity("blk_task1", "1", "Consulta la tabla. Ordena los destinos del más cercano al más lejano e incluye las distancias con su unidad.", 4, ["blk_distances"]),
      activity("blk_task2", "2", "El grupo puede caminar hasta 700 m desde la escuela. ¿Qué destinos cumplen esa condición? Explica cómo los has elegido.", 4),
    ], ["Orden: biblioteca, parque, centro de salud.", "Pueden ir a la biblioteca y al parque."]),
    reference: { tasks: [
      { id: "blk_task1", instruction: "Consulta la tabla. Ordena los destinos del más cercano al más lejano e incluye las distancias con su unidad.", resources: ["blk_distances"], lines: 4 },
      { id: "blk_task2", instruction: "El grupo puede caminar hasta 700 m desde la escuela. ¿Qué destinos cumplen esa condición? Explica cómo los has elegido.", resources: [], lines: 4 }], figures: [], tables: [{ id: "blk_distances", unit: "m", headers: ["Destino desde la escuela", "Distancia"], rows: [["Biblioteca", "450"], ["Centro de salud", "800"], ["Parque", "650"]] }], preserved: ["700 m"], forbidden: ["Orden: biblioteca, parque, centro de salud.", "Pueden ir a la biblioteca y al parque."], humanReview: "Comprensión de la condición y justificación; tabla no representa un mapa ni un recorrido real." } },
  { id: "08-cuadricula", split: "reserve", objective: "Relacionar fracciones, áreas discretas y operaciones conservando el mismo todo.",
    document: document("Un huerto en cuadrícula", 6, "matematicas", [
      figure("blk_grid", { spec_version: 1, kind: "grid", rows: 4, cols: 6, shaded: [0, 1, 2, 6, 7, 8] }),
      activity("blk_task1", "1", "Cada casilla de la cuadrícula tiene 2 m². La zona sombreada está sembrada. Escribe la fracción sembrada del huerto y calcula su superficie. Explica ambas respuestas.", 5, ["blk_grid"]),
      figure("blk_circle", { spec_version: 1, kind: "part_whole", shape: "circle", parts: 4, shaded: [0] }),
      activity("blk_task2", "2", "El círculo representa el huerto completo. ¿Muestra la misma fracción sembrada que la cuadrícula? Justifica la equivalencia sin cambiar las figuras.", 4, ["blk_circle"]),
    ], ["La fracción sembrada es 6/24 y su superficie es 12 m².", "Sí: 6/24 equivale a 1/4."]),
    reference: { tasks: [
      { id: "blk_task1", instruction: "Cada casilla de la cuadrícula tiene 2 m². La zona sombreada está sembrada. Escribe la fracción sembrada del huerto y calcula su superficie. Explica ambas respuestas.", resources: ["blk_grid"], lines: 5 },
      { id: "blk_task2", instruction: "El círculo representa el huerto completo. ¿Muestra la misma fracción sembrada que la cuadrícula? Justifica la equivalencia sin cambiar las figuras.", resources: ["blk_circle"], lines: 4 }], figures: [
        { id: "blk_grid", spec: { spec_version: 1, kind: "grid", rows: 4, cols: 6, shaded: [0, 1, 2, 6, 7, 8] } },
        { id: "blk_circle", spec: { spec_version: 1, kind: "part_whole", shape: "circle", parts: 4, shaded: [0] } }], tables: [], preserved: ["2 m²"], forbidden: ["La fracción sembrada es 6/24", "Sí: 6/24 equivale a 1/4."], humanReview: "Adecuación del razonamiento sobre equivalencia y áreas; no basta con que los datos coincidan." } },
];
