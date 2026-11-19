import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { COGNITIVE_OPERATIONS, type CognitiveOperation, type Fact, type RecreationActivity, type RecreationPlan } from "./contract";

/**
 * The server's checks of a recreation plan, before anything is printed. Pure and deterministic. A plan with an `error` is not
 * compiled; `warning`s go to the teacher guide. Each activity gets a status saying HOW MUCH of its solution the server has proven:
 *
 *   verified        proven here, from the original's words: the arithmetic of two unambiguous quantities, the order of events in the
 *                   text, or a temporal/causal order every step of which a connector of the text states. Unique.
 *   anchored        NOT verified. Each item or claimed answer cites the original, and the format allows one answer, but whether the
 *                   claim is right (which group, which option, true or false, an order the text does not state) is the model's word:
 *                   the teacher checks it before the sheet is used.
 *   teacher_review  open answer: criteria only.
 *
 * Nothing is «verified» because the model that wrote it also wrote its solution. A wrong number, a wrong unit or a quote that does
 * not say what the plan claims is an ERROR (the plan is rejected), not a downgrade.
 *
 * Separately, `equivalence` records the review of pedagogical equivalence per objective: what the server could check (operations,
 * production kept, items kept) and what it cannot (that the new activity demands the same reasoning), which stays PENDING until a
 * person or a semantic reviewer confirms it. It is never reported as passed by default.
 */

export const RECREATION_VERIFIER_VERSION = "recreation_verify@v2";

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
  /** What the server proved, or why it could not (for the guide and the provenance record). */
  basis: string;
}

export interface PlanIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export type CheckStatus = "passed" | "failed" | "pending";
export interface EquivalenceEntry {
  objective_id: string;
  checks: Array<{ code: string; status: CheckStatus; note: string }>;
}

export interface Verification {
  ok: boolean;
  issues: PlanIssue[];
  activities: VerifiedActivity[];
  /** The operations each original objective evaluates (read from the original's activities): the minimum the plan keeps. */
  required: Record<string, CognitiveOperation[]>;
  equivalence: EquivalenceEntry[];
  /** Whether a person must review something before the sheet is used. Always true while anything is anchored or pending. */
  review_required: boolean;
  version: typeof RECREATION_VERIFIER_VERSION;
}

import { diagramPlanIssues, diagramTexts, diagramsFor } from "./diagrams";

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
 * (Spanish verbs of the instruction), not a reading of intentions: the plan may add operations, never drop one of these. Keeping the
 * LABEL is necessary, not sufficient: see `equivalence`.
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

function operationsOf(activity: MaterialAnalysis["activities"][number]): Set<CognitiveOperation> {
  const words = normalize(activity.instruction);
  const ops = new Set<CognitiveOperation>(VERBS.filter(([re]) => re.test(words)).map(([, op]) => op));
  const typed = TYPE_OPERATION[activity.type];
  if (typed) ops.add(typed);
  return ops;
}

export function originalOperations(analysis: MaterialAnalysis): Record<string, CognitiveOperation[]> {
  const out: Record<string, Set<CognitiveOperation>> = {};
  for (const objective of analysis.pedagogical_intent.objectives) out[objective.id] = new Set();
  for (const activity of analysis.activities) for (const id of activity.objective_ids) for (const op of operationsOf(activity)) out[id]?.add(op);
  return Object.fromEntries(Object.entries(out).map(([id, ops]) => [id, COGNITIVE_OPERATIONS.filter((op) => ops.has(op))]));
}

export const EXECUTOR_OPERATION: Partial<Record<RecreationActivity["executor"]["kind"], CognitiveOperation>> = { classify: "classify", sequence: "sequence", compute: "calculate" };
/** Operations the student PRODUCES (writes or says): replacing them by choosing among given options lowers the demand. */
const PRODUCTION_OPERATIONS: ReadonlySet<CognitiveOperation> = new Set(["justify", "propose", "predict", "locate_evidence"]);

/** A fixed, readable order for printed items that is never the solution's: alphabetical, rotated by one if it would be. */
function printedOrder(solution: readonly string[]): string[] {
  const sorted = [...solution].sort((a, b) => a.localeCompare(b, "es"));
  return sorted.every((s, i) => s === solution[i]) ? [...sorted.slice(1), sorted[0]!] : sorted;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Quantities: the quote must SAY the number and its unit.
// ---------------------------------------------------------------------------------------------------------------------------------

const UNIT_WORDS: Record<string, string[]> = {
  mm: ["mm", "milimetro", "milimetros"],
  cm: ["cm", "centimetro", "centimetros"],
  m: ["m", "metro", "metros"],
  km: ["km", "kilometro", "kilometros"],
  g: ["g", "gramo", "gramos"],
  kg: ["kg", "kilo", "kilos", "kilogramo", "kilogramos"],
  l: ["l", "litro", "litros"],
  ml: ["ml", "mililitro", "mililitros"],
  min: ["min", "minuto", "minutos"],
  h: ["h", "hora", "horas"],
  "°c": ["c", "grados", "grado"],
};
const unitWords = (unit: string) => UNIT_WORDS[unit.trim().toLowerCase()] ?? [normalize(unit)];
const NUMBER = /\d+(?:[.,]\d+)?/g;
const asNumber = (s: string) => Number(s.replace(",", "."));

/**
 * How a quantity fact stands against its quote: `wrong` (the quote does not carry that number, or carries it with another unit — a
 * wrong datum, the plan is rejected), `ambiguous` (the number is there but the server cannot tell it is the one meant: several
 * numbers, no unit next to it, or the quote repeated in the source) or `exact`.
 */
export function quantityEvidence(fact: Extract<Fact, { kind: "quantity" }>, source: string): { status: "exact" | "ambiguous" | "wrong"; reason: string } {
  const quote = normalize(fact.quote);
  const numbers = [...quote.matchAll(NUMBER)];
  const hits = numbers.filter((m) => asNumber(m[0]) === fact.value);
  if (hits.length === 0) return { status: "wrong", reason: `la cita no contiene ${fact.value}` };
  const after = quote.slice(hits[0]!.index! + hits[0]![0].length).trim().split(" ")[0] ?? "";
  const units = unitWords(fact.unit);
  if (after && Object.values(UNIT_WORDS).some((words) => words.includes(after)) && !units.includes(after)) return { status: "wrong", reason: `en la cita ${fact.value} va con «${after}», no con «${fact.unit}»` };
  if (!units.includes(after)) return { status: "ambiguous", reason: `la cita no pone la unidad junto a ${fact.value}` };
  if (numbers.length > 1) return { status: "ambiguous", reason: "la cita contiene más de una cifra" };
  if (normalize(source).split(quote).length - 1 > 1) return { status: "ambiguous", reason: "la cita aparece más de una vez en el original" };
  return { status: "exact", reason: "cifra y unidad en la cita" };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sequences: the order of appearance is not the order of events.
// ---------------------------------------------------------------------------------------------------------------------------------

const TEMPORAL_CONNECTORS = /\b(despues|luego|entonces|mas tarde|a continuacion|al final|finalmente|antes de|primero|por ultimo)\b/;
const CAUSAL_CONNECTORS = /\b(porque|por eso|por lo que|asi que|provoca|provoco|causa|causo|hace que|hizo que|debido a|como consecuencia|por culpa de)\b/;
/** A prompt that asks when or why things happened, not where the text tells them. */
const ASKS_TIME_OR_CAUSE = /\b(primero|despues|antes|luego|que paso|por que|causa|consecuencia)\b/;

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

  // 3 · Facts: quoted from the original, word for word (normalised); a quantity also says its number and unit.
  const facts = new Map<string, Fact>();
  const quantities = new Map<string, ReturnType<typeof quantityEvidence>>();
  for (const f of plan.facts) {
    if (facts.has(f.id)) error("duplicate_id", `facts.${f.id}`, "Identificador repetido.");
    facts.set(f.id, f);
    const source = sourceText(analysis, f.source_ref);
    if (source === null) error("fact_source_unknown", `facts.${f.id}`, `${f.source_ref} no existe en el original.`);
    else if (!normalize(source).includes(normalize(f.quote))) error("fact_not_in_source", `facts.${f.id}`, `La cita no aparece en ${f.source_ref}.`);
    else if (f.kind === "quantity") {
      const evidence = quantityEvidence(f, source);
      quantities.set(f.id, evidence);
      if (evidence.status === "wrong") error("quantity_not_supported", `facts.${f.id}`, `Dato incorrecto: ${evidence.reason}.`);
    }
  }
  if (plan.reading && !analysis.texts.some((t) => t.id === plan.reading!.source_ref && t.kind === "reading_text")) error("reading_unknown", "reading", "La lectura citada no es un texto de lectura del original.");

  // 4 · Strategies answer the profile's needs (only the needs of this context: nothing about the student beyond them).
  const needs = new Set(input.needs);
  for (const s of plan.strategies) for (const n of s.needs) if (!needs.has(n)) error("strategy_need_unknown", `strategies.${s.id}`, `${n} no es una necesidad de este contexto.`);

  // 5 · Visuals: their labels are the original's. Requested pictures: traced to activities and objectives, never decoration.
  for (const v of plan.visuals) {
    const source = sourceText(analysis, v.source_ref);
    if (source === null) error("visual_source_unknown", `visuals.${v.id}`, `${v.source_ref} no existe.`);
    else for (const item of v.items) if (!normalize(source).includes(normalize(item))) error("visual_label_not_in_source", `visuals.${v.id}`, `«${item}» no está en ${v.source_ref}.`);
  }
  // 5b · New schemes (ADR-059): every node and relation anchored to a quoted fact; a shape that can be drawn as declared.
  const factsById = new Map(plan.facts.map((f) => [f.id, f]));
  for (const d of plan.diagrams ?? []) for (const issue of diagramPlanIssues(plan, d, factsById)) issues.push(issue);
  const ids = new Set(plan.activities.map((a) => a.id));
  for (const r of plan.visual_requests) {
    for (const id of r.activity_ids) if (!ids.has(id)) error("visual_request_activity_unknown", `visual_requests.${r.id}`, `${id} no existe.`);
    for (const id of r.objective_ids) {
      if (!planned.has(id)) error("visual_request_objective_unknown", `visual_requests.${r.id}`, `${id} no es un objetivo del plan.`);
      else if (!plan.activities.some((a) => r.activity_ids.includes(a.id) && a.objective_ids.includes(id))) error("visual_request_untraced", `visual_requests.${r.id}`, `${id} no lo trabaja ninguna de sus actividades.`);
    }
    if (r.original_ref && !analysis.visuals.some((v) => v.id === r.original_ref)) error("visual_request_original_unknown", `visual_requests.${r.id}`, `${r.original_ref} no existe.`);
    if (r.for_cards) {
      const cards = plan.materials.find((m) => m.id === r.for_cards);
      if (!cards || cards.kind !== "cut_out_cards" || !r.activity_ids.includes(cards.activity_id)) error("visual_request_cards_unknown", `visual_requests.${r.id}`, "Las ilustraciones de tarjetas deben ser de unas tarjetas de sus actividades.");
    }
  }

  // 6 · Activities: traced, new, proportionate, and with a solution obtained the safest way their format allows.
  if (ids.size !== plan.activities.length) error("duplicate_id", "activities", "Identificadores de actividad repetidos.");
  if (plan.activities.length > 2 * plan.objectives.length) warning("workload", "activities", `${plan.activities.length} actividades para ${plan.objectives.length} objetivos: revisar la carga de trabajo.`);
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
    const result = solve(a, facts, quantities, analysis, (code, message) => error(code, path, message), (code, message) => warning(code, path, message));
    if (result) verified.push({ id: a.id, ...result });
  }

  // 7 · Nothing the student reads gives away a closed answer, in its words or in other words.
  for (const leak of leaks(plan, verified)) error("solution_revealed", leak.path, leak.message);

  for (const m of plan.materials) {
    if (!ids.has(m.activity_id)) error("material_activity_unknown", `materials.${m.id}`, `${m.activity_id} no existe.`);
    // A board sorts the items of a classification into ITS groups: other columns would teach (or test) something else.
    const target = plan.activities.find((a) => a.id === m.activity_id)?.executor;
    if (m.kind === "sorting_board" && (target?.kind !== "classify" || normalize(m.columns.join("|")) !== normalize(target.categories.map((c) => c.label).join("|")))) error("board_mismatch", `materials.${m.id}`, "Las columnas del tablero deben ser los grupos de su actividad de clasificar.");
    if (m.kind === "cut_out_cards" && target?.kind === "classify") {
      const items = new Set(target.item_fact_ids.map((id) => facts.get(id)).flatMap((f) => (f?.kind === "membership" ? [normalize(f.item)] : [])));
      if (m.cards.some((c) => !items.has(normalize(c))) || m.cards.length !== items.size) error("cards_mismatch", `materials.${m.id}`, "Las tarjetas deben ser exactamente los elementos que se clasifican.");
    }
  }
  for (const issue of explanationIssues(plan, verified, needs)) error(issue.code, "explanation", issue.message);
  for (const c of plan.custom_resources ?? []) for (const id of c.activity_ids) if (!ids.has(id)) error("custom_resource_activity_unknown", `custom_resources.${c.id}`, `${id} no existe.`);
  for (const g of plan.guide.per_activity) if (!ids.has(g.activity_id)) error("guide_activity_unknown", "guide", `${g.activity_id} no existe.`);
  for (const a of plan.activities) if (!plan.guide.per_activity.some((g) => g.activity_id === a.id)) warning("guide_missing", `activities.${a.id}`, "Sin indicación para el docente.");

  // 8 · Pedagogical equivalence, objective by objective: what is checked, what failed, what stays pending.
  const equivalence = equivalenceReview(plan, analysis, required);
  for (const e of equivalence) for (const c of e.checks) if (c.status === "failed") error(`equivalence_${c.code}`, `objectives.${e.objective_id}`, c.note);

  const ok = !issues.some((i) => i.severity === "error");
  // A new scheme's arrows are anchored, not proven (ADR-059): their reading always goes through the teacher.
  const review_required = verified.some((v) => v.status !== "verified") || equivalence.some((e) => e.checks.some((c) => c.status !== "passed")) || (plan.diagrams ?? []).some((d) => d.relations.length > 0);
  return { ok, issues, activities: verified, required, equivalence, review_required, version: RECREATION_VERIFIER_VERSION };
}

function solve(
  a: RecreationActivity,
  facts: ReadonlyMap<string, Fact>,
  quantities: ReadonlyMap<string, ReturnType<typeof quantityEvidence>>,
  analysis: MaterialAnalysis,
  fail: (code: string, message: string) => void,
  warn: (code: string, message: string) => void,
): Omit<VerifiedActivity, "id"> | null {
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
      return { status: "anchored", solution: { kind: "pairs", pairs }, basis: "Ítems del original; el grupo de cada uno lo propone el planificador y no está comprobado." };
    }
    case "sequence": {
      const events = e.event_fact_ids.map((id) => fact(id, "event"));
      if (events.some((x) => x === null)) return null;
      if (new Set(events.map((x) => x!.source_ref)).size !== 1) return fail("sequence_sources", "Los hechos de una secuencia deben venir del mismo texto."), null;
      const text = normalize(sourceText(analysis, events[0]!.source_ref) ?? "");
      const positions = events.map((x) => ({ id: x!.id, label: x!.label, at: text.indexOf(normalize(x!.quote)) }));
      if (new Set(positions.map((p) => p.at)).size !== positions.length) return fail("sequence_ambiguous", "Dos hechos ocupan la misma posición del texto: el orden no sería único."), null;
      const ordered = [...positions].sort((x, y) => x.at - y.at);
      const solution: Solution = { kind: "order", solution: ordered.map((p) => p.label), printed: printedOrder(ordered.map((p) => p.label)) };
      if (e.basis === "text_order") {
        if (ASKS_TIME_OR_CAUSE.test(normalize(a.prompt)) && !/\btexto\b/.test(normalize(a.prompt))) {
          warn("sequence_basis_mismatch", "El enunciado pregunta qué pasó antes o por qué, pero la solución es el orden en que lo cuenta el texto.");
          return { status: "anchored", solution, basis: "Orden de aparición en el texto; el enunciado pide otro orden." };
        }
        return { status: "verified", solution, basis: "Orden en que lo cuenta el texto (posición de cada cita)." };
      }
      // Temporal or causal: every consecutive pair needs a statement of the text that contains both events with a connector between them.
      const connector = e.basis === "temporal" ? TEMPORAL_CONNECTORS : CAUSAL_CONNECTORS;
      const unproven: string[] = [];
      for (let i = 0; i + 1 < ordered.length; i++) {
        const from = ordered[i]!;
        const to = ordered[i + 1]!;
        const link = e.links.find((l) => l.from_fact_id === from.id && l.to_fact_id === to.id);
        const evidence = link ? facts.get(link.evidence_fact_id) : undefined;
        const q = evidence?.kind === "statement" ? normalize(evidence.quote) : "";
        const quoteA = normalize(facts.get(from.id)!.quote);
        const qa = q.indexOf(quoteA);
        const qb = q.indexOf(normalize(facts.get(to.id)!.quote));
        // The connector must stand BETWEEN the two events («A. Después, B»): one inside A («Después de A, C») orders A and C, not B.
        const between = qa >= 0 && qb > qa ? q.slice(qa + quoteA.length, qb) : "";
        if (!connector.test(between)) unproven.push(`${from.label} → ${to.label}`);
      }
      if (unproven.length > 0) {
        warn("sequence_order_unproven", `El texto cuenta estos hechos en este orden, pero no dice que ocurrieran (o se causaran) así: ${unproven.join("; ")}.`);
        return { status: "anchored", solution, basis: `Orden ${e.basis === "temporal" ? "temporal" : "causal"} propuesto; el texto no lo demuestra en ${unproven.length} paso(s).` };
      }
      return { status: "verified", solution, basis: `Orden ${e.basis === "temporal" ? "temporal" : "causal"} demostrado por conectores del texto.` };
    }
    case "compute": {
      const a1 = fact(e.minuend_fact_id, "quantity");
      const b1 = fact(e.subtrahend_fact_id, "quantity");
      if (!a1 || !b1) return null;
      if (normalize(a1.unit) !== normalize(b1.unit)) return fail("unit_mismatch", "Las dos cantidades deben tener la misma unidad."), null;
      const value = Math.round((a1.value - b1.value) * 1000) / 1000;
      if (value <= 0) return fail("difference_not_positive", "La diferencia debe ser positiva."), null;
      const evidence = [quantities.get(a1.id), quantities.get(b1.id)];
      if (evidence.some((x) => x?.status === "wrong")) return null;
      const operation = `${a1.value} − ${b1.value} = ${value}`;
      const doubtful = evidence.filter((x) => x?.status !== "exact").map((x) => x?.reason ?? "sin comprobar");
      if (doubtful.length > 0) {
        warn("quantity_ambiguous", `No se puede asegurar qué cifra es la que se pide: ${doubtful.join("; ")}.`);
        return { status: "anchored", solution: { kind: "number", value, unit: a1.unit, operation }, basis: "Aritmética correcta sobre cifras que el original no deja inequívocas." };
      }
      return { status: "verified", solution: { kind: "number", value, unit: a1.unit, operation }, basis: "Aritmética sobre dos cifras con su unidad, citadas sin ambigüedad." };
    }
    case "select": {
      const correct = e.options.filter((o) => o.correct);
      if (correct.length !== e.correct_count) fail("correct_count_mismatch", `Hay ${correct.length} opciones correctas y se anuncian ${e.correct_count}.`);
      if (e.correct_count > 1 && !new RegExp(`\\b(${["", "una", "dos", "tres"][e.correct_count]}|${e.correct_count})\\b`).test(normalize(a.prompt))) fail("count_not_stated", "El enunciado debe decir cuántas opciones hay que marcar.");
      for (const o of correct) if (!o.evidence_fact_id || !fact(o.evidence_fact_id, "statement")) fail("option_unanchored", `«${o.text}» no cita el dato del texto que la apoya.`);
      if (new Set(e.options.map((o) => normalize(o.text))).size !== e.options.length) fail("option_repeated", "Opciones repetidas.");
      // A distractor that the cited text supports as much as a correct option would make two answers right.
      for (const o of e.options.filter((x) => !x.correct)) {
        const supporting = correct.map((c) => (c.evidence_fact_id ? facts.get(c.evidence_fact_id) : undefined)).filter((f): f is Fact => f !== undefined);
        if (supporting.some((f) => saysInOrder(o.text, f.quote))) fail("distractor_supported", `El distractor «${o.text}» lo dice el mismo dato que una opción correcta.`);
      }
      return { status: "anchored", solution: { kind: "options", correct: correct.map((o) => o.text) }, basis: "Cada opción correcta cita el texto; que sea la única correcta lo revisa el docente." };
    }
    case "true_false":
      for (const s of e.statements) fact(s.evidence_fact_id, "statement");
      if (e.statements.every((s) => s.value) || e.statements.every((s) => !s.value)) fail("true_false_uniform", "Todas las afirmaciones tienen el mismo valor.");
      return { status: "anchored", solution: { kind: "truth", values: e.statements.map((s) => ({ text: s.text, value: s.value })) }, basis: "Cada afirmación cita el texto; su valor lo propone el planificador y no está comprobado." };
    case "short_answer":
      return { status: "teacher_review", solution: { kind: "criteria", criteria: e.criteria }, basis: "Respuesta abierta: criterios para el docente." };
  }
}

/**
 * Word overlap of two statements (Jaccard over words of 4+ letters). ≥ 0.5 means the «new» activity is the original's statement,
 * reworded. The topic's own words («estanque», «mayo», «junio») are shared by any activity on the same content, so the measure is
 * over the union, not the shorter text.
 */
export const NOT_NEW_SIMILARITY = 0.5;
const contentWords = (s: string) => new Set(normalize(s).split(" ").filter((w) => w.length >= 4).map((w) => w.replace(/(es|s)$/, "")));
export function similarity(a: string, b: string): number {
  const x = contentWords(a);
  const y = contentWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared);
}
/**
 * Whether `text` says `claim`: all of the claim's content words, in the claim's order. Order matters: «las algas se alimentan de
 * larvas» is the reverse of «las larvas se alimentan de algas», a legitimate distractor, not the same claim.
 */
export function saysInOrder(claim: string, text: string): boolean {
  const words = normalize(claim).split(" ").filter((w) => w.length >= 4).map((w) => w.replace(/(es|s)$/, ""));
  if (words.length < 2) return false;
  const stems = normalize(text).split(" ").map((w) => w.replace(/(es|s)$/, ""));
  let at = 0;
  for (const w of words) {
    const found = stems.indexOf(w, at);
    if (found < 0) return false;
    at = found + 1;
  }
  return true;
}
/** The share of the content words of `answer` that `text` contains (a paraphrase that keeps the key words). */
export function containment(answer: string, text: string): number {
  const x = contentWords(answer);
  const y = contentWords(text);
  if (x.size === 0) return 0;
  return [...x].filter((w) => y.has(w)).length / x.size;
}

/** Everything the student reads in each activity: prompt, steps, starters, the visuals it shows and its printed items and options. */
function studentTexts(plan: RecreationPlan, a: RecreationActivity, verified: ReadonlyMap<string, VerifiedActivity>): string[] {
  const visuals = [...plan.visuals.filter((v) => a.visual_ids.includes(v.id)).map((v) => v.items.join(" → ")), ...diagramsFor(plan, a.id).flatMap(diagramTexts)];
  const e = a.executor;
  const solution = verified.get(a.id)?.solution;
  const printed =
    e.kind === "short_answer" ? e.starters
    : e.kind === "select" ? e.options.map((o) => o.text)
    : e.kind === "true_false" ? e.statements.map((s) => s.text)
    : solution?.kind === "order" ? solution.printed
    : solution?.kind === "pairs" ? solution.pairs.map((p) => p.item)
    : [];
  const cards = plan.materials.filter((m) => m.activity_id === a.id).flatMap((m) => [m.instructions, ...(m.kind === "cut_out_cards" ? m.cards : [])]);
  return [a.prompt, ...a.steps, ...printed, ...visuals, ...cards];
}

/** What a printed statement asserts as TRUE (a correct option, a true statement): the only texts that can hand over an answer. */
function assertedTexts(a: RecreationActivity): string[] {
  const e = a.executor;
  return e.kind === "select" ? e.options.filter((o) => o.correct).map((o) => o.text) : e.kind === "true_false" ? e.statements.filter((s) => s.value).map((s) => s.text) : [];
}

const RELATION_VERBS = /\b(aliment\w*|come\w*|comen|depred\w*|presa|caza\w*|sirve de alimento)\b/;

function leaks(plan: RecreationPlan, verifiedList: readonly VerifiedActivity[]): Array<{ path: string; message: string }> {
  const verified = new Map(verifiedList.map((v) => [v.id, v]));
  const out: Array<{ path: string; message: string }> = [];
  const texts = plan.activities.flatMap((a) => studentTexts(plan, a, verified).map((text) => ({ owner: a.id, raw: text, text: normalize(text) })));
  const asserted = plan.activities.flatMap((a) => assertedTexts(a).map((text) => ({ owner: a.id, raw: text })));
  for (const v of verifiedList) {
    const path = `activities.${v.id}`;
    const others = texts.filter((t) => t.owner !== v.id);
    const all = texts;
    const s = v.solution;
    if (s.kind === "number" && all.some((t) => new RegExp(`\\b${s.value}\\b`).test(t.text))) out.push({ path, message: `El resultado ${s.value} aparece en el material del alumno.` });
    if (s.kind === "options") {
      for (const c of s.correct) {
        if (others.some((t) => t.text.includes(normalize(c).replace(/^que /, "")))) out.push({ path, message: `La opción correcta «${c}» aparece en otra actividad.` });
        // In other words: a statement another activity presents as true that keeps the answer's key words.
        else if (asserted.some((t) => t.owner !== v.id && containment(c, t.raw) >= 0.6 && contentWords(c).size >= 2)) out.push({ path, message: `Otra actividad afirma como cierta la opción «${c}» con otras palabras.` });
      }
    }
    if (s.kind === "pairs") for (const p of s.pairs) if (all.some((t) => t.text.includes(normalize(p.item)) && t.text.includes(normalize(p.category)))) out.push({ path, message: `Un texto del alumno dice a qué grupo va «${p.item}».` });
    if (s.kind === "order") {
      const keys = s.solution.map(normalize);
      for (const t of others) {
        const at = keys.map((k) => t.text.indexOf(k)).filter((i) => i >= 0);
        if (at.length >= 3 && at.every((x, i) => i === 0 || x > at[i - 1]!)) out.push({ path, message: "Un texto del alumno muestra la secuencia en su orden." });
      }
      // Two consecutive events stated as true elsewhere give the step away.
      for (let i = 0; i + 1 < s.solution.length; i++) {
        if (asserted.some((t) => t.owner !== v.id && containment(s.solution[i]!, t.raw) >= 0.6 && containment(s.solution[i + 1]!, t.raw) >= 0.6)) out.push({ path, message: `Otra actividad afirma que «${s.solution[i]}» va unido a «${s.solution[i + 1]}».` });
      }
    }
  }
  // A new scheme cannot name the relation an activity asks the student to interpret (ADR-059): its arrows go unlabelled there.
  for (const a of plan.activities.filter((x) => x.operations.includes("interpret_relation"))) {
    for (const d of diagramsFor(plan, a.id)) if (d.relations.some((r) => r.label)) out.push({ path: `activities.${a.id}`, message: `El esquema «${d.title}» rotula sus flechas y la actividad pide interpretar esa relación: deja «label» a null.` });
  }
  // A scheme whose arrows an activity asks to interpret: no other text may state the relation between two joined boxes.
  for (const a of plan.activities.filter((x) => x.operations.includes("interpret_relation"))) {
    for (const v of plan.visuals.filter((x) => a.visual_ids.includes(x.id))) {
      const heads = v.items.map((item) => contentWords(item).values().next().value ?? normalize(item));
      for (let i = 0; i + 1 < heads.length; i++) {
        const [x, y] = [heads[i]!, heads[i + 1]!];
        for (const t of texts.filter((t) => t.owner !== a.id)) {
          const words = contentWords(t.raw);
          if (words.has(x) && words.has(y) && RELATION_VERBS.test(t.text)) out.push({ path: `activities.${a.id}`, message: `Otra actividad dice qué relación une «${v.items[i]}» y «${v.items[i + 1]}», que es lo que se pregunta.` });
        }
      }
    }
  }
  return out;
}

/**
 * Review of pedagogical equivalence per original objective. Labels of operations are kept by construction (step 2); this asks what
 * the server CAN check about the reasoning and says plainly what it cannot:
 *  · production   an operation the student produced in the original (justify, propose, predict, locate evidence) is still produced
 *                 (an open answer), not chosen among given options;
 *  · items        a classification keeps at least the items the original listed;
 *  · operation    a calculation that asked to write the operation still asks for it;
 *  · reasoning    that the new activity demands the same reasoning: PENDING, always, until a person or a semantic reviewer says so.
 */
export function equivalenceReview(plan: RecreationPlan, analysis: MaterialAnalysis, required: Record<string, CognitiveOperation[]>): EquivalenceEntry[] {
  return Object.keys(required).map((objective) => {
    const originals = analysis.activities.filter((x) => x.objective_ids.includes(objective));
    const recreated = plan.activities.filter((x) => x.objective_ids.includes(objective));
    const checks: EquivalenceEntry["checks"] = [];
    for (const op of (required[objective] ?? []).filter((o) => PRODUCTION_OPERATIONS.has(o))) {
      const produced = recreated.some((x) => x.operations.includes(op) && x.executor.kind === "short_answer");
      checks.push({ code: "production", status: produced ? "passed" : "failed", note: produced ? `«${op}» se sigue produciendo (respuesta abierta).` : `En el original el alumno producía «${op}»; ahora solo elige entre opciones: baja la exigencia.` });
    }
    for (const original of originals.filter((x) => x.type === "classification")) {
      const listed = (original.context ?? "").split(/[·;,\n]/).map((x) => x.trim()).filter(Boolean).length;
      const kept = Math.max(0, ...recreated.map((x) => (x.executor.kind === "classify" ? x.executor.item_fact_ids.length : 0)));
      if (listed > 0) checks.push({ code: "items", status: kept >= listed ? "passed" : "failed", note: kept >= listed ? `Se clasifican ${kept} elementos (el original, ${listed}).` : `Se clasifican ${kept} elementos y el original pedía ${listed}.` });
    }
    for (const original of originals.filter((x) => /\boperacion\b/.test(normalize(x.instruction)))) {
      const asks = recreated.some((x) => x.executor.kind === "compute");
      checks.push({ code: "operation", status: asks ? "passed" : "failed", note: asks ? "Se pide escribir la operación." : `${original.id} pedía escribir la operación y ninguna actividad nueva la pide.` });
    }
    checks.push({ code: "reasoning", status: "pending", note: "Que las actividades nuevas exijan el mismo razonamiento no lo comprueba el sistema: lo confirma el docente (o una revisión semántica)." });
    return { objective_id: objective, checks };
  });
}

/** Labels of conditions: the explanation speaks of functional needs, never of diagnoses (docs/PRIVACY.md). */
const DIAGNOSTIC = /\b(dislex\w*|tdah|tda|tea|autis\w*|asperger|discalcul\w*|disgraf\w*|discapacidad\w*|trastorno\w*|sindrome\w*|diagnost\w*|deficit\w*|hiperactiv\w*|deficiencia\w*|retraso\w*|patolog\w*)\b/;

/**
 * The teacher's explanation is shown on screen as it is: plain language, no diagnosis, every reason tied to a need of this context,
 * and no answer of any activity (a result, a correct option, the group of an item, an order) — the same rule as the student's texts.
 */
export function explanationIssues(plan: RecreationPlan, verified: readonly VerifiedActivity[], needs: ReadonlySet<DimensionKey>): Array<{ code: string; message: string }> {
  const out: Array<{ code: string; message: string }> = [];
  const texts = [...plan.explanation.adapted, ...plan.explanation.why.map((w) => w.text), ...plan.explanation.how_to_use, ...plan.guide.per_activity.map((g) => g.observe)];
  if (texts.some((t) => DIAGNOSTIC.test(normalize(t)))) out.push({ code: "explanation_diagnostic", message: "La explicación nombra un diagnóstico o una etiqueta: habla de necesidades funcionales." });
  for (const w of plan.explanation.why) for (const n of w.needs) if (!needs.has(n)) out.push({ code: "explanation_need_unknown", message: `${n} no es una necesidad de este contexto.` });
  const all = texts.map(normalize);
  for (const v of verified) {
    const s = v.solution;
    const says = (claim: string) => all.some((t) => t.includes(normalize(claim).replace(/^que /, "")) || saysInOrder(claim, t));
    if (s.kind === "number" && all.some((t) => new RegExp(`\\b${s.value}\\b`).test(t))) out.push({ code: "explanation_reveals", message: `La explicación da el resultado de ${v.id}.` });
    if (s.kind === "options" && s.correct.some(says)) out.push({ code: "explanation_reveals", message: `La explicación da la opción correcta de ${v.id}.` });
    if (s.kind === "pairs" && s.pairs.some((p) => all.some((t) => t.includes(normalize(p.item)) && t.includes(normalize(p.category))))) out.push({ code: "explanation_reveals", message: `La explicación dice a qué grupo va un elemento de ${v.id}.` });
    if (s.kind === "order" && all.some((t) => s.solution.filter((x) => t.includes(normalize(x))).length >= 2)) out.push({ code: "explanation_reveals", message: `La explicación da el orden de ${v.id}.` });
  }
  return out;
}
