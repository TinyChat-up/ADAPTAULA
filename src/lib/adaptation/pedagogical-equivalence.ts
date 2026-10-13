import type { AnalysisActivity, AnalysisVisual, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { VisualSpec } from "@/lib/visuals/spec";
import { CONSTRAINT_TYPES } from "./facts";
import type { SingleChoiceResponse } from "./single-choice";
import { criticalTokens, hasToken, numbersIn, normalizeText, sharedTokens, wordCount } from "./text";

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

/** The operation a task text asks for, with its response format and whether it has nowhere to write. */
export function operationOf(text: string, responseFormat: AnalysisActivity["response_format"], noAnswerArea: boolean): TaskOperation {
  const norm = normalizeText(text);
  if (responseFormat === "mark" || responseFormat === "draw" || (ACT_VERBS.test(norm) && (FIGURE_NOUNS.test(norm) || noAnswerArea))) return "act_on_representation";
  return READ_VERBS.test(norm) || FIGURE_NOUNS.test(norm) ? "interpret_representation" : "use_data";
}

export function taskProfile(analysis: MaterialAnalysis, activity: AnalysisActivity, visual: AnalysisVisual | undefined): TaskProfile {
  const objectives = analysis.pedagogical_intent.objectives.filter((o) => activity.objective_ids.includes(o.id));
  const operation = operationOf(textOf(activity), activity.response_format, activity.answer_area.type === "none");
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

export interface SubstituteCandidate extends RewriteCandidate {
  /** Structural preservation only; the selection executor must also verify the source options and unique answer. */
  response?: SingleChoiceResponse;
  /** The new activity's own figure (drawn by our renderer), when it brings one. */
  figure: VisualSpec | null;
}

const CONTENT_WORD = /[a-z]{5,}/g;
const STOP = new Set(["actividad", "escribe", "escribela", "respuesta", "fraccion", "fracciones", "cuantos", "cuantas", "despues", "tambien", "siguiente", "observa"]);

/**
 * A NEW activity in place of one whose figure is lost (`visual_substitute`). It may change the material it works on, never what it
 * works: when the representation is required (acting on it, interpreting it, or it is the objective), the substitute brings its
 * own figure and keeps the operation — a representation we cannot draw is never replaced by words (that is the illustration's
 * rung, or an honest stop) —; marking stays on the figure; the same actions are asked; no data are invented beyond its own figure;
 * the demand and the reading load stay; and it is about the same content (shared content words with the original or its objective).
 */
export function substitutionEquivalence(input: { analysis: MaterialAnalysis; activity: AnalysisActivity; visual: AnalysisVisual | undefined; candidate: SubstituteCandidate; needs: readonly string[]; drawable: boolean }): { equivalent: boolean; profile: TaskProfile; violations: string[] } {
  const profile = taskProfile(input.analysis, input.activity, input.visual);
  const { candidate } = input;
  const violations: string[] = [];
  const original = textOf(input.activity);
  const visualText = input.visual ? normalizeText([input.visual.title, input.visual.description, input.visual.text].filter(Boolean).join(" ")) : "";
  const text = normalizeText([candidate.prompt, ...candidate.steps].join(" "));
  const onFigure = input.activity.response_format === "mark" || input.activity.response_format === "draw";
  const selection = profile.responseType === "select_option" && candidate.response?.kind === "choice" && !candidate.response.multiple;
  if (profile.representation === "required" && !candidate.figure) violations.push(input.drawable ? "representation_lost" : "representation_not_drawable");
  if (profile.operation !== "use_data" && candidate.figure && operationOf(text, onFigure ? input.activity.response_format : "write_text", candidate.lines === 0) !== profile.operation) violations.push(`operation_changed(${profile.operation})`);
  // Marking stays on the figure: no writing lines instead of it.
  if (onFigure && (!candidate.figure || candidate.lines !== 0)) violations.push(`response_type_changed(${input.activity.response_format})`);
  // Only the verified selection executor may supply options; other closed formats still cannot become writing lines.
  if (!onFigure && !selection && (NON_WRITTEN.has(profile.responseType) || profile.responseType === "none")) violations.push(`response_type_changed(${profile.responseType})`);
  if (!onFigure && !selection && candidate.lines === 0) violations.push("no_answer_space");
  const verbs = (s: string) => new Set([...s.matchAll(ACTION_VERBS)].map((m) => m[1]!));
  for (const v of verbs(original)) if (!verbs(text).has(v)) violations.push(`action_lost(${v})`);
  for (const v of verbs(text)) if (!verbs(original).has(v)) violations.push(`action_added(${v})`);
  // A substitute may change its figure's data, but not the conditions under which this task is assessed. Only constraints
  // corroborated by the source count: the analyzer's wording must not invent a requirement or borrow it from another activity.
  const constraints = input.analysis.protected_elements
    .filter((p) => p.activity_ids.includes(input.activity.id) && (CONSTRAINT_TYPES as readonly string[]).includes(p.type))
    .flatMap((p) => sharedTokens(p.value, original));
  constraints.push(...criticalTokens(original).filter((t) => t.kind === "quantifier"));
  if (constraints.some((t) => !hasToken(text, t))) violations.push("constraint_lost");
  const figureNumbers = candidate.figure ? specNumbers(candidate.figure) : [];
  const known = new Set([...numbersIn(original), ...numbersIn(visualText), ...figureNumbers]);
  const added = numbersIn(text).filter((n) => !known.has(n));
  if (added.length > 0) violations.push(`new_data(${added.slice(0, 3).join(",")})`);
  const sequencing = input.needs.some((n) => SEQUENCING_NEEDS.has(n));
  if (candidate.steps.length > (sequencing ? 4 : 0)) violations.push("demand_lowered(steps)");
  if (wordCount(text) > wordCount(original) + wordCount(visualText) + 25) violations.push("reading_load_increased");
  if (wordCount(text) < Math.ceil(wordCount(original) * 0.5)) violations.push("demand_lowered(shorter)");
  const objectives = input.analysis.pedagogical_intent.objectives.filter((o) => input.activity.objective_ids.includes(o.id)).map((o) => normalizeText(o.text));
  const words = (s: string) => new Set([...s.matchAll(CONTENT_WORD)].map((m) => m[0]).filter((w) => !STOP.has(w)));
  const reference = words([original, visualText, ...objectives].join(" "));
  if (![...words(text)].some((w) => reference.has(w))) violations.push("objective_unrelated");
  return { equivalent: violations.length === 0, profile, violations };
}

/** The numbers a figure shows (or implies by its structure): a substitute may name them, they are not invented data. */
function specNumbers(spec: VisualSpec): string[] {
  if (spec.kind === "fraction_bar" || spec.kind === "part_whole") return [String(spec.parts), String(spec.shaded.length), `${spec.shaded.length}/${spec.parts}`];
  if (spec.kind === "grid") return [String(spec.rows), String(spec.cols), String(spec.rows * spec.cols), String(spec.shaded.length)];
  if (spec.kind === "number_line") {
    const unit = spec.divisions / Math.max(1, spec.end.n / spec.end.d - spec.start.n / spec.start.d);
    return [String(spec.start.n), String(spec.end.n), String(spec.divisions), ...Array.from({ length: spec.divisions + 1 }, (_, i) => `${i}/${unit}`)];
  }
  return [];
}
