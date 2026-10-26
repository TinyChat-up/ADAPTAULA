import type { DimensionKey } from "@/lib/schemas/functional-profile";

/** Teacher-declared observations, never inferred from support levels. IDs are permanent; copy may evolve. */
export const STRENGTHS = {
  concrete_examples: "Comprende explicaciones acompañadas de ejemplos concretos.",
  oral_expression: "Explica oralmente lo que sabe.",
  visual_information: "Identifica información importante en dibujos y esquemas.",
  hands_on: "Razona cuando puede manipular materiales.",
  clear_instructions: "Trabaja con autonomía cuando las instrucciones son claras.",
  everyday_connections: "Relaciona conceptos con situaciones cotidianas.",
  inquiry: "Muestra interés por investigar y descubrir.",
  subject_knowledge: "Aporta conocimientos en los contenidos que conoce.",
} as const;

export const BARRIERS = {
  long_instructions: { label: "Con instrucciones largas, le cuesta retener qué debe hacer.", supports: ["instruction_chunking", "checklist_support"] },
  dense_text: { label: "Con mucho texto seguido, pierde información importante.", supports: ["reading_chunk_size", "key_idea_highlighting"] },
  abstract_content: { label: "Con explicaciones abstractas, necesita referencias concretas.", supports: ["worked_examples", "visual_support"] },
  planning: { label: "En tareas de varios pasos, le cuesta organizar el trabajo.", supports: ["planning_support", "operation_steps"] },
  written_expression: { label: "Cuando responde por escrito, le cuesta mostrar todo lo que sabe.", supports: ["expressive_language_support", "alternative_response"] },
  processing_time: { label: "Cuando recibe mucha información a la vez, necesita tiempo para procesarla.", supports: ["working_memory_support", "number_of_visible_tasks"] },
  visual_load: { label: "En páginas muy cargadas, se distrae o pierde el lugar.", supports: ["visual_density", "visual_distraction_reduction"] },
  small_visuals: { label: "Con letra pequeña o poco contraste, le cuesta acceder a la información.", supports: ["large_print", "high_contrast", "alt_text"] },
  scientific_diagrams: { label: "Ante esquemas científicos sin explicación, le cuesta interpretar las relaciones.", supports: ["visual_support", "vocabulary_support"] },
  audio_only: { label: "Cuando la explicación es solo oral, pierde parte de la información.", supports: ["written_instructions", "audio_dependency_reduction"] },
  numerical_steps: { label: "En operaciones con varios pasos, pierde el procedimiento.", supports: ["operation_steps", "visual_math_support"] },
} as const satisfies Record<string, { label: string; supports: readonly DimensionKey[] }>;

export const STRENGTH_IDS = Object.keys(STRENGTHS) as [keyof typeof STRENGTHS, ...Array<keyof typeof STRENGTHS>];
export const BARRIER_IDS = Object.keys(BARRIERS) as [keyof typeof BARRIERS, ...Array<keyof typeof BARRIERS>];

export function suggestedSupports(barriers: readonly (keyof typeof BARRIERS)[]): DimensionKey[] {
  return [...new Set(barriers.flatMap((id) => [...BARRIERS[id].supports]))];
}
