import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { Diagram, RecreationActivity, RecreationPlan } from "./contract";
import { normalize } from "./verify";

/**
 * Which exact scheme belongs to which activity (ADR-058). The plan may declare several schemes (`visuals`); an activity that depends on
 * a relation gets ONLY the one that corresponds to it, by evidence the plan itself carries — never the first one of a list:
 *   · the scheme the activity lists (`visual_ids`) — decided by Claude, always wins and is handled by the caller;
 *   · when it lists none: a scheme whose source is cited by the activity's own facts or by the original picture its requests point at,
 *     or whose labels the activity itself names (two or more);
 *   · the original's own diagram under the same evidence.
 * Several candidates are ambiguous and none is guessed: the activity is reported as lacking its scheme (and the sheet is incomplete).
 */

export interface Flow {
  /** Stable key of the resource in the document: `rv:<plan scheme id>`, `orig:<original visual id>` or `rd:<new scheme id>` (ADR-059). */
  key: string;
  origin: "plan" | "original" | "diagram";
  /** For a new scheme: the design itself (drawn with code from it). */
  diagram?: Diagram;
  title: string;
  items: string[];
  source_ref: string;
}

export type SchemeChoice = { ok: true; flow: Flow } | { ok: false; reason: "none" | "ambiguous"; candidates: string[] };

/** What the student reads of an activity: the instruction, its steps and every text of its response format. */
export function activityTexts(a: RecreationActivity, plan: Pick<RecreationPlan, "facts">): string {
  const e = a.executor;
  const facts = new Map(plan.facts.map((f) => [f.id, f]));
  const extra =
    e.kind === "classify" ? [...e.categories.map((c) => c.label), ...e.item_fact_ids.map((id) => { const f = facts.get(id); return f?.kind === "membership" ? f.item : ""; })]
    : e.kind === "select" ? e.options.map((o) => o.text)
    : e.kind === "true_false" ? e.statements.map((st) => st.text)
    : e.kind === "short_answer" ? e.starters
    : [];
  return [a.prompt, ...a.steps, ...extra].join(" ");
}

/** The sources an activity is built on: the originals its facts quote and the pictures its own requests point at. */
export function activityRefs(a: RecreationActivity, plan: Pick<RecreationPlan, "facts" | "visual_requests">): Set<string> {
  const used = new Set(JSON.stringify(a.executor).match(/f_[0-9]+/g) ?? []);
  return new Set([
    ...plan.facts.filter((f) => used.has(f.id)).map((f) => f.source_ref),
    ...plan.visual_requests.filter((r) => r.activity_ids.includes(a.id) && r.original_ref).map((r) => r.original_ref!),
  ]);
}

const sentence = (l: string) => l.charAt(0).toUpperCase() + l.slice(1).toLowerCase();

/** The original's diagram as an exact scheme: labels joined by «→» (2–6, short). */
export function originalFlowOf(visual: MaterialAnalysis["visuals"][number]): Flow | null {
  const labels = (visual.text ?? "").split("→").map((l) => l.trim()).filter(Boolean);
  if (!(visual.text ?? "").includes("→") || labels.length < 2 || labels.length > 6 || labels.some((l) => l.length > 40)) return null;
  return { key: `orig:${visual.id}`, origin: "original", title: (visual.title ?? "Esquema").slice(0, 60), items: labels.map(sentence), source_ref: visual.id };
}

/** A new scheme as a candidate: its labels stand for its items; it has no picture of the original behind it. */
export const diagramFlow = (d: Diagram): Flow => ({ key: `rd:${d.id}`, origin: "diagram", title: d.title, items: d.nodes.map((n) => n.label), source_ref: "", diagram: d });

/** The facts an activity's executor relies on (by id). */
const factIdsOf = (a: RecreationActivity) => new Set(JSON.stringify(a.executor).match(/f_[0-9]+/g) ?? []);

export const planFlow = (v: RecreationPlan["visuals"][number]): Flow => ({ key: `rv:${v.id}`, origin: "plan", title: v.title, items: v.items, source_ref: v.source_ref });

export function chooseScheme(a: RecreationActivity, plan: Pick<RecreationPlan, "visuals" | "visual_requests" | "facts" | "diagrams">, analysis?: MaterialAnalysis): SchemeChoice {
  const refs = activityRefs(a, plan);
  const text = normalize(activityTexts(a, plan));
  const named = (items: readonly string[]) => items.filter((i) => text.includes(normalize(i))).length;
  // A new scheme (ADR-059) by explicit evidence: it relies on a fact the activity's own answer uses, or the activity names two of its labels.
  const used = factIdsOf(a);
  const sharesFact = (d: Diagram) => [...d.nodes, ...d.relations].some((x) => used.has(x.fact_id));
  const fromPlan = [...plan.visuals.filter((v) => refs.has(v.source_ref) || named(v.items) >= 2).map(planFlow), ...(plan.diagrams ?? []).filter((d) => sharesFact(d) || named(d.nodes.map((n) => n.label)) >= 2).map(diagramFlow)];
  if (fromPlan.length === 1) return { ok: true, flow: fromPlan[0]! };
  if (fromPlan.length > 1) return { ok: false, reason: "ambiguous", candidates: fromPlan.map((f) => f.key) };
  const fromOriginal = (analysis?.visuals ?? []).filter((v) => refs.has(v.id)).map(originalFlowOf).filter((f): f is Flow => f !== null);
  if (fromOriginal.length === 1) return { ok: true, flow: fromOriginal[0]! };
  return { ok: false, reason: fromOriginal.length > 1 ? "ambiguous" : "none", candidates: fromOriginal.map((f) => f.key) };
}
