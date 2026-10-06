import type { ConflictResolution } from "@/lib/schemas/adaptation-context";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { answersOf, evaluatesOperation, isOpenActivity, protectedFor } from "./facts";
import { normalizeText } from "./text";

/**
 * When two needs (or a need and the material) push in different directions, the higher level of this hierarchy decides:
 *   1. pedagogical_integrity — what is taught and assessed does not change (objective, operation, evaluated writing…);
 *   2. content_fidelity — nothing false, invented or revealed (source text, data, answers);
 *   3. functional_need — the profile's needs, the stronger support first;
 *   4. presentation — preferences of look and layout.
 * The resolution is not "one need loses": it is the way to meet the need without breaking the higher level, written as
 * guidance for the planner and shown to the teacher.
 */

interface Facts {
  literalTexts: string[];
  writingActivities: string[];
}

const READING_LOAD: DimensionKey[] = ["text_length", "reading_level", "sentence_length", "vocabulary_complexity", "syntax_complexity"];
const ADDED_VISUALS: DimensionKey[] = ["visual_support", "visual_math_support", "visual_schedule", "number_sense_support"];
const VISUAL_LOAD: DimensionKey[] = ["visual_density", "visual_distraction_reduction", "unnecessary_decoration", "sensory_triggers"];
const WRITING_REDUCTION: DimensionKey[] = ["writing_amount", "fine_motor_demand", "reduced_copying", "selection_based_response"];
const SEGMENTATION: DimensionKey[] = ["instruction_chunking", "number_of_visible_tasks", "task_duration"];
const SELECTION: DimensionKey[] = ["selection_based_response", "choice_support"];
const INFERENCE_QUESTION = /\b(infier|deduc|por que crees|que quiere decir|que sugiere|se puede concluir)/;

export function detectConflicts(active: ReadonlySet<DimensionKey>, analysis: MaterialAnalysis, facts: Facts): ConflictResolution[] {
  const pick = (dims: DimensionKey[]) => dims.filter((d) => active.has(d));
  const conflicts: ConflictResolution[] = [];

  const reading = pick(READING_LOAD);
  if (reading.length > 0 && facts.literalTexts.length > 0) {
    conflicts.push({
      key: "reading_load_vs_literal_text",
      dimensions: reading,
      targets: facts.literalTexts,
      rule: "pedagogical_integrity",
      guidance: "El texto fuente es objeto de análisis: se conserva literal. Segmentarlo, glosar vocabulario o señalar ideas clave al margen; nunca resumirlo ni reescribirlo.",
    });
  }

  const added = pick(ADDED_VISUALS);
  const load = pick(VISUAL_LOAD);
  if (added.length > 0 && load.length > 0) {
    conflicts.push({
      key: "added_visuals_vs_visual_load",
      dimensions: [...added, ...load],
      targets: [],
      rule: "functional_need",
      guidance: "Solo apoyos visuales con una función concreta (como máximo uno por actividad) y sin decoración; mejor un esquema claro que varias imágenes.",
    });
  }

  const operations = analysis.activities.filter((a) => evaluatesOperation(analysis, a)).map((a) => a.id);
  const withAnswers = new Set(answersOf(analysis).map((x) => x.activity));
  if (active.has("worked_examples") && operations.some((id) => withAnswers.has(id))) {
    conflicts.push({
      key: "examples_vs_answer",
      dimensions: ["worked_examples"],
      targets: operations.filter((id) => withAnswers.has(id)),
      rule: "content_fidelity",
      guidance: "Los ejemplos resueltos usan datos distintos de los de la tarea y nunca la resuelven.",
    });
  }

  const reduction = pick(WRITING_REDUCTION);
  if (reduction.length > 0 && facts.writingActivities.length > 0) {
    conflicts.push({
      key: "writing_reduction_vs_evaluated_writing",
      dimensions: reduction,
      targets: facts.writingActivities,
      rule: "pedagogical_integrity",
      guidance: "Donde se evalúa la escritura se mantiene la producción escrita y su extensión: apoyos de planificación, banco de conectores o teclado si está permitido; nunca selección.",
    });
  }

  const segmentation = pick(SEGMENTATION);
  const integrated = facts.writingActivities.filter((id) => protectedFor(analysis, id).some((p) => p.type === "response_constraint"));
  if (segmentation.length > 0 && integrated.length > 0) {
    conflicts.push({
      key: "segmentation_vs_integrated_product",
      dimensions: segmentation,
      targets: integrated,
      rule: "pedagogical_integrity",
      guidance: "Se puede secuenciar el proceso (planificar, redactar, revisar), pero el producto final sigue siendo un único texto con todos sus requisitos.",
    });
  }

  const selection = pick(SELECTION);
  const openReasoning = analysis.activities
    .filter((a) => isOpenActivity(a) && !facts.writingActivities.includes(a.id) && (a.type === "problem_solving" || protectedFor(analysis, a.id).some((p) => p.type === "reasoning_constraint")))
    .map((a) => a.id);
  if (selection.length > 0 && openReasoning.length > 0) {
    conflicts.push({
      key: "selection_vs_open_reasoning",
      dimensions: selection,
      targets: openReasoning,
      rule: "pedagogical_integrity",
      guidance: "En las tareas de razonamiento abierto se ofrece otra vía de respuesta (oral, teclado o esquema), no opciones cerradas.",
    });
  }

  const inference = analysis.activities.filter((a) => INFERENCE_QUESTION.test(normalizeText(a.instruction))).map((a) => a.id);
  if (active.has("inferential_demand") && inference.length > 0) {
    conflicts.push({
      key: "inference_support_vs_evaluated_inference",
      dimensions: ["inferential_demand"],
      targets: inference,
      rule: "pedagogical_integrity",
      guidance: "La inferencia es lo que se evalúa: el apoyo guía el proceso con preguntas intermedias, sin dar la conclusión.",
    });
  }

  return conflicts;
}
