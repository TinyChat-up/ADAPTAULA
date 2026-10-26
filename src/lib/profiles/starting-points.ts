import { findPreset, type ProfilePreset } from "./presets";
import type { DimensionKey, FunctionalProfile, SupportLevel } from "@/lib/schemas/functional-profile";

/** New cards map to the existing dimensions. Preset IDs remain internal and are never stored on a learner. */
export const STARTING_POINTS = [
  { id: "visual-understanding", title: "Comprender con imágenes y ejemplos", description: "Representaciones relevantes y ejemplos guiados para hacer visibles las ideas.", example: "Comprender un proceso con un esquema sencillo.", icon: "images", supports: { visual_support: "medium", worked_examples: "medium", background_knowledge_support: "low" } },
  { id: "reading", title: "Leer y comprender textos", description: "Textos organizados y claves para seguir la lectura.", example: "Localizar la idea importante de un párrafo.", icon: "book", preset: "dislexia" },
  { id: "language", title: "Entender y expresar ideas", description: "Vocabulario explicado y ayudas para comunicar lo que sabe.", example: "Empezar una respuesta con una frase de apoyo.", icon: "message", preset: "lenguaje" },
  { id: "attention", title: "Mantener la atención y organizarse", description: "Prioridades visibles y menos información a la vez.", example: "Completar una tarea con una lista de comprobación.", icon: "list", preset: "tdah" },
  { id: "math", title: "Comprender números y operaciones", description: "Representaciones y pasos que acompañan el razonamiento.", example: "Seguir una operación sin perder el procedimiento.", icon: "math", preset: "discalculia" },
  { id: "instructions", title: "Comprender instrucciones y anticipar pasos", description: "Expectativas explícitas y una secuencia predecible.", example: "Saber qué hacer primero y qué viene después.", icon: "route", preset: "tea" },
  { id: "visual-access", title: "Ver la información con claridad", description: "Letra, contraste y alternativas para acceder al contenido.", example: "Leer rótulos ampliados y disponer de una descripción.", icon: "eye", preset: "visual" },
  { id: "hearing", title: "Acceder a las explicaciones", description: "Información por escrito y apoyos que no dependan solo del audio.", example: "Consultar por escrito una explicación de clase.", icon: "captions", preset: "auditiva" },
  { id: "response", title: "Escribir y responder a actividades", description: "Menos copia y otras formas de mostrar lo aprendido, si la tarea lo permite.", example: "Responder con teclado o seleccionar una opción.", icon: "pen", preset: "motrices" },
  { id: "load", title: "Regular la carga y los estímulos", description: "Páginas despejadas y un ritmo de trabajo más predecible.", example: "Usar pocas imágenes relevantes en lugar de muchos adornos.", icon: "leaf", supports: { visual_density: "medium", visual_distraction_reduction: "medium", number_of_visible_tasks: "medium", predictable_feedback: "medium", neutral_language: "medium" } },
  { id: "enrichment", title: "Ampliar conocimientos y profundizar", description: "Conexiones y preguntas que invitan a investigar.", example: "Aplicar una idea a una situación nueva.", icon: "compass", preset: "altas-capacidades" },
] as const;

export type StartingPointId = (typeof STARTING_POINTS)[number]["id"];
export function presetForPoint(id: StartingPointId): ProfilePreset {
  const point = STARTING_POINTS.find((p) => p.id === id)!;
  return "preset" in point ? findPreset(point.preset)! : { id: point.id, label: point.title, description: point.description, supports: point.supports };
}

/** A card reflects a complete matching configuration, never a diagnosis or a stored second source of truth. */
export function pointsInUse(profile: FunctionalProfile): StartingPointId[] {
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  return STARTING_POINTS.filter((point) => (Object.entries(presetForPoint(point.id).supports) as [DimensionKey, SupportLevel][]).every(([key, level]) => rank[profile.supports[key] ?? "none"] >= rank[level])).map((point) => point.id);
}
