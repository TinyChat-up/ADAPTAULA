import { z } from "zod";

export const FUNCTIONAL_PROFILE_SCHEMA_VERSION = 1;

export const SUPPORT_LEVELS = ["none", "low", "medium", "high"] as const;
export const SupportLevelSchema = z.enum(SUPPORT_LEVELS);
export type SupportLevel = z.infer<typeof SupportLevelSchema>;

export const DIMENSION_GROUPS = {
  reading: "Lectura",
  comprehension: "Comprensión",
  language: "Lenguaje",
  attention_executive: "Atención y función ejecutiva",
  math: "Matemáticas",
  communication: "Comunicación y predictibilidad",
  sensory: "Sensorial",
  vision: "Visión",
  hearing: "Audición",
  motor: "Motricidad",
  emotional: "Regulación emocional",
  enrichment: "Ampliación y reto",
} as const;

export type DimensionGroup = keyof typeof DIMENSION_GROUPS;

/**
 * Every dimension is expressed as how much adjustment/support the learner needs (`none`…`high`).
 * The catalog is data: adding a dimension never requires touching the pipeline.
 */
export const DIMENSIONS = {
  // Lectura
  decoding_support: { group: "reading", label: "Apoyo en la decodificación" },
  reading_level: { group: "reading", label: "Ajuste del nivel de lectura" },
  text_length: { group: "reading", label: "Reducción de la longitud de los textos" },
  sentence_length: { group: "reading", label: "Frases más cortas" },
  vocabulary_complexity: { group: "reading", label: "Vocabulario más accesible" },
  line_spacing: { group: "reading", label: "Más interlineado" },
  font_size: { group: "reading", label: "Letra más grande" },
  emphasis_support: { group: "reading", label: "Resaltado de lo esencial" },
  reading_chunk_size: { group: "reading", label: "Textos fragmentados en partes" },
  // Comprensión
  literal_language: { group: "comprehension", label: "Lenguaje literal" },
  inferential_demand: { group: "comprehension", label: "Apoyo en las inferencias" },
  background_knowledge_support: { group: "comprehension", label: "Activación de conocimientos previos" },
  key_idea_highlighting: { group: "comprehension", label: "Ideas clave destacadas" },
  recap_frequency: { group: "comprehension", label: "Resúmenes y repasos frecuentes" },
  // Lenguaje
  receptive_language_support: { group: "language", label: "Apoyo en la comprensión oral y escrita" },
  expressive_language_support: { group: "language", label: "Apoyo en la expresión" },
  vocabulary_support: { group: "language", label: "Vocabulario explicado" },
  syntax_complexity: { group: "language", label: "Sintaxis más sencilla" },
  figurative_language_support: { group: "language", label: "Explicación del lenguaje figurado" },
  // Atención y función ejecutiva
  instruction_chunking: { group: "attention_executive", label: "Instrucciones divididas en pasos" },
  visual_distraction_reduction: { group: "attention_executive", label: "Menos distracciones visuales" },
  number_of_visible_tasks: { group: "attention_executive", label: "Menos tareas visibles a la vez" },
  task_duration: { group: "attention_executive", label: "Tareas más breves" },
  checklist_support: { group: "attention_executive", label: "Listas de comprobación" },
  planning_support: { group: "attention_executive", label: "Apoyo en la planificación" },
  working_memory_support: { group: "attention_executive", label: "Apoyo a la memoria de trabajo" },
  transition_support: { group: "attention_executive", label: "Apoyo en las transiciones" },
  // Matemáticas
  number_sense_support: { group: "math", label: "Apoyo en el sentido numérico" },
  worked_examples: { group: "math", label: "Ejemplos resueltos" },
  operation_steps: { group: "math", label: "Pasos de las operaciones visibles" },
  visual_math_support: { group: "math", label: "Representaciones visuales" },
  reduced_copying: { group: "math", label: "Menos copia de enunciados" },
  scaffolding_level: { group: "math", label: "Andamiaje" },
  // Comunicación y predictibilidad
  explicit_expectations: { group: "communication", label: "Expectativas explícitas" },
  predictable_structure: { group: "communication", label: "Estructura predecible" },
  transition_signals: { group: "communication", label: "Señales de cambio de actividad" },
  ambiguity_reduction: { group: "communication", label: "Menos ambigüedad" },
  visual_schedule: { group: "communication", label: "Secuencia visual de la tarea" },
  choice_support: { group: "communication", label: "Apoyo para elegir" },
  // Sensorial
  visual_density: { group: "sensory", label: "Menor densidad visual" },
  contrast: { group: "sensory", label: "Ajuste de contraste" },
  unnecessary_decoration: { group: "sensory", label: "Sin decoración innecesaria" },
  sensory_triggers: { group: "sensory", label: "Evitar estímulos que molestan" },
  color_dependency: { group: "sensory", label: "No depender del color" },
  // Visión
  large_print: { group: "vision", label: "Letra ampliada" },
  high_contrast: { group: "vision", label: "Alto contraste" },
  alt_text: { group: "vision", label: "Texto alternativo en imágenes" },
  image_dependency: { group: "vision", label: "No depender de imágenes" },
  spacing: { group: "vision", label: "Más espacio entre elementos" },
  screen_reader_compatibility: { group: "vision", label: "Compatible con lector de pantalla" },
  // Audición
  written_instructions: { group: "hearing", label: "Instrucciones por escrito" },
  visual_support: { group: "hearing", label: "Apoyos visuales" },
  transcript_support: { group: "hearing", label: "Transcripciones" },
  audio_dependency_reduction: { group: "hearing", label: "No depender del audio" },
  // Motricidad
  writing_amount: { group: "motor", label: "Menos escritura" },
  alternative_response: { group: "motor", label: "Formas de respuesta alternativas" },
  selection_based_response: { group: "motor", label: "Respuestas por selección" },
  fine_motor_demand: { group: "motor", label: "Menor exigencia de motricidad fina" },
  // Regulación emocional
  predictable_feedback: { group: "emotional", label: "Retroalimentación predecible" },
  choice: { group: "emotional", label: "Posibilidad de elegir" },
  anxiety_reduction: { group: "emotional", label: "Reducción de la ansiedad" },
  error_tolerance: { group: "emotional", label: "Tolerancia al error" },
  neutral_language: { group: "emotional", label: "Lenguaje neutro y no amenazante" },
  // Ampliación y reto
  extension_tasks: { group: "enrichment", label: "Tareas de ampliación" },
  conceptual_depth: { group: "enrichment", label: "Mayor profundidad conceptual" },
  reduced_repetition: { group: "enrichment", label: "Menos práctica repetitiva" },
  open_ended_tasks: { group: "enrichment", label: "Preguntas abiertas" },
  real_world_connections: { group: "enrichment", label: "Conexiones con el mundo real" },
  autonomous_inquiry: { group: "enrichment", label: "Investigación autónoma" },
} as const satisfies Record<string, { group: DimensionGroup; label: string }>;

export type DimensionKey = keyof typeof DIMENSIONS;
export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as [DimensionKey, ...DimensionKey[]];
export const DimensionKeySchema = z.enum(DIMENSION_KEYS);

export const FunctionalProfileSchema = z.object({
  schema_version: z.literal(FUNCTIONAL_PROFILE_SCHEMA_VERSION),
  /** Missing dimension = `none`. */
  supports: z.partialRecord(DimensionKeySchema, SupportLevelSchema),
  /** Optional precise limits that override what the support levels would imply. */
  limits: z.object({
    max_instruction_words: z.int().min(4).max(40).optional(),
    max_visible_tasks: z.int().min(1).max(10).optional(),
    max_task_minutes: z.int().min(2).max(60).optional(),
  }),
  allowances: z.object({
    calculator: z.boolean().optional(),
    keyboard: z.boolean().optional(),
    /** ISO 639-1 code; only when the teacher explicitly asks for bilingual support. */
    bilingual_support_language: z.string().regex(/^[a-z]{2}$/).optional(),
  }),
});

export type FunctionalProfile = z.infer<typeof FunctionalProfileSchema>;

export function emptyFunctionalProfile(): FunctionalProfile {
  return { schema_version: FUNCTIONAL_PROFILE_SCHEMA_VERSION, supports: {}, limits: {}, allowances: {} };
}

/** Dimensions with any support, the only part of the profile worth sending to a model. */
export function activeSupports(profile: FunctionalProfile): Array<[DimensionKey, Exclude<SupportLevel, "none">]> {
  return Object.entries(profile.supports).filter(
    (entry): entry is [DimensionKey, Exclude<SupportLevel, "none">] => entry[1] !== undefined && entry[1] !== "none",
  );
}
