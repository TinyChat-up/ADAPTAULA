import type { AdaptationAction, ReviewFlag, StrategyKey } from "@/lib/schemas/adaptation-plan";
import type { DimensionKey } from "@/lib/schemas/functional-profile";

export interface StrategyInfo {
  label: string;
  /** access: how the content reaches the student · content: what is read · task: how the task is organised · response: how it is answered. */
  family: "access" | "content" | "task" | "response" | "regulation" | "enrichment";
  actions: readonly AdaptationAction[];
  /** What can go wrong with it. The validator turns these into concrete checks. */
  risks: readonly ReviewFlag[];
}

/** The taxonomy (docs/ADAPTATION.md § Estrategias). Strategies compose: a decision may use up to three. */
export const STRATEGIES: Record<StrategyKey, StrategyInfo> = {
  language_simplification: { label: "Lenguaje más accesible", family: "content", actions: ["rephrase"], risks: ["source_text_altered", "protected_element_modified"] },
  text_segmentation: { label: "Longitud y segmentación", family: "content", actions: ["segment", "reorganize", "reduce"], risks: ["source_text_altered"] },
  visual_load_reduction: { label: "Menos carga visual", family: "access", actions: ["remove", "reorganize"], risks: ["required_data_removed", "essential_visual_replaced"] },
  spatial_organization: { label: "Organización espacial", family: "access", actions: ["reorganize", "segment"], risks: [] },
  instruction_clarification: { label: "Instrucciones explícitas", family: "task", actions: ["rephrase", "segment", "add_support"], risks: ["protected_element_modified"] },
  task_sequencing: { label: "Pasos y secuenciación", family: "task", actions: ["segment", "add_support"], risks: ["cognitive_demand_reduced"] },
  comprehension_support: { label: "Apoyos de comprensión", family: "content", actions: ["add_support"], risks: ["answer_revealed", "cognitive_demand_reduced"] },
  worked_example: { label: "Ejemplo resuelto análogo", family: "task", actions: ["add_support"], risks: ["answer_revealed"] },
  prior_knowledge_activation: { label: "Activación de conocimientos previos", family: "content", actions: ["add_support"], risks: [] },
  attention_focus: { label: "Foco de atención", family: "regulation", actions: ["reorganize", "add_support"], risks: [] },
  working_memory_support: { label: "Apoyo a la memoria de trabajo", family: "task", actions: ["add_support", "reorganize"], risks: ["cognitive_demand_reduced"] },
  planning_support: { label: "Planificación", family: "task", actions: ["add_support"], risks: [] },
  response_choice: { label: "Elección de respuesta", family: "response", actions: ["change_response_format"], risks: ["open_task_closed", "written_expression_replaced", "target_operation_replaced", "cognitive_demand_reduced"] },
  response_format: { label: "Formato de respuesta", family: "response", actions: ["change_response_format", "add_support"], risks: ["written_expression_replaced"] },
  writing_load_reduction: { label: "Menos escritura", family: "response", actions: ["reduce", "change_response_format"], risks: ["written_expression_replaced", "extension_changed"] },
  visual_support: { label: "Apoyo visual", family: "access", actions: ["add_support"], risks: ["infantilization_risk"] },
  vocabulary_support: { label: "Vocabulario", family: "content", actions: ["add_support"], risks: ["answer_revealed"] },
  pacing: { label: "Tiempo y esfuerzo", family: "task", actions: ["segment", "reduce", "reorganize"], risks: ["cognitive_demand_reduced", "activity_removed"] },
  self_regulation: { label: "Autorregulación", family: "regulation", actions: ["add_support", "rephrase"], risks: [] },
  extension: { label: "Ampliación y reto", family: "enrichment", actions: ["extend", "add_support"], risks: [] },
};

/**
 * Dimensions that change the presentation, not the pedagogy. They never reach the planner: they become semantic
 * presentation settings of the document (`context.ts › presentationFor`), so a font size cannot turn into a content change.
 */
export const PRESENTATION_DIMENSIONS = [
  "line_spacing",
  "font_size",
  "large_print",
  "contrast",
  "high_contrast",
  "spacing",
  "screen_reader_compatibility",
  "color_dependency",
  "alt_text",
  "image_dependency",
] as const satisfies readonly DimensionKey[];

/** Pedagogical strategies each functional dimension may call for. `Record` makes a missing dimension a compile error. */
export const DIMENSION_STRATEGIES: Record<DimensionKey, readonly StrategyKey[]> = {
  decoding_support: ["text_segmentation", "vocabulary_support"],
  reading_level: ["language_simplification"],
  text_length: ["text_segmentation", "language_simplification"],
  sentence_length: ["language_simplification"],
  vocabulary_complexity: ["language_simplification", "vocabulary_support"],
  line_spacing: [],
  font_size: [],
  emphasis_support: ["comprehension_support", "attention_focus"],
  reading_chunk_size: ["text_segmentation"],
  literal_language: ["language_simplification", "instruction_clarification"],
  inferential_demand: ["comprehension_support"],
  background_knowledge_support: ["prior_knowledge_activation"],
  key_idea_highlighting: ["comprehension_support"],
  recap_frequency: ["comprehension_support", "working_memory_support"],
  receptive_language_support: ["language_simplification", "comprehension_support"],
  expressive_language_support: ["planning_support", "response_format"],
  vocabulary_support: ["vocabulary_support"],
  syntax_complexity: ["language_simplification"],
  figurative_language_support: ["vocabulary_support", "comprehension_support"],
  instruction_chunking: ["task_sequencing", "instruction_clarification"],
  visual_distraction_reduction: ["visual_load_reduction", "attention_focus"],
  number_of_visible_tasks: ["spatial_organization", "attention_focus"],
  task_duration: ["pacing"],
  checklist_support: ["planning_support", "self_regulation"],
  planning_support: ["planning_support"],
  working_memory_support: ["working_memory_support"],
  transition_support: ["attention_focus", "spatial_organization"],
  number_sense_support: ["visual_support", "working_memory_support"],
  worked_examples: ["worked_example"],
  operation_steps: ["task_sequencing", "working_memory_support"],
  visual_math_support: ["visual_support"],
  reduced_copying: ["writing_load_reduction", "working_memory_support"],
  scaffolding_level: ["task_sequencing", "comprehension_support"],
  explicit_expectations: ["instruction_clarification"],
  predictable_structure: ["spatial_organization", "instruction_clarification"],
  transition_signals: ["attention_focus"],
  ambiguity_reduction: ["instruction_clarification", "language_simplification"],
  visual_schedule: ["task_sequencing", "visual_support"],
  choice_support: ["response_choice", "self_regulation"],
  visual_density: ["visual_load_reduction", "spatial_organization"],
  contrast: [],
  unnecessary_decoration: ["visual_load_reduction"],
  sensory_triggers: ["visual_load_reduction"],
  color_dependency: [],
  large_print: [],
  high_contrast: [],
  alt_text: [],
  image_dependency: [],
  spacing: [],
  screen_reader_compatibility: [],
  written_instructions: ["instruction_clarification"],
  visual_support: ["visual_support"],
  transcript_support: [],
  audio_dependency_reduction: [],
  writing_amount: ["writing_load_reduction", "response_format"],
  alternative_response: ["response_format"],
  selection_based_response: ["response_choice"],
  fine_motor_demand: ["response_format", "writing_load_reduction"],
  predictable_feedback: ["self_regulation"],
  choice: ["self_regulation"],
  anxiety_reduction: ["self_regulation", "pacing"],
  error_tolerance: ["self_regulation"],
  neutral_language: ["self_regulation"],
  extension_tasks: ["extension"],
  conceptual_depth: ["extension"],
  reduced_repetition: ["pacing", "extension"],
  open_ended_tasks: ["extension"],
  real_world_connections: ["extension"],
  autonomous_inquiry: ["extension"],
};

/**
 * Dimensions that cannot apply to an uploaded sheet (PDF or image has no audio). Kept in the catalog for the teacher;
 * dropped from the context with reason `not_applicable`.
 */
export const AUDIO_DIMENSIONS = ["transcript_support", "audio_dependency_reduction"] as const satisfies readonly DimensionKey[];

export function strategiesFor(dimension: DimensionKey): readonly StrategyKey[] {
  return DIMENSION_STRATEGIES[dimension];
}

/** Whether `action` is one the given strategies can carry out. `keep` needs no strategy. */
export function actionFitsStrategies(action: AdaptationAction, strategies: readonly StrategyKey[]): boolean {
  if (action === "keep") return true;
  return strategies.some((s) => STRATEGIES[s].actions.includes(action));
}
