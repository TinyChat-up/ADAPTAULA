import { STRATEGIES } from "@/lib/adaptation/strategies";
import type { AdaptationAction, Intensity, ResponseTarget, ReviewFlag, SupportKind } from "@/lib/schemas/adaptation-plan";
import { DIMENSIONS } from "@/lib/schemas/functional-profile";
import type { ReviewCheck } from "@/lib/schemas/pedagogical-review";

/**
 * Teacher-facing wording for everything the pipeline reports with a technical key. One place, so the screens never
 * show a raw key: an unknown key gets a neutral sentence (never the key itself). No diagnosis, no model/provider language.
 */

const own = <T extends object>(map: T, key: string): key is Extract<keyof T, string> => Object.prototype.hasOwnProperty.call(map, key);

export const ACTION_LABELS: Record<AdaptationAction, string> = {
  keep: "Mantener tal cual",
  rephrase: "Reformular",
  segment: "Dividir en partes",
  reorganize: "Reorganizar",
  add_support: "Añadir una ayuda",
  change_response_format: "Cambiar la forma de responder",
  reduce: "Reducir",
  remove: "Quitar",
  extend: "Ampliar",
};

export const ACTION_SENTENCES: Record<AdaptationAction, string> = {
  keep: "Se mantiene sin cambios.",
  rephrase: "Se reformula para que sea más fácil de leer, sin cambiar lo que se pide.",
  segment: "Se divide en partes más pequeñas.",
  reorganize: "Se reorganiza para que sea más fácil de seguir.",
  add_support: "Se añade una ayuda junto a la actividad.",
  change_response_format: "Cambia la forma en que el alumnado responde.",
  reduce: "Se reduce la cantidad de trabajo, manteniendo lo esencial.",
  remove: "Se quita algo que no es esencial.",
  extend: "Se añade una ampliación o un reto.",
};

export const INTENSITY_LABELS: Record<Intensity, string> = { light: "Cambio ligero", moderate: "Cambio moderado", substantial: "Cambio importante" };

export const SUPPORT_LABELS: Record<SupportKind, string> = {
  glossary: "Glosario",
  key_idea: "Idea clave",
  reminder: "Recordatorio",
  checklist: "Lista de comprobación",
  planner: "Planificador",
  sentence_starters: "Inicios de frase",
  worked_example: "Ejemplo resuelto análogo",
  guiding_questions: "Preguntas guía",
  step_list: "Pasos a seguir",
  self_check: "Autocomprobación",
  visual_cue: "Pista visual",
  extension_task: "Tarea de ampliación",
};

export const RESPONSE_TARGET_LABELS: Record<ResponseTarget, string> = {
  write_text: "Escribir un texto",
  write_text_short: "Escribir una respuesta breve",
  write_number: "Escribir un número",
  table_completion: "Completar una tabla",
  keyboard: "Responder con teclado",
  oral_or_alternative: "Responder de forma oral o alternativa",
  select_option: "Elegir una opción",
  mark: "Marcar",
  fill_blanks: "Rellenar huecos",
  match: "Relacionar",
  order: "Ordenar",
};

/** Safe, short reading of what a validator flag means for the teacher. The validator's own message is never shown. */
export const FLAG_COPY: Record<ReviewFlag, string> = {
  objective_changed: "Podría cambiar lo que se quiere trabajar.",
  activity_removed: "Quitaría una actividad completa.",
  protected_element_modified: "Afecta a algo que debe mantenerse.",
  required_data_removed: "Quitaría datos necesarios para resolver la actividad.",
  essential_visual_replaced: "Sustituiría un elemento visual imprescindible.",
  source_text_altered: "Cambiaría el texto original.",
  answer_revealed: "Podría dar pistas que revelen la respuesta.",
  target_operation_replaced: "Cambiaría lo que el alumnado tiene que hacer.",
  written_expression_replaced: "Sustituiría la expresión escrita que se trabaja.",
  open_task_closed: "Convertiría una tarea abierta en una cerrada.",
  cognitive_demand_reduced: "Podría reducir la exigencia de la tarea.",
  extension_changed: "Cambiaría la extensión que se pide.",
  inferred_used_as_fact: "Se apoya en algo que no figura en el material.",
  ambiguous_source: "El material original no es claro en este punto.",
  needs_conflict: "Dos ayudas podrían contradecirse.",
  infantilization_risk: "Podría resultar poco adecuado para la edad.",
  unknown_reference: "Se refiere a algo que no hemos encontrado en el material.",
  unjustified_change: "No queda clara la razón del cambio.",
};
const FLAG_FALLBACK = "Conviene revisar este cambio con atención.";

/** What a non-passing check means for the teacher: what to look at, not the check's name. */
export const CHECK_COPY: Record<ReviewCheck, string> = {
  objectives_preserved: "Comprueba que se mantienen los objetivos de aprendizaje.",
  protected_elements_preserved: "Comprueba que se conserva lo que debía mantenerse del material original.",
  answers_not_leaked: "Comprueba que las ayudas no revelan las respuestas.",
  required_data_preserved: "Comprueba que no falta ningún dato necesario para resolver las actividades.",
  instructions_complete: "Comprueba que las instrucciones están completas.",
  constraints_preserved: "Comprueba que se mantienen los requisitos de las respuestas.",
  response_format_appropriate: "Comprueba que la forma de responder es adecuada.",
  functional_supports_applied: "Alguna necesidad no queda del todo cubierta por las ayudas incluidas.",
  visual_load_reasonable: "Comprueba que la carga visual de la ficha es razonable.",
  reading_load_reasonable: "Comprueba que la cantidad de lectura es razonable.",
  age_appropriate: "Comprueba que el tono es adecuado para la edad del alumnado.",
  no_infantilization: "Comprueba que el material no resulta infantil.",
  traceability_complete: "Hay una ayuda repetida o que no se corresponde con ninguna decisión aprobada.",
};
const CHECK_FALLBACK = "Hay una observación que conviene revisar antes de usar la ficha.";

export const DEFERRED_NOTE = "Se aplicará al preparar la presentación final.";
export const PRESENTATION_PENDING_COPY = "Hay un cambio de presentación que se aplicará en el paso de presentación final.";

export const flagCopy = (flag: string): string => (own(FLAG_COPY, flag) ? FLAG_COPY[flag] : FLAG_FALLBACK);
export const checkCopy = (check: string): string => (own(CHECK_COPY, check) ? CHECK_COPY[check] : CHECK_FALLBACK);
export const actionLabel = (action: string): string => (own(ACTION_LABELS, action) ? ACTION_LABELS[action] : "Cambio propuesto");
export const actionSentence = (action: string): string => (own(ACTION_SENTENCES, action) ? ACTION_SENTENCES[action] : "Se propone un cambio en esta parte del material.");
export const intensityLabel = (intensity: string): string => (own(INTENSITY_LABELS, intensity) ? INTENSITY_LABELS[intensity] : "Cambio");
export const supportLabel = (kind: string): string => (own(SUPPORT_LABELS, kind) ? SUPPORT_LABELS[kind] : "Ayuda");
export const responseTargetLabel = (target: string): string => (own(RESPONSE_TARGET_LABELS, target) ? RESPONSE_TARGET_LABELS[target] : "Otra forma de responder");
export const strategyLabel = (key: string): string => (own(STRATEGIES, key) ? STRATEGIES[key].label : "Otra estrategia");

/** The functional need as the teacher knows it. Never the key (`need_N`, dimension id) and never anything about a learner. */
export const needLabel = (dimension: string): string => (own(DIMENSIONS, dimension) ? DIMENSIONS[dimension].label : "Una necesidad del perfil");

/** Distinct, human labels in the original order. */
export const needLabels = (dimensions: readonly string[]): string[] => [...new Set(dimensions.map(needLabel))];

/** `document` · `act_3` · `ctt_1`… → words. `labels` comes from the stored analysis (server-built); the fallback never shows the id. */
export function targetLabel(target: string, labels: Readonly<Record<string, string>> = {}): string {
  if (target === "document") return "Todo el documento";
  const known = Object.prototype.hasOwnProperty.call(labels, target) ? labels[target] : undefined;
  if (known) return known;
  if (target.startsWith("act_")) return "Una actividad";
  if (target.startsWith("ctt_")) return "Un texto del material";
  if (target.startsWith("vis_")) return "Un elemento visual";
  if (target.startsWith("sec_")) return "Una sección";
  return "Una parte del material";
}

export const STATUS_COPY = {
  needsPlanning: { title: "Todo listo para preparar la propuesta", body: "Adaptaula preparará una propuesta de cambios. Tú decides cuáles se aplican antes de crear la ficha." },
  planning: { title: "Preparando propuesta", body: "Estamos preparando una propuesta de adaptación." },
  awaitingReview: { title: "Esperando tu revisión", body: "La propuesta está lista. Revisa los cambios antes de crear la ficha." },
  needsGeneration: { title: "Revisión guardada", body: "Ya puedes crear el material con los cambios que has aprobado." },
  generating: { title: "Preparando material", body: "Estamos creando el material con los cambios que has aprobado." },
  reviewing: { title: "Revisando calidad", body: "Estamos comprobando que se mantienen los objetivos y que las ayudas no revelan respuestas." },
  ready: { title: "La adaptación está preparada", body: "Ya puedes ver la ficha tal como la verá el alumnado y descargarla en PDF." },
  readyWithWarnings: { title: "Material preparado con observaciones", body: "La ficha está preparada, pero conviene que revises estos puntos antes de usarla." },
  blocked: { title: "Este material todavía no está listo", body: "La comprobación de calidad ha encontrado algo que necesita tu atención. No se ha entregado ninguna ficha." },
  cancelled: { title: "Adaptación cancelada", body: "Esta adaptación se ha detenido." },
  failed: { title: "No hemos podido completar la adaptación", body: "" },
} as const;

/** The stage list shown while the pipeline works. Semantic stages, never percentages. */
export const STAGES = [
  { key: "preparing", label: "Preparando" },
  { key: "planning", label: "Preparando propuesta" },
  { key: "awaiting_review", label: "Esperando tu revisión" },
  { key: "generating", label: "Preparando material" },
  { key: "reviewing", label: "Revisando calidad" },
  { key: "ready", label: "Listo" },
] as const;

export const QUOTA_COPY = {
  exhausted: "Has utilizado las adaptaciones disponibles de este periodo.",
  unavailable: "No hemos podido comprobar las adaptaciones disponibles. Inténtalo de nuevo más tarde.",
} as const;

/** Copy for the server's error codes that the screens act on; anything else keeps the generic message the action returned. */
export function actionErrorCopy(code: string, fallback: string): string {
  if (code === "entitlement_exhausted") return QUOTA_COPY.exhausted;
  if (code === "entitlement_unavailable") return QUOTA_COPY.unavailable;
  if (code === "stale_review") return "Esta propuesta ha cambiado desde que la abriste. Actualiza para revisar la versión más reciente.";
  if (code === "unsupported_execution") return "Hay un cambio que todavía necesita ajustarse antes de crear el material.";
  return fallback || "Algo no ha ido bien. Inténtalo de nuevo.";
}

/** Failure → what the teacher reads, by the category the server decided (never by status). */
export function failureCopy(failure: { code: string; category: string; message: string } | null): string {
  if (!failure) return "Algo ha fallado. Puedes volver a intentarlo.";
  if (failure.code === "ambiguous_attempt") return "No se pudo confirmar el resultado del último intento.";
  if (failure.category === "retryable") return "No hemos podido completar este paso. Puedes volver a intentarlo.";
  if (failure.category === "human_action_required") return failure.message || "Esta adaptación necesita tu decisión antes de continuar.";
  return failure.message || "No hemos podido completar esta adaptación.";
}

/** How a protected requirement of the sheet is announced under "Se mantendrá". The wording of the requirement itself comes from the analysis. */
const PRESERVE_PREFIX: Record<string, string> = {
  learning_objective: "Se mantiene el objetivo",
  target_operation: "El alumnado seguirá teniendo que",
  concept: "Se mantiene el concepto",
  required_data: "Se mantienen los datos necesarios",
  units_or_magnitudes: "Se mantienen las unidades",
  necessary_visual: "Se mantiene el recurso visual",
  response_constraint: "Se mantendrá",
  reasoning_constraint: "El razonamiento seguirá siendo del alumnado",
  evaluation_criterion: "Se mantiene el criterio de evaluación",
  required_vocabulary: "Se mantiene el vocabulario",
  format_requirement: "Se mantiene el formato",
  formula: "Se mantiene la fórmula",
};
/** The protected requirements that a help must never solve or replace. */
const LIMITING_TYPES = new Set(["target_operation", "reasoning_constraint", "evaluation_criterion"]);

export const preserveLine = (item: { type: string; value: string }): string => `${(own(PRESERVE_PREFIX, item.type) ? PRESERVE_PREFIX[item.type] : null) ?? "Se mantendrá"}: ${item.value}`;

export const preservedLines = (preserves: ReadonlyArray<{ type: string; value: string }>): string[] => [...new Set(preserves.map(preserveLine))];

/** Limits shown with a decision: those the review wrote for it, plus what a help must not replace (only when the decision adds a help). */
export function limitLines(decision: { supports: readonly string[]; preserves: ReadonlyArray<{ type: string; value: string }>; restrictions: readonly string[] }): string[] {
  const derived = decision.supports.length > 0 ? decision.preserves.filter((p) => LIMITING_TYPES.has(p.type)).map((p) => `La ayuda no debe resolver ni sustituir: ${p.value}`) : [];
  return [...new Set([...decision.restrictions, ...derived])];
}
