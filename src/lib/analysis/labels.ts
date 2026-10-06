import type { ACTIVITY_TYPES, ANSWER_AREA_TYPES, DIFFICULTY, IMPORTANCE, PROTECTED_TYPES, UNCERTAINTY_KINDS, VISUAL_KINDS, VISUAL_ROLES } from "@/lib/schemas/material-analysis";

export const ACTIVITY_TYPE_LABELS: Record<(typeof ACTIVITY_TYPES)[number], string> = {
  open_question: "Pregunta abierta",
  short_answer: "Respuesta corta",
  multiple_choice: "Elección múltiple",
  true_false: "Verdadero o falso",
  fill_blank: "Completar huecos",
  matching: "Unir",
  classification: "Clasificar",
  sequencing: "Ordenar",
  calculation: "Cálculo",
  problem_solving: "Problema",
  writing: "Redacción",
  reading_comprehension: "Comprensión lectora",
  table_completion: "Completar tabla",
  graph_interpretation: "Interpretar un gráfico",
  drawing: "Dibujar",
  experiment: "Experimento",
  other: "Otra",
};

export const DIFFICULTY_LABELS: Record<(typeof DIFFICULTY)[number], string> = { low: "Baja", medium: "Media", high: "Alta" };

export const VISUAL_ROLE_LABELS: Record<(typeof VISUAL_ROLES)[number], string> = {
  required: "Necesario para resolver",
  informative: "Aporta información",
  illustrative: "Ilustra",
  decorative: "Decorativo",
};

export const VISUAL_KIND_LABELS: Record<(typeof VISUAL_KINDS)[number], string> = {
  image: "Imagen",
  diagram: "Diagrama",
  chart: "Gráfico",
  table: "Tabla",
  number_line: "Recta numérica",
  geometric_figure: "Figura geométrica",
  map: "Mapa",
  decorative: "Elemento decorativo",
  other: "Otro",
};

export const PROTECTED_TYPE_LABELS: Record<(typeof PROTECTED_TYPES)[number], string> = {
  learning_objective: "Objetivo de aprendizaje",
  target_operation: "Operación objetivo",
  concept: "Concepto",
  required_data: "Datos necesarios",
  units_or_magnitudes: "Unidades o magnitudes",
  necessary_visual: "Recurso necesario",
  response_constraint: "Condición de la respuesta",
  reasoning_constraint: "Condición de razonamiento",
  evaluation_criterion: "Criterio de evaluación",
  required_vocabulary: "Vocabulario necesario",
  format_requirement: "Formato exigido",
  formula: "Fórmula",
  other: "Otro",
};

export const IMPORTANCE_LABELS: Record<(typeof IMPORTANCE)[number], string> = { essential: "Esencial", important: "Importante", optional: "Opcional" };

export const ANSWER_AREA_LABELS: Record<(typeof ANSWER_AREA_TYPES)[number], string> = {
  none: "Sin espacio para responder",
  line: "Una línea",
  lines: "Varias líneas",
  box: "Un recuadro",
  grid: "Una cuadrícula",
  large_space: "Un espacio amplio",
  table_cells: "Celdas de una tabla",
  other: "Otro espacio",
  unknown: "Espacio sin determinar",
};

export const UNCERTAINTY_KIND_LABELS: Record<(typeof UNCERTAINTY_KINDS)[number], string> = {
  illegible: "No se lee bien",
  cut_off: "Está cortado",
  ambiguous: "Es ambiguo",
  answer_not_inferable: "No se puede deducir la respuesta",
  low_quality: "Calidad baja",
  unsupported_content: "Contenido que no podemos interpretar",
  embedded_instructions: "Contiene texto dirigido a una IA",
  unstructured_data: "Datos que no hemos podido estructurar",
  other: "Otro",
};
