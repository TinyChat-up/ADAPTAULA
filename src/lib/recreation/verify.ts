import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { COGNITIVE_OPERATIONS, type CognitiveOperation, type Fact, type RecreationActivity, type RecreationPlan } from "./contract";

/**
 * The server's checks of a recreation plan, before anything is printed. Pure and deterministic. A plan with an `error` is not
 * compiled; `warning`s go to the teacher guide. Every activity gets a verification status that says HOW its solution is known:
 *   verified        derived here from quoted facts (sequence: their order in the text; compute: the arithmetic): unique;
 *   anchored        every item or claimed answer cites a quoted fact, and the format makes it unique, but its meaning still needs the
 *                   teacher's look (classify: the group is curricular knowledge; select, true_false);
 *   teacher_review  open answer: criteria only.
 * Nothing is «verified» because the model that wrote it also wrote its solution.
 */

export type VerificationStatus = "verified" | "anchored" | "teacher_review";

export type Solution =
  | { kind: "pairs"; pairs: Array<{ item: string; category: string }> }
  | { kind: "order"; solution: string[]; printed: string[] }
  | { kind: "number"; value: number; unit: string; operation: string }
  | { kind: "options"; correct: string[] }
  | { kind: "truth"; values: Array<{ text: string; value: boolean }> }
  | { kind: "criteria"; criteria: string[] };

export interface VerifiedActivity {
  id: string;
  status: VerificationStatus;
  solution: Solution;
}

export interface PlanIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface Verification {
  ok: boolean;
  issues: PlanIssue[];
  activities: VerifiedActivity[];
  /** The operations each original objective evaluates (read from the original's activities): the minimum the plan keeps. */
  required: Record<string, CognitiveOperation[]>;
}

export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The printed words of a reference of the original (a text, a visual's labels and cells, an activity's statement). */
export function sourceText(analysis: MaterialAnalysis, ref: string): string | null {
  const text = analysis.texts.find((t) => t.id === ref);
  if (text) return text.text;
  const visual = analysis.visuals.find((v) => v.id === ref);
  if (visual) return [visual.title, visual.text, ...(visual.table ? [...visual.table.headers, ...visual.table.rows.flat()] : [])].filter(Boolean).join(" · ");
  const activity = analysis.activities.find((a) => a.id === ref);
  if (activity) return [activity.instruction, activity.context].filter(Boolean).join(" ");
  return null;
}

/**
 * The cognitive operations an original activity asks for, from its type and the verbs of its instruction. A deterministic minimum
 * (Spanish verbs of the instruction), not a reading of intentions: the plan may add operations, never drop one of these.
 */
const VERBS: Array<[RegExp, CognitiveOperation]> = [
  [/\bidentific/, "identify"],
  [/\binformacion del texto\b|\bque te ha permitido\b|\busa informacion\b/, "locate_evidence"],
  [/\bclasific/, "classify"],
  [/\bordena/, "sequence"],
  [/\bflechas?\b|\brelacion/, "interpret_relation"],
  [/\bque podria ocurrir\b|\bprediccion\b|\bconsecuencia/, "predict"],
  [/\bcuant|\boperacion\b|\bcalcula/, "calculate"],
  [/\bvalora\b|\bestas de acuerdo\b/, "evaluate_claim"],
  [/\bjustifica|\bexplica\b|\bdefender\b/, "justify"],
  [/\bpropon/, "propose"],
];
const TYPE_OPERATION: Partial<Record<MaterialAnalysis["activities"][number]["type"], CognitiveOperation>> = { classification: "classify", sequencing: "sequence", calculation: "calculate", problem_solving: "calculate" };

export function originalOperations(analysis: MaterialAnalysis): Record<string, CognitiveOperation[]> {
  const out: Record<string, Set<CognitiveOperation>> = {};
  for (const objective of analysis.pedagogical_intent.objectives) out[objective.id] = new Set();
  for (const activity of analysis.activities) {
    const words = normalize(activity.instruction);
    const ops = new Set<CognitiveOperation>(VERBS.filter(([re]) => re.test(words)).map(([, op]) => op));
    const typed = TYPE_OPERATION[activity.type];
    if (typed) ops.add(typed);
    for (const id of activity.objective_ids) for (const op of ops) out[id]?.add(op);
  }
  return Object.fromEntries(Object.entries(out).map(([id, ops]) => [id, COGNITIVE_OPERATIONS.filter((op) => ops.has(op))]));
}

const EXECUTOR_OPERATION: Partial<Record<RecreationActivity["executor"]["kind"], CognitiveOperation>> = { classify: "classify", sequence: "sequence", compute: "calculate" };

/** A fixed, readable order for printed items that is never the solution's: alphabetical, rotated by one if it would be. */
function printedOrder(solution: readonly string[]): string[] {
  const sorted = [...solution].sort((a, b) => a.localeCompare(b, "es"));
  return sorted.every((s, i) => s === solution[i]) ? [...sorted.slice(1), sorted[0]!] : sorted;
}

export function verifyPlan(plan: RecreationPlan, analysis: MaterialAnalysis, input: { needs: readonly DimensionKey[] }): Verification {
  const issues: PlanIssue[] = [];
  const error = (code: string, path: string, message: string) => issues.push({ severity: "error", code, path, message });
  const warning = (code: string, path: string, message: string) => issues.push({ severity: "warning", code, path, message });

  // 1 · Scope: what this engine may do with this sheet.
  if (plan.scope.type === "curricular") error("curricular_not_supported", "scope", "La adaptación curricular necesita una autorización por ficha y no forma parte de este piloto.");
  if (plan.scope.type === "accessibility") error("recreation_requires_methodological", "scope", "Recrear actividades cambia la forma de trabajar y responder: requiere el alcance metodológico.");

  // 2 · Objectives and cognitive operations: every objective of the original, kept, with at least the operations it evaluated.
  const required = originalOperations(analysis);
  const planned = new Map(plan.objectives.map((o) => [o.objective_id, o]));
  for (const id of Object.keys(required)) if (!planned.has(id)) error("objective_dropped", "objectives", `Falta el objetivo ${id} del original.`);
  for (const o of plan.objectives) {
    if (!(o.objective_id in required)) error("objective_unknown", "objectives", `${o.objective_id} no es un objetivo del original.`);
    if (o.level !== "kept" && plan.scope.type !== "curricular") error("objective_level_changed", "objectives", `${o.objective_id}: el nivel solo cambia con autorización curricular.`);
    for (const op of required[o.objective_id] ?? []) if (!o.operations.includes(op)) error("operation_dropped", "objectives", `${o.objective_id} deja de evaluar «${op}».`);
    for (const op of o.operations) {
      if (!plan.activities.some((a) => a.objective_ids.includes(o.objective_id) && a.operations.includes(op))) error("operation_unworked", "objectives", `${o.objective_id}: ninguna actividad trabaja «${op}».`);
    }
  }

  // 3 · Facts: quoted from the original, word for word (normalised).
  const facts = new Map<string, Fact>();
  for (const f of plan.facts) {
    if (facts.has(f.id)) error("duplicate_id", `facts.${f.id}`, "Identificador repetido.");
    facts.set(f.id, f);
    const source = sourceText(analysis, f.source_ref);
    if (source === null) error("fact_source_unknown", `facts.${f.id}`, `${f.source_ref} no existe en el original.`);
    else if (!normalize(source).includes(normalize(f.quote))) error("fact_not_in_source", `facts.${f.id}`, `La cita no aparece en ${f.source_ref}.`);
  }
  if (plan.reading && !analysis.texts.some((t) => t.id === plan.reading!.source_ref && t.kind === "reading_text")) error("reading_unknown", "reading", "La lectura citada no es un texto de lectura del original.");

  // 4 · Strategies answer the profile's needs (only the needs of this context: nothing about the student beyond them).
  const needs = new Set(input.needs);
  for (const s of plan.strategies) for (const n of s.needs) if (!needs.has(n)) error("strategy_need_unknown", `strategies.${s.id}`, `${n} no es una necesidad de este contexto.`);

  // 5 · Visuals: their labels are the original's.
  for (const v of plan.visuals) {
    const source = sourceText(analysis, v.source_ref);
    if (source === null) error("visual_source_unknown", `visuals.${v.id}`, `${v.source_ref} no existe.`);
    else for (const item of v.items) if (!normalize(source).includes(normalize(item))) error("visual_label_not_in_source", `visuals.${v.id}`, `«${item}» no está en ${v.source_ref}.`);
  }

  // 6 · Activities: traced, new, and with a solution obtained the safest way their format allows.
  const ids = new Set(plan.activities.map((a) => a.id));
  if (ids.size !== plan.activities.length) error("duplicate_id", "activities", "Identificadores de actividad repetidos.");
  const strategies = new Set(plan.strategies.map((s) => s.id));
  const visuals = new Set(plan.visuals.map((v) => v.id));
  const verified: VerifiedActivity[] = [];
  for (const a of plan.activities) {
    const path = `activities.${a.id}`;
    const allowed = new Set(a.objective_ids.flatMap((id) => planned.get(id)?.operations ?? []));
    for (const id of a.objective_ids) if (!planned.has(id)) error("activity_objective_unknown", path, `${id} no está entre los objetivos del plan.`);
    for (const op of a.operations) if (!allowed.has(op)) error("activity_operation_untraced", path, `«${op}» no es una operación de sus objetivos.`);
    for (const id of a.strategy_ids) if (!strategies.has(id)) error("activity_strategy_unknown", path, `${id} no existe.`);
    for (const id of a.visual_ids) if (!visuals.has(id)) error("activity_visual_unknown", path, `${id} no existe.`);
    const needed = EXECUTOR_OPERATION[a.executor.kind];
    if (needed && !a.operations.includes(needed)) error("executor_operation_mismatch", path, `El formato ${a.executor.kind} trabaja «${needed}».`);
    const copied = analysis.activities.find((o) => similarity(o.instruction, a.prompt) >= NOT_NEW_SIMILARITY);
    if (copied) error("activity_not_new", path, `Repite el enunciado de ${copied.id}: el motor diseña actividades nuevas.`);
    const result = solve(a, facts, analysis, (code, message) => error(code, path, message));
    if (result) verified.push({ id: a.id, ...result });
  }

  // 7 · Nothing the student reads gives away a closed answer.
  for (const leak of leaks(plan, verified)) error("solution_revealed", leak.path, leak.message);

  for (const m of plan.materials) if (!ids.has(m.activity_id)) error("material_activity_unknown", `materials.${m.id}`, `${m.activity_id} no existe.`);
  for (const g of plan.guide.per_activity) if (!ids.has(g.activity_id)) error("guide_activity_unknown", "guide", `${g.activity_id} no existe.`);
  for (const a of plan.activities) if (!plan.guide.per_activity.some((g) => g.activity_id === a.id)) warning("guide_missing", `activities.${a.id}`, "Sin indicación para el docente.");

  return { ok: !issues.some((i) => i.severity === "error"), issues, activities: verified, required };
}

function solve(a: RecreationActivity, facts: ReadonlyMap<string, Fact>, analysis: MaterialAnalysis, fail: (code: string, message: string) => void): Omit<VerifiedActivity, "id"> | null {
  const e = a.executor;
  const fact = <K extends Fact["kind"]>(id: string, kind: K): Extract<Fact, { kind: K }> | null => {
    const f = facts.get(id);
    if (!f || f.kind !== kind) {
      fail("fact_missing", `${id} no es un dato de tipo ${kind}.`);
      return null;
    }
    return f as Extract<Fact, { kind: K }>;
  };
  switch (e.kind) {
    case "classify": {
      const members = e.item_fact_ids.map((id) => fact(id, "membership"));
      if (members.some((m) => m === null)) return null;
      const labels = new Map(e.categories.map((c) => [c.id, c.label]));
      const pairs = members.map((m) => ({ item: m!.item, category: labels.get(m!.category_id) ?? "" }));
      if (pairs.some((p) => !p.category)) return fail("category_unknown", "Un elemento apunta a una categoría que no se ofrece."), null;
      if (new Set(pairs.map((p) => normalize(p.item))).size !== pairs.length) return fail("item_repeated", "Un elemento aparece dos veces."), null;
      for (const c of e.categories) if (!pairs.some((p) => p.category === c.label)) fail("category_empty", `Ningún elemento va en «${c.label}».`);
      for (const m of members) if (!normalize(m!.quote).includes(normalize(m!.item))) fail("item_not_quoted", `«${m!.item}» no está en su cita.`);
      // The items are the original's and each goes to exactly one group (unique by construction), but which group is curricular
      // knowledge the server cannot prove from the words: anchored, not verified.
      return { status: "anchored", solution: { kind: "pairs", pairs } };
    }
    case "sequence": {
      const events = e.event_fact_ids.map((id) => fact(id, "event"));
      if (events.some((x) => x === null)) return null;
      if (new Set(events.map((x) => x!.source_ref)).size !== 1) return fail("sequence_sources", "Los hechos de una secuencia deben venir del mismo texto."), null;
      const solution = sequenceOf(events as Array<Extract<Fact, { kind: "event" }>>, analysis, fail);
      return solution ? { status: "verified", solution } : null;
    }
    case "compute": {
      const a1 = fact(e.minuend_fact_id, "quantity");
      const b1 = fact(e.subtrahend_fact_id, "quantity");
      if (!a1 || !b1) return null;
      if (normalize(a1.unit) !== normalize(b1.unit)) return fail("unit_mismatch", "Las dos cantidades deben tener la misma unidad."), null;
      const value = a1.value - b1.value;
      if (value <= 0) return fail("difference_not_positive", "La diferencia debe ser positiva."), null;
      return { status: "verified", solution: { kind: "number", value, unit: a1.unit, operation: `${a1.value} − ${b1.value} = ${value}` } };
    }
    case "select": {
      const correct = e.options.filter((o) => o.correct);
      if (correct.length !== e.correct_count) fail("correct_count_mismatch", `Hay ${correct.length} opciones correctas y se anuncian ${e.correct_count}.`);
      if (e.correct_count > 1 && !new RegExp(`\\b(${["", "una", "dos", "tres"][e.correct_count]}|${e.correct_count})\\b`).test(normalize(a.prompt))) fail("count_not_stated", "El enunciado debe decir cuántas opciones hay que marcar.");
      for (const o of correct) if (!o.evidence_fact_id || !fact(o.evidence_fact_id, "statement")) fail("option_unanchored", `«${o.text}» no cita el dato del texto que la apoya.`);
      if (new Set(e.options.map((o) => normalize(o.text))).size !== e.options.length) fail("option_repeated", "Opciones repetidas.");
      return { status: "anchored", solution: { kind: "options", correct: correct.map((o) => o.text) } };
    }
    case "true_false":
      for (const s of e.statements) fact(s.evidence_fact_id, "statement");
      if (e.statements.every((s) => s.value) || e.statements.every((s) => !s.value)) fail("true_false_uniform", "Todas las afirmaciones tienen el mismo valor.");
      return { status: "anchored", solution: { kind: "truth", values: e.statements.map((s) => ({ text: s.text, value: s.value })) } };
    case "short_answer":
      return { status: "teacher_review", solution: { kind: "criteria", criteria: e.criteria } };
  }
}

/** The order of events is where their words appear in the original's text: distinct positions, so the order is unique. */
function sequenceOf(events: Array<Extract<Fact, { kind: "event" }>>, analysis: MaterialAnalysis, fail: (code: string, message: string) => void): Solution | null {
  const text = normalize(sourceText(analysis, events[0]!.source_ref) ?? "");
  const positions = events.map((e) => ({ label: e.label, at: text.indexOf(normalize(e.quote)) }));
  if (new Set(positions.map((p) => p.at)).size !== positions.length) {
    fail("sequence_ambiguous", "Dos hechos ocupan la misma posición del texto: el orden no sería único.");
    return null;
  }
  const solution = [...positions].sort((a, b) => a.at - b.at).map((p) => p.label);
  return { kind: "order", solution, printed: printedOrder(solution) };
}

/**
 * Word overlap of two statements (Jaccard over words of 4+ letters). ≥ 0.5 means the «new» activity is the original's statement,
 * reworded. The topic's own words («estanque», «mayo», «junio») are shared by any activity on the same content, so the measure is
 * over the union, not the shorter text.
 */
export const NOT_NEW_SIMILARITY = 0.5;
export function similarity(a: string, b: string): number {
  const words = (s: string) => new Set(normalize(s).split(" ").filter((w) => w.length >= 4));
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared);
}

/** Student-facing text of each activity (its prompt and steps, its sentence starters, the visuals it shows). */
function studentTexts(plan: RecreationPlan, a: RecreationActivity): string[] {
  const visuals = plan.visuals.filter((v) => a.visual_ids.includes(v.id)).map((v) => v.items.join(" → "));
  const starters = a.executor.kind === "short_answer" ? a.executor.starters : [];
  return [a.prompt, ...a.steps, ...starters, ...visuals];
}

function leaks(plan: RecreationPlan, verified: readonly VerifiedActivity[]): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  const everywhere = plan.activities.flatMap((a) => studentTexts(plan, a).map((text) => ({ owner: a.id, text: normalize(text) })));
  for (const v of verified) {
    const others = (self: boolean) => everywhere.filter((t) => self || t.owner !== v.id);
    const s = v.solution;
    if (s.kind === "number" && others(true).some((t) => new RegExp(`\\b${s.value}\\b`).test(t.text))) out.push({ path: `activities.${v.id}`, message: `El resultado ${s.value} aparece en el material del alumno.` });
    // «Que las larvas…» as an option and «las larvas…» in a step are the same answer: the introducing «que» is not content.
    if (s.kind === "options") for (const c of s.correct) if (others(false).some((t) => t.text.includes(normalize(c).replace(/^que /, "")))) out.push({ path: `activities.${v.id}`, message: `La opción correcta «${c}» aparece en otra actividad.` });
    if (s.kind === "pairs") for (const p of s.pairs) if (others(true).some((t) => t.text.includes(normalize(p.item)) && t.text.includes(normalize(p.category)))) out.push({ path: `activities.${v.id}`, message: `Un texto del alumno dice a qué grupo va «${p.item}».` });
    if (s.kind === "order") {
      const keys = s.solution.map(normalize);
      for (const t of others(true)) {
        const at = keys.map((k) => t.text.indexOf(k)).filter((i) => i >= 0);
        if (at.length >= 3 && at.every((x, i) => i === 0 || x > at[i - 1]!)) out.push({ path: `activities.${v.id}`, message: "Un texto del alumno muestra la secuencia en su orden." });
      }
    }
  }
  return out;
}
