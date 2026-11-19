import { pathOf, diagramIssues as shapeIssues, type DiagramSpec } from "@/lib/visuals/diagram";
import { VISUAL_SPEC_VERSION } from "@/lib/visuals/spec";
import type { Diagram, Fact, RecreationActivity, RecreationPlan } from "./contract";
import { normalize, type PlanIssue } from "./verify";

/**
 * New exact schemes designed by Claude (ADR-059). The ORIGINAL decides what is learnt; it does not decide which resources may teach
 * it. A diagram is therefore not tied to a picture of the original: it is anchored to FACTS (quotes of the original, checked word for
 * word by the verifier). Here, deterministic and subject-agnostic:
 *   · its evidence: every node's label is in its fact's quote; both ends of every relation are in the quote of the relation's fact;
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
    else if (from && to && !(labelSupported(from.label, fact.quote) && labelSupported(to.label, fact.quote))) error("diagram_relation_unsupported", `La relación «${from.label}» → «${to.label}» no la enuncia la cita de ${r.fact_id}: cita la frase del original que une los dos elementos, o no la dibujes.`);
  }
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
