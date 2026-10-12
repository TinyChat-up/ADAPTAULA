import type { AnalysisActivity, AnalysisVisual, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { numbersIn, normalizeText, wordCount } from "./text";

/**
 * Whether an activity rewritten WITHOUT a figure of the original still evaluates the same thing (docs/VISUAL_RESOURCES.md §
 * Equivalencia pedagógica). Deterministic rules by kind of task; a model saying «equivalent» proves nothing. Keeping the numbers
 * is necessary and far from sufficient: «Observa la barra y escribe la fracción sombreada» is not «Escribe tres octavos», and
 * «Marca 3/4 en la recta» is not «¿Cuánto es 3/4?».
 *
 * What is compared, for the activity and its figure:
 *   · objective        the activity's objectives (their words decide whether the representation IS the learning);
 *   · operation        acting on the representation, interpreting it, or using data it carries;
 *   · representation   required (the task is about it) or only a data source (a price list, a timetable);
 *   · demand           steps and length within the original's, no new data, the same action verbs;
 *   · response type    closed or on-the-figure formats cannot become written lines;
 *   · functional needs the reading load does not grow beyond the original and its figure.
 * Only a figure that is a mere data source can be rewritten around; anything else is not equivalent.
 */

export type TaskOperation = "act_on_representation" | "interpret_representation" | "use_data";
export type RepresentationRole = "required" | "data_source";

export interface TaskProfile {
  activityId: string;
  objectiveIds: string[];
  operation: TaskOperation;
  representation: RepresentationRole;
  /** Why the representation is required (empty when it is only a data source). */
  requiredBecause: string[];
  responseType: AnalysisActivity["response_format"];
  demand: AnalysisActivity["difficulty"];
}

/** Doing something ON the figure (imperatives, with an enclitic: «márcala»), never a participle that describes it («coloreada»). */
const ACT_VERBS = /\b(?:marca|marcad|colorea|sombrea|pinta|senala|rodea|dibuja|traza|une|situa|ubica|localiza|coloca)(?:la|lo|las|los|le)?\b|\brellena la (?:figura|barra|recta)\b/;
/** Reading the figure: what it shows, represents or indicates. */
const READ_VERBS = /\b(observa|mira|fijate|segun|lee la|interpreta|representa|representad[ao]s?|que fraccion|indica la (?:barra|recta|figura))\b/;
const FIGURE_NOUNS = /\b(barra|recta|grafico|grafica|figura|dibujo|imagen|esquema|diagrama|mapa|plano|cuadricula|circulo|tira)s?\b/;
/** Visual kinds whose form IS mathematical or spatial information (not a picture that carries a datum). */
const REPRESENTATION_KINDS = new Set<AnalysisVisual["kind"]>(["number_line", "geometric_figure", "diagram", "chart", "map"]);
const REPRESENTATION_OBJECTIVES = /\b(represent|recta|grafic|figura|interpret|situ|localiz|ubic|medi|geometr|mapa|plano|escala|fraccion de (?:una|la) (?:figura|barra|unidad))\w*/;
/** Formats that are not «write an answer»: a rewrite into writing lines changes what is asked. */
const NON_WRITTEN = new Set<AnalysisActivity["response_format"]>(["mark", "draw", "select_option", "match", "order", "fill_blanks"]);
const ACTION_VERBS = /\b(calcula|explica|escribe|compara|ordena|resuelve|justifica|describe|clasifica|relaciona|completa|identifica|averigua|razona|argumenta|estima|suma|resta|multiplica|divide|redacta|responde)(?:la|lo|las|los|le|les)?\b/g;
const SEQUENCING_NEEDS = new Set(["instruction_chunking", "operation_steps", "working_memory_support", "planning_support", "checklist_support"]);

const textOf = (a: AnalysisActivity) => normalizeText(a.context ? `${a.instruction} ${a.context}` : a.instruction);

export function taskProfile(analysis: MaterialAnalysis, activity: AnalysisActivity, visual: AnalysisVisual | undefined): TaskProfile {
  const text = textOf(activity);
  const objectives = analysis.pedagogical_intent.objectives.filter((o) => activity.objective_ids.includes(o.id));
  const actsOnFigure = activity.response_format === "mark" || activity.response_format === "draw" || (ACT_VERBS.test(text) && (FIGURE_NOUNS.test(text) || activity.answer_area.type === "none"));
  const readsFigure = READ_VERBS.test(text) || FIGURE_NOUNS.test(text);
  const operation: TaskOperation = actsOnFigure ? "act_on_representation" : readsFigure ? "interpret_representation" : "use_data";
  const because: string[] = [];
  if (operation !== "use_data") because.push(`operation:${operation}`);
  if (visual && REPRESENTATION_KINDS.has(visual.kind)) because.push(`visual_kind:${visual.kind}`);
  if (objectives.some((o) => REPRESENTATION_OBJECTIVES.test(normalizeText(o.text)))) because.push("objective_about_representation");
  if (visual && analysis.protected_elements.some((p) => p.type === "necessary_visual" && p.importance === "essential" && p.resource_ids.includes(visual.id) && p.activity_ids.includes(activity.id))) because.push("protected_necessary_visual");
  return { activityId: activity.id, objectiveIds: objectives.map((o) => o.id), operation, representation: because.length > 0 ? "required" : "data_source", requiredBecause: because, responseType: activity.response_format, demand: activity.difficulty };
}

export interface RewriteCandidate {
  prompt: string;
  steps: string[];
  lines: number;
}

export function rewriteEquivalence(input: { analysis: MaterialAnalysis; activity: AnalysisActivity; visual: AnalysisVisual | undefined; rewrite: RewriteCandidate; needs: readonly string[] }): { equivalent: boolean; profile: TaskProfile; violations: string[] } {
  const profile = taskProfile(input.analysis, input.activity, input.visual);
  const violations = profile.requiredBecause.map((r) => `representation_required(${r})`);
  if (NON_WRITTEN.has(profile.responseType)) violations.push(`response_type_changed(${profile.responseType})`);
  const original = textOf(input.activity);
  const visualText = input.visual ? normalizeText([input.visual.title, input.visual.description, input.visual.text].filter(Boolean).join(" ")) : "";
  const rewritten = normalizeText([input.rewrite.prompt, ...input.rewrite.steps].join(" "));
  // The same actions are asked (calcula stays calcula; an explanation is not turned into a calculation or the reverse).
  const verbs = (s: string) => new Set([...s.matchAll(ACTION_VERBS)].map((m) => m[1]!));
  for (const v of verbs(original)) if (!verbs(rewritten).has(v)) violations.push(`action_lost(${v})`);
  for (const v of verbs(rewritten)) if (!verbs(original).has(v)) violations.push(`action_added(${v})`);
  // No new data, and the demand is not lowered by a step-by-step solution the profile did not ask for.
  const known = new Set([...numbersIn(original), ...numbersIn(visualText)]);
  const added = numbersIn(rewritten).filter((n) => !known.has(n));
  if (added.length > 0) violations.push(`new_data(${added.slice(0, 3).join(",")})`);
  const sequencing = input.needs.some((n) => SEQUENCING_NEEDS.has(n));
  if (input.rewrite.steps.length > (sequencing ? 4 : 0)) violations.push("demand_lowered(steps)");
  // Functional needs: the reading load does not grow beyond the original and what its figure showed.
  if (wordCount(rewritten) > wordCount(original) + wordCount(visualText) + 5) violations.push("reading_load_increased");
  if (wordCount(rewritten) < Math.ceil(wordCount(original) * 0.6)) violations.push("demand_lowered(shorter)");
  return { equivalent: violations.length === 0, profile, violations };
}
