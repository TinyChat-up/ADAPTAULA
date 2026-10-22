import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { AnalysisActivity, AnalysisProtected, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { ResponseSpec } from "@/lib/schemas/material-document";

/**
 * answer_space@v1 (docs/EDITORIAL.md § Espacios de resolución): how much room, and of which kind, an activity needs to be solved on
 * paper. Deterministic and server-side. It reads what the analysis states in its STRUCTURED fields (activity type, response format,
 * the original's answer area, difficulty, protected elements such as `target_operation` or `units_or_magnitudes`) plus the stage,
 * the grade and the functional needs of the context. The words of the instruction only SIZE a decision those fields already made
 * (how many results it asks for), never make it. A model never sets a size: it may only have stated the need in the analysis.
 *
 * Rules, in order:
 * 1. A closed format, a structure the original prints (fields, items to order, pairs to compare), an answer on the figure or an
 *    answer format a plan decision chose are kept; printed fields only gain room where their label says what they are for.
 * 2. Written calculation (a calculation or a problem in a mathematical context) gets a squared area sized by the results it asks
 *    for; a problem with data to organise or a unit to give gets the optional parts it needs (data, operations, answer).
 * 3. Explanations, short answers and compositions get lines by what they ask for and the grade; a drawing gets a box.
 * 4. Otherwise (unknown or ambiguous), the original's area as it is: never a guess.
 * It never gives less room than the original printed, and never adds a calculation area where the task asks for something else.
 */

export const ANSWER_SPACE_VERSION = "answer_space@v1";

export type SpaceNeed = "calculation" | "explanation" | "short" | "composition" | "drawing" | "keep";

export interface SpaceContext {
  stage: AdaptationContext["education"]["stage"];
  /** 1–6 (Primaria) or 7–12 (ESO 1–4, Bachillerato 1–2); null when unknown. */
  year: number | null;
  mathematical: boolean;
  needs: ReadonlyMap<DimensionKey, "low" | "medium" | "high">;
  protectedOf: (activityId: string) => AnalysisProtected[];
}

const MATH_SUBJECT = /matem|mathem|aritm|c[aá]lculo/i;
const CLOSED = new Set<ResponseSpec["kind"]>(["choice", "fill_blank", "match", "order", "true_false", "comparison", "sequence", "oral_or_alternative", "table_cells", "none"]);
const NOT_WRITTEN = new Set<AnalysisActivity["response_format"]>(["select_option", "mark", "fill_blanks", "match", "order"]);

export function spaceContextOf(analysis: Pick<MaterialAnalysis, "protected_elements">, context: Pick<AdaptationContext, "education" | "needs">): SpaceContext {
  const grade = /^(\d)-(primaria|eso|bachillerato)$/.exec(context.education.grade ?? "");
  const year = grade ? Number(grade[1]) + (grade[2] === "eso" ? 6 : grade[2] === "bachillerato" ? 10 : 0) : null;
  const needs = new Map(context.needs.map((n) => [n.dimension, n.level] as const));
  return {
    stage: context.education.stage,
    year,
    mathematical: MATH_SUBJECT.test(context.education.subject ?? ""),
    needs,
    protectedOf: (id) => analysis.protected_elements.filter((p) => p.activity_ids.includes(id)),
  };
}

const atLeast = (ctx: SpaceContext, key: DimensionKey, level: "low" | "medium") => {
  const l = ctx.needs.get(key);
  return l !== undefined && (level === "low" || l !== "low");
};

/** What the student has to produce, from the analysis's structured fields (see the rules above). */
export function spaceNeed(activity: AnalysisActivity, ctx: SpaceContext): SpaceNeed {
  if (NOT_WRITTEN.has(activity.response_format)) return "keep";
  const operation = ctx.protectedOf(activity.id).some((p) => p.type === "target_operation" || p.type === "formula");
  const numeric = activity.response_format === "calculate" || activity.response_format === "write_number";
  if (activity.response_format === "calculate" && (ctx.mathematical || operation)) return "calculation";
  if ((activity.type === "calculation" || activity.type === "problem_solving") && (ctx.mathematical || operation) && (numeric || activity.response_format === "write_text")) return "calculation";
  if (activity.type === "drawing" || activity.response_format === "draw") return "drawing";
  if (activity.type === "writing") return "composition";
  if (activity.type === "open_question" || activity.type === "experiment" || activity.type === "graph_interpretation") return "explanation";
  if (activity.type === "short_answer" || activity.type === "reading_comprehension" || numeric) return "short";
  return "keep";
}

/**
 * How many results the activity asks for: its questions and its requests, counted in its own words («Calcula el perímetro y el área»
 * = 2, «¿Cuál…? ¿Cuánto…?» = 2). It only sizes a decision the structured fields made, so a miscount costs a few rows, never a format.
 */
export function requestedResults(activity: Pick<AnalysisActivity, "instruction" | "context">): number {
  const text = `${activity.instruction} ${activity.context ?? ""}`;
  const questions = (text.match(/\?/g) ?? []).length;
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => !s.includes("?") && /^\s*(calcula|halla|averigua|resuelve|deduce|compara|opera|suma|resta|multiplica|divide|escribe|indica|explica|nombra|justifica|completa|identifica|muestra|razona|describe)\b/i.test(s));
  // «el perímetro y el área», «la suma y la diferencia»: two results joined in one request.
  const joined = sentences.reduce((n, s) => n + (s.match(/\b(?:el|la|los|las)\s+\p{L}+\s+y\s+(?:el|la|los|las)\s+\p{L}+/gu) ?? []).length, 0);
  // «Escribe dos servicios», «Nombra tres partes»: a request for n items is n answers.
  const items = [...text.matchAll(/\b(?:escribe|nombra|indica|di|cita|enumera|pon)\s+(?:al menos\s+)?(dos|tres|cuatro|cinco|seis|[2-6])\b/giu)].map((m) => NUMERALS[m[1]!.toLowerCase()] ?? Number(m[1]));
  return Math.max(1, questions + sentences.length + joined, ...items);
}

const NUMERALS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };

/** «8 cm», «750 ml», «12 €», «3 kg», «2 h»: quantities the answer is expressed in. */
const UNIT = /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|dm|m|km|cm²|m²|ml|cl|dl|l|g|kg|mg|h|min|s|€|euros?|grados|°)(?![\p{L}])/iu;
/** A datum of the statement: «750», «2,35», «3/4» (a fraction is one datum, not two). */
const NUMBER = /\b\d+(?:[.,]\d+)?(?:\/\d+)?\b/g;

/** Squares per written operation: two operands, the line and the result, with room for the carries. */
const ROWS_PER_OPERATION = 4;
/** A division also writes its remainders under the dividend: two more squares each («has dividido la figura» is not one). */
const DIVISION = /\d\s*[:÷]\s*\d|\bdivide\b|\bdivisi[oó]n/i;
/** The tallest calculation area: Primaria keeps it within a third of the page, older students may need longer workings. */
const maxRows = (ctx: SpaceContext) => (ctx.year !== null && ctx.year <= 6 ? 12 : 14);

/** Lines of an explanation by grade (Primaria 1–2 shorter, ESO and Bachillerato longer). */
const explanationLines = (ctx: SpaceContext) => (ctx.year === null ? 3 : ctx.year <= 2 ? 2 : ctx.year <= 6 ? 3 : ctx.year <= 10 ? 4 : 5);
/** Lines of a composition by grade when the activity states no length. */
const compositionLines = (ctx: SpaceContext) => (ctx.year === null ? 10 : ctx.year <= 2 ? 6 : ctx.year <= 4 ? 8 : ctx.year <= 6 ? 10 : ctx.year <= 10 ? 14 : 18);

/** Words per handwritten line in Primaria and ESO (a 160 mm line at 10 mm). */
const WORDS_PER_LINE = 10;
/** The length an activity states: «4-5 líneas» → 5, «60-80 palabras» → 8, «unas 100 palabras» → 10. Null when it states none. */
export function statedLines(activity: Pick<AnalysisActivity, "instruction" | "context">): number | null {
  const text = `${activity.instruction} ${activity.context ?? ""}`;
  const lines = /(\d{1,2})(?:\s*[-–a]\s*(\d{1,2}))?\s*(?:l[ií]neas|renglones)/i.exec(text);
  if (lines) return Number(lines[2] ?? lines[1]);
  const words = /(\d{2,4})(?:\s*[-–]\s*(\d{2,4})|\s+(?:y|a)\s+(\d{2,4}))?\s*palabras/i.exec(text);
  return words ? Math.ceil(Number(words[2] ?? words[3] ?? words[1]) / WORDS_PER_LINE) : null;
}

const linesOf = (spec: ResponseSpec): number => (spec.kind === "lines" ? spec.lines : spec.kind === "box" ? (spec.size === "small" ? 4 : spec.size === "medium" ? 7 : 12) : 0);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface SpaceDecision {
  need: SpaceNeed;
  response: ResponseSpec;
}

/**
 * The answer area of one activity under answer_space@v1. `current` is what the assembler built from the original (and from a plan
 * decision that changed the answer format, which `decided` marks): this function only widens or restructures open writing areas.
 */
export function answerSpace(activity: AnalysisActivity, current: ResponseSpec, ctx: SpaceContext, decided = false): SpaceDecision {
  const need = spaceNeed(activity, ctx);
  if (decided || CLOSED.has(current.kind)) return { need: "keep", response: current };
  if (current.kind === "fields") return { need, response: sizedFields(current, activity, ctx, need) };
  if (current.kind === "grid") return { need: "calculation", response: { kind: "grid", rows: calculationRows(activity, ctx) } };

  const original = linesOf(current);
  switch (need) {
    case "calculation":
      return { need, response: problemOrGrid(activity, ctx, original) };
    case "explanation": {
      const extra = requestedResults(activity) - 1;
      return { need, response: { kind: "lines", lines: clamp(Math.max(original, explanationLines(ctx) + extra), 1, 12) } };
    }
    case "short":
      // One line per result it asks for (four processes → four lines), never fewer than the original printed.
      return { need, response: current.kind === "box" ? current : { kind: "lines", lines: clamp(Math.max(original, requestedResults(activity)), 1, 8) } };
    case "composition": {
      if (current.kind === "box") return { need, response: current };
      // The length the activity states («4-5 líneas», «60-80 palabras») or the room the original printed for it is the evidence;
      // only without either does the grade decide.
      const stated = statedLines(activity);
      const lines = stated ?? (original >= 4 ? original : Math.max(original, compositionLines(ctx)));
      return { need, response: { kind: "lines", lines: clamp(Math.max(original, lines), 1, 40) } };
    }
    case "drawing":
      // A drawing needs a real surface: the large box (a third of a page), whatever smaller area the original printed.
      return { need, response: { kind: "box", size: "large" } };
    case "keep":
      return { need, response: current };
  }
}

/**
 * How many written operations the activity needs: the results it asks for, the expressions it prints («36 × 4 y 125 + 98 + 47» = 2)
 * and, in a word problem, its data (n data → n − 1 operations), whichever is largest; one more when it is difficult.
 */
export function operationsOf(activity: AnalysisActivity): number {
  const text = `${activity.instruction} ${activity.context ?? ""}`;
  const expressions = (text.match(/\d+(?:[.,]\d+)?(?:\s*[+\-−×x·*:÷/]\s*\d+(?:[.,]\d+)?)+/g) ?? []).length;
  const data = activity.type === "problem_solving" ? Math.min(4, (text.match(NUMBER) ?? []).length - 1) : 0;
  return Math.max(requestedResults(activity), expressions, data) + (activity.difficulty === "high" ? 1 : 0);
}

/** Squares for the operations of a calculation: by its operations, what it must show and the profile's need for steps. */
export function calculationRows(activity: AnalysisActivity, ctx: SpaceContext): number {
  const text = `${activity.instruction} ${activity.context ?? ""}`;
  const perOperation = ROWS_PER_OPERATION + (DIVISION.test(text) ? 2 : 0);
  // A constraint that asks to show the procedure (how the figure was divided, the steps) needs room to draw or write it.
  const show = ctx.protectedOf(activity.id).some((p) => p.type === "response_constraint" || p.type === "reasoning_constraint") ? 2 : 0;
  const steps = atLeast(ctx, "operation_steps", "medium") ? 2 : 0;
  return clamp(operationsOf(activity) * perOperation + show + steps + 1, 5, maxRows(ctx));
}

/**
 * A problem's optional parts. Operations always (a squared area). Data and reasoning only for a word problem with something to
 * organise: a statement with several data, or a profile that needs help to plan or to hold the data. The answer for a word problem
 * and for a calculation whose result is a quantity, with an empty slot for the unit when there are units. Never the unit itself.
 */
function problemOrGrid(activity: AnalysisActivity, ctx: SpaceContext, originalLines: number): ResponseSpec {
  const rows = calculationRows(activity, ctx);
  const statement = `${activity.instruction} ${activity.context ?? ""}`;
  const units = UNIT.test(statement) || ctx.protectedOf(activity.id).some((p) => p.type === "units_or_magnitudes");
  // A bare calculation is answered in its squares; one whose result is a quantity with its unit also gets a place to state it.
  if (activity.type !== "problem_solving" && !units) return { kind: "grid", rows };
  const data = (statement.match(NUMBER) ?? []).length;
  const organise = activity.type === "problem_solving" && (data >= 3 || atLeast(ctx, "planning_support", "medium") || atLeast(ctx, "working_memory_support", "medium") || atLeast(ctx, "operation_steps", "medium"));
  const answerLines = clamp(Math.max(requestedResults(activity), originalLines > 3 ? 2 : 1), 1, 4);
  return {
    kind: "fields",
    fields: [
      ...(organise ? [{ label: "Datos y razonamiento", space: "lines" as const, lines: 2 }] : []),
      { label: "Operaciones", space: "grid" as const, lines: rows },
      { label: "Respuesta", space: "lines" as const, lines: answerLines, ...(units ? { unit: true } : {}) },
    ],
  };
}

/** The numbered items the activity prints before its fields («1. Los alumnos…», «2. Mi hermana…»). */
const numberedItems = (activity: AnalysisActivity) => (activity.context ?? "").split(/\r?\n/).map((l) => /^\s*(\d{1,2})\s*[.)]\s+\S/.exec(l)?.[1]).filter((n): n is string => n !== undefined);

/**
 * Printed fields keep their labels and order; a field meant for operations becomes a squared area. When the instruction asks for
 * them «for each» of several numbered items («Separa el sujeto y el predicado de cada oración»), each item gets its own set,
 * labelled with its number: one answer per sentence, never two sentences on one line.
 */
function sizedFields(current: Extract<ResponseSpec, { kind: "fields" }>, activity: AnalysisActivity, ctx: SpaceContext, need: SpaceNeed): ResponseSpec {
  const items = numberedItems(activity);
  if (items.length >= 2 && /\bcada\b/i.test(activity.instruction) && items.length * current.fields.length <= 12 && current.fields.every((f) => f.label.length <= 50)) {
    return sizedFields({ kind: "fields", fields: items.flatMap((n) => current.fields.map((f) => ({ ...f, label: `${n}. ${f.label}` }))) }, { ...activity, context: null }, ctx, need);
  }
  const units = ctx.protectedOf(activity.id).some((p) => p.type === "units_or_magnitudes") || UNIT.test(`${activity.instruction} ${activity.context ?? ""}`);
  const fields = current.fields.map((f) => {
    if (f.space !== "grid" && /operaci|c[aá]lcul|cuentas|procedimiento/i.test(f.label) && need === "calculation") return { ...f, space: "grid" as const, lines: Math.max(f.lines, calculationRows(activity, ctx)) };
    if (/^respuesta$/i.test(f.label) && need === "calculation" && units && f.unit === undefined) return { ...f, unit: true };
    return f;
  });
  return { kind: "fields", fields };
}
