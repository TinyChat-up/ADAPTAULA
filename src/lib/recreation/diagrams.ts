import { pathOf, diagramIssues as shapeIssues, type DiagramSpec } from "@/lib/visuals/diagram";
import { VISUAL_SPEC_VERSION } from "@/lib/visuals/spec";
import type { Diagram, Fact, RecreationActivity, RecreationPlan } from "./contract";
import { normalize, type PlanIssue } from "./verify";

/**
 * New exact schemes designed by Claude (ADR-059). The ORIGINAL decides what is learnt; it does not decide which resources may teach
 * it. A diagram is therefore not tied to a picture of the original: it is anchored to FACTS (quotes of the original, checked word for
 * word by the verifier). Here, deterministic and subject-agnostic:
 *   · its evidence: every node's label is in its fact's quote; both ends of every relation are said in ONE affirmative clause of the
 *     relation's fact, joined by words that are not a mere list (`relationEvidence`). The arrow's direction and meaning are NOT
 *     proven by that: they stay the design's reading, reported as unverified and reviewed by the teacher;
 *   · its structure: a chain, a cycle, a tree or groups that can be drawn as declared;
 *   · its use: the activities that declare it (explicit ids, never guessed), and what the student reads in it (for the leak checks).
 * A relation's label and a group's title are the design's words: they are not evidence and are only checked for answers given away.
 */

const STEM = (w: string) => w.replace(/(es|s)$/, "");

/** Whether a short label is said by a quote: its numbers literally, its content words (stem and prefix: «larvas» ~ «larva»). */
export function labelSupported(label: string, quote: string): boolean {
  const l = normalize(label).split(" ").filter(Boolean);
  const q = normalize(quote).split(" ").filter(Boolean);
  const numbers = l.filter((w) => /^\d+$/.test(w));
  const words = l.filter((w) => !/^\d+$/.test(w) && w.length >= 4).map(STEM);
  if (numbers.length === 0 && words.length === 0) return l.length > 0 && ` ${normalize(quote)} `.includes(` ${l.join(" ")} `);
  const quoteWords = q.filter((w) => !/^\d+$/.test(w)).map(STEM);
  const same = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
  return numbers.every((n) => q.includes(n)) && words.every((w) => quoteWords.some((x) => same(w, x)));
}

// ---------------------------------------------------------------------------------------------------------------------------
// What the evidence of a relation can and cannot show
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Tokens of a quote with its sentence and comma boundaries kept: «.», «;», «!», «?» end a clause, «,» separates items. Numbers keep
 * their form as one token («1/2» → 1f2, «0,75» → 0x75), so a fraction or a decimal is never mistaken for a list.
 */
const tokensOf = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/(\d)\/(\d)/g, "$1f$2").replace(/(\d)[.,](\d)/g, "$1x$2")
    .replace(/([.;!?,])/g, " $1 ").replace(/[^a-z0-9ñ.;!?, ]+/g, " ").split(/\s+/).filter(Boolean);
const isNumber = (t: string) => /^\d[0-9fx]*$/.test(t);
const BOUNDARY = new Set([".", ";", "!", "?"]);
/** Words that deny what the clause says: a negative sentence never evidences that two things are related. */
const NEGATION = new Set(["no", "nunca", "jamas", "tampoco", "ni", "ningun", "ninguno", "ninguna", "nada", "nadie"]);
/** Words that can join two items of a list without relating them («algas y ranas», «de las algas a las ranas» is not this). */
const LINKLESS = new Set(["y", "e", "o", "u", "el", "la", "los", "las", "lo", "un", "una", "unos", "unas", "de", "del", "al", "sus", "su", "tambien", "otros", "otras"]);
const sameWord = (a: string, b: string) => (isNumber(a) || isNumber(b) ? a === b : STEM(a) === STEM(b) || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)));

/** Where a label is said in a clause: spans of its significant words in order, at most three words apart. */
function spansOf(label: string, clause: readonly string[]): Array<[number, number]> {
  const all = tokensOf(label).filter((t) => !BOUNDARY.has(t) && t !== ",");
  const key = all.filter((t) => isNumber(t) || t.length >= 4);
  const want = key.length > 0 ? key : all;
  const out: Array<[number, number]> = [];
  if (want.length === 0) return out;
  clause.forEach((t, i) => {
    if (!sameWord(want[0]!, t)) return;
    let at = i;
    for (const w of want.slice(1)) {
      const next = clause.findIndex((x, j) => j > at && j <= at + 4 && sameWord(w, x));
      if (next < 0) return;
      at = next;
    }
    out.push([i, at]);
  });
  return out;
}

export type RelationEvidence =
  | { ok: true }
  | { ok: false; reason: "missing" | "separate_clauses" | "negated" | "list" | "no_link" };

/**
 * What a quote CAN show about a relation, checked without a model: both ends are said in the SAME clause, the clause is affirmative,
 * and some words join them that are not just a list («algas, larvas y ranas» names three things; it relates none). What it CANNOT
 * show, and is never claimed: what the arrow means or which way it points. That is the design's reading of the sentence, reported as
 * unverified (`diagram_relation_reading_unverified`) and left to the teacher's review like every anchored answer.
 */
export function relationEvidence(from: string, to: string, quote: string): RelationEvidence {
  const tokens = tokensOf(quote);
  const clauses: string[][] = [[]];
  for (const t of tokens) {
    if (BOUNDARY.has(t)) clauses.push([]);
    else clauses[clauses.length - 1]!.push(t);
  }
  type Reason = Extract<RelationEvidence, { ok: false }>["reason"];
  const rank: Record<Reason, number> = { missing: 0, separate_clauses: 1, no_link: 2, list: 3, negated: 4 };
  let best: Reason = "missing";
  const worse = (r: Reason) => {
    if (rank[r] > rank[best]) best = r;
  };
  if (clauses.some((c) => spansOf(from, c).length > 0) && clauses.some((c) => spansOf(to, c).length > 0)) worse("separate_clauses");
  for (const clause of clauses) {
    for (const a of spansOf(from, clause)) {
      for (const b of spansOf(to, clause)) {
        if (a[1] >= b[0] && b[1] >= a[0]) continue;
        const between = clause.slice(Math.min(a[1], b[1]) + 1, Math.max(a[0], b[0]));
        if (clause.some((t) => NEGATION.has(t))) worse("negated");
        else if (between.includes(",")) worse("list");
        else if (between.every((t) => LINKLESS.has(t))) worse("no_link");
        else return { ok: true };
      }
    }
  }
  return { ok: false, reason: best };
}

const RELATION_REASON: Record<Extract<RelationEvidence, { ok: false }>["reason"], string> = {
  missing: "la cita no nombra los dos elementos",
  separate_clauses: "la cita nombra los dos elementos en frases distintas, sin unirlos",
  negated: "la cita es negativa: dice que NO hay esa relación, o la niega",
  list: "la cita solo los enumera (separados por comas), sin relacionarlos",
  no_link: "la cita los nombra juntos, pero sin ninguna palabra que los relacione",
};

/** The diagrams an activity uses: those that list it (Claude's declaration, by id). */
export const diagramsFor = (plan: Pick<RecreationPlan, "diagrams">, activityId: string): Diagram[] => (plan.diagrams ?? []).filter((d) => d.activity_ids.includes(activityId));

/** The exact schemes an activity declares: `rv:` (an original's scheme it lists) and `rd:` (a new one that lists it). */
export const declaredSchemes = (plan: Pick<RecreationPlan, "diagrams">, a: RecreationActivity): string[] => [...a.visual_ids.map((id) => `rv:${id}`), ...diagramsFor(plan, a.id).map((d) => `rd:${d.id}`)];

/** Why a diagram cannot be drawn faithfully: missing or unsupported evidence, unknown activities, or a shape that is not what it says. */
export function diagramPlanIssues(plan: Pick<RecreationPlan, "facts" | "activities">, d: Diagram, facts: ReadonlyMap<string, Fact>): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const path = `diagrams.${d.id}`;
  const error = (code: string, message: string) => issues.push({ severity: "error", code, path, message });
  for (const id of d.activity_ids) if (!plan.activities.some((a) => a.id === id)) error("diagram_activity_unknown", `${id} no existe.`);
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  for (const n of d.nodes) {
    const fact = facts.get(n.fact_id);
    if (!fact) error("diagram_evidence_unknown", `El nodo ${n.id} cita ${n.fact_id}, que no existe en facts.`);
    else if (!labelSupported(n.label, fact.quote)) error("diagram_label_unsupported", `El rótulo «${n.label}» (${n.id}) no aparece en la cita de ${n.fact_id}: usa las palabras del original o cita otro hecho.`);
  }
  for (const r of d.relations) {
    const fact = facts.get(r.fact_id);
    const [from, to] = [nodes.get(r.from), nodes.get(r.to)];
    if (!fact) error("diagram_evidence_unknown", `La relación ${r.from}→${r.to} cita ${r.fact_id}, que no existe en facts.`);
    else if (from && to) {
      const evidence = relationEvidence(from.label, to.label, fact.quote);
      if (!evidence.ok) error("diagram_relation_unsupported", `La relación «${from.label}» → «${to.label}» no tiene apoyo en la cita de ${r.fact_id}: ${RELATION_REASON[evidence.reason]}. Cita la frase afirmativa del original que une los dos elementos, o no dibujes esa flecha.`);
    }
  }
  // Honest about the limit: a sentence that relates two things does not say, to a program, which way the arrow goes or what it means.
  if (d.relations.length > 0) issues.push({ severity: "warning", code: "diagram_relation_reading_unverified", path, message: `«${d.title}»: cada flecha se apoya en una frase afirmativa que une sus dos extremos; su sentido y su significado son la lectura del diseño, sin comprobar: revisión docente.` });
  const groupIndex = new Map(d.groups.map((g, i) => [g.id, i]));
  for (const n of d.nodes) if (n.group_id && !groupIndex.has(n.group_id)) error("diagram_group_unknown", `${n.group_id} no está en groups.`);
  for (const message of shapeIssues(shapeOf(d))) error("diagram_shape", `«${d.title}» (${d.layout}): ${message}.`);
  return issues;
}

const shapeOf = (d: Diagram) => {
  const groupIndex = new Map(d.groups.map((g, i) => [g.id, i]));
  return { layout: d.layout, nodes: d.nodes.map((n) => ({ id: n.id, group: n.group_id ? (groupIndex.get(n.group_id) ?? 99) : null })), edges: d.relations, groups: d.groups };
};

/** The drawing of a diagram (`figure` spec): exactly its nodes, relations and groups; nothing else. */
export function diagramSpecOf(d: Diagram): DiagramSpec {
  const groupIndex = new Map(d.groups.map((g, i) => [g.id, i]));
  return {
    spec_version: VISUAL_SPEC_VERSION,
    kind: "diagram",
    layout: d.layout,
    title: d.title,
    nodes: d.nodes.map((n) => ({ id: n.id, label: n.label, ...(n.group_id && groupIndex.has(n.group_id) ? { group: groupIndex.get(n.group_id)! } : {}) })),
    edges: d.relations.map((r) => ({ from: r.from, to: r.to, ...(r.label ? { label: r.label } : {}) })),
    groups: d.groups.map((g) => g.label),
  };
}

/** What the student reads in a diagram, one text per unit that could state an answer: a group with its items, a relation, the chain. */
export function diagramTexts(d: Diagram): string[] {
  const label = new Map(d.nodes.map((n) => [n.id, n.label]));
  if (d.layout === "groups") return d.groups.map((g) => `${g.label}: ${d.nodes.filter((n) => n.group_id === g.id).map((n) => n.label).join(", ")}`);
  const order = d.layout === "hierarchy" ? null : pathOf(shapeOf(d));
  return [d.title, ...d.relations.map((r) => `${label.get(r.from)} ${r.label ?? "→"} ${label.get(r.to)}`), (order ?? d.nodes.map((n) => n.id)).map((id) => label.get(id)).join(" → ")];
}
