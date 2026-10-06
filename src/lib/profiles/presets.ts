import type { DimensionKey, FunctionalProfile, SupportLevel } from "@/lib/schemas/functional-profile";

type Active = Exclude<SupportLevel, "none">;

export interface ProfilePreset {
  id: string;
  label: string;
  /** Always framed as a starting point. A preset is never stored and never implies a diagnosis. */
  description: string;
  supports: Partial<Record<DimensionKey, Active>>;
  limits?: FunctionalProfile["limits"];
}

const l: Active = "low";
const m: Active = "medium";
const h: Active = "high";

/**
 * Orientative starting points (docs/PRODUCT.md § Presets). Only the resulting dimensions are saved on the
 * profile; the preset's name is not, so adaptations are driven by needs and never by a label.
 */
export const PROFILE_PRESETS: readonly ProfilePreset[] = [
  {
    id: "dislexia",
    label: "Dislexia",
    description: "Textos más manejables y menos copia, manteniendo la exigencia cuando leer no es el objetivo.",
    supports: {
      decoding_support: h, reading_chunk_size: h, text_length: m, sentence_length: m, line_spacing: h,
      font_size: m, emphasis_support: m, vocabulary_support: m, reduced_copying: m, instruction_chunking: m,
    },
  },
  {
    id: "tdah",
    label: "TDAH / funciones ejecutivas",
    description: "Tareas fragmentadas, objetivo visible y menos distractores, sin bajar el nivel intelectual.",
    supports: {
      instruction_chunking: h, number_of_visible_tasks: h, checklist_support: h, visual_distraction_reduction: m,
      task_duration: m, planning_support: m, working_memory_support: m, transition_support: l, key_idea_highlighting: m,
    },
    limits: { max_visible_tasks: 3 },
  },
  {
    id: "tea",
    label: "TEA",
    description: "Lenguaje explícito, estructura predecible y menos estímulos, sin asumir pictogramas ni infantilizar.",
    supports: {
      literal_language: h, figurative_language_support: h, explicit_expectations: h, predictable_structure: h,
      ambiguity_reduction: h, transition_signals: m, visual_schedule: m, instruction_chunking: m,
      sensory_triggers: m, visual_density: m, predictable_feedback: m, choice_support: l, anxiety_reduction: l,
    },
  },
  {
    id: "lenguaje",
    label: "Dificultades del lenguaje",
    description: "Sintaxis clara, vocabulario explicado y menor densidad verbal.",
    supports: {
      receptive_language_support: h, vocabulary_support: h, syntax_complexity: m, sentence_length: m,
      expressive_language_support: m, visual_support: m, instruction_chunking: m, worked_examples: l,
    },
  },
  {
    id: "discalculia",
    label: "Dificultades matemáticas / discalculia",
    description: "Pasos visibles y ejemplos resueltos, preservando el razonamiento matemático.",
    supports: {
      number_sense_support: h, worked_examples: h, operation_steps: h, visual_math_support: m,
      reduced_copying: m, scaffolding_level: m, working_memory_support: m,
    },
  },
  {
    id: "cognitivas",
    label: "Necesidades cognitivas significativas",
    description: "Lenguaje concreto y práctica guiada en pasos pequeños, ajustada a la competencia real y sin infantilizar.",
    supports: {
      sentence_length: h, vocabulary_complexity: h, text_length: h, instruction_chunking: h, worked_examples: h,
      number_of_visible_tasks: h, scaffolding_level: h, visual_support: h, literal_language: m,
      predictable_structure: m, task_duration: m,
    },
    limits: { max_instruction_words: 8 },
  },
  {
    id: "altas-capacidades",
    label: "Altas capacidades",
    description: "Profundidad, conexiones y preguntas abiertas; no más ejercicios.",
    supports: {
      extension_tasks: h, conceptual_depth: h, reduced_repetition: h, open_ended_tasks: m,
      real_world_connections: m, autonomous_inquiry: m,
    },
  },
  {
    id: "incorporacion-linguistica",
    label: "Incorporación lingüística",
    description: "Vocabulario esencial y apoyos visuales. La lengua no es una medida de capacidad.",
    supports: {
      vocabulary_support: h, receptive_language_support: h, visual_support: h, figurative_language_support: h,
      sentence_length: m, syntax_complexity: m, vocabulary_complexity: m, background_knowledge_support: m,
    },
  },
  {
    id: "visual",
    label: "Discapacidad visual",
    description: "Contraste, letra ampliada, estructura y nada que dependa solo de la imagen o del color.",
    supports: {
      large_print: h, font_size: h, high_contrast: m, alt_text: h, image_dependency: h, spacing: h,
      color_dependency: h, screen_reader_compatibility: m, visual_density: m,
    },
  },
  {
    id: "auditiva",
    label: "Discapacidad auditiva",
    description: "Instrucciones escritas, transcripciones y nada esencial solo por audio.",
    supports: { written_instructions: h, visual_support: h, transcript_support: h, audio_dependency_reduction: h, vocabulary_support: l },
  },
  {
    id: "motrices",
    label: "Dificultades motrices",
    description: "Menos copia y escritura, respuestas por selección y espacios amplios.",
    supports: {
      writing_amount: h, alternative_response: h, selection_based_response: h, fine_motor_demand: h,
      reduced_copying: m, task_duration: l,
    },
  },
];

export function findPreset(id: string): ProfilePreset | undefined {
  return PROFILE_PRESETS.find((p) => p.id === id);
}
