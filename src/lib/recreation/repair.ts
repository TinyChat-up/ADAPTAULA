import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { RecreationPlan, RecreationScope } from "./contract";
import { stripUnresolved } from "./references";
import { EXECUTOR_OPERATION, explanationIssues, normalize, originalOperations, sourceText, verifyPlan, type Verification } from "./verify";

/**
 * Deterministic repairs of a planner answer (ADR-053), applied BEFORE and AFTER the verifier, without a model call and without
 * relaxing any essential check. Real plans failed as a whole for mechanical slips (a dangling id, a board whose columns are spelt
 * differently from its activity's groups, an objective marked «adjusted», one line of the teacher's explanation that names an
 * answer), and the paid repair call reproduced others. Here:
 *
 *   sanitizePlan  fixes what has ONE correct value the server knows (references, the scope, the board's columns, the cards of a
 *                 classification, the operations an executor implies, the original's operations of each objective) and drops what
 *                 only decorates (a picture request, a guide line, an explanation line) when it is wrong.
 *   salvagePlan   when only some activities fail (an answer leaked, an unproven order, an unknown fact, a copied prompt), removes
 *                 THOSE activities and keeps the plan only if every objective and operation of the original is still worked.
 *
 * Never: inventing a fact, changing an answer, lowering an objective, or keeping an activity whose solution failed its check.
 */

const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];

export function sanitizePlan(input: RecreationPlan, analysis: MaterialAnalysis, needs: readonly DimensionKey[], scope: RecreationScope["type"]): RecreationPlan {
  const plan: RecreationPlan = structuredClone(input);
  const required = originalOperations(analysis);
  const needSet = new Set(needs);

  // The scope is the server's: methodological recreation never changes an objective's level.
  if (scope !== "curricular" && plan.scope.type !== "curricular") plan.scope = { type: scope } as RecreationScope;
  plan.objectives = plan.objectives.filter((o) => o.objective_id in required);
  for (const o of plan.objectives) {
    if (plan.scope.type !== "curricular") o.level = "kept";
    o.operations = uniq([...(required[o.objective_id] ?? []), ...o.operations]).slice(0, 6);
  }
  for (const id of Object.keys(required)) {
    if (!plan.objectives.some((o) => o.objective_id === id)) plan.objectives.push({ objective_id: id, level: "kept", operations: [...required[id]!].slice(0, 6) });
  }
  const objectives = new Map(plan.objectives.map((o) => [o.objective_id, o]));

  plan.strategies = plan.strategies.map((s) => ({ ...s, needs: s.needs.filter((n) => needSet.has(n)) })).filter((s) => s.needs.length > 0);
  const strategies = new Set(plan.strategies.map((s) => s.id));
  plan.visuals = plan.visuals.filter((v) => {
    const source = sourceText(analysis, v.source_ref);
    return source !== null && v.items.every((item) => normalize(source).includes(normalize(item)));
  });
  const visuals = new Set(plan.visuals.map((v) => v.id));

  for (const a of plan.activities) {
    a.objective_ids = a.objective_ids.filter((id) => objectives.has(id));
    const allowed = new Set(a.objective_ids.flatMap((id) => objectives.get(id)?.operations ?? []));
    const needed = EXECUTOR_OPERATION[a.executor.kind];
    const ops = uniq([...(needed && allowed.has(needed) ? [needed] : []), ...a.operations.filter((op) => allowed.has(op))]).slice(0, 3);
    if (ops.length > 0) a.operations = ops;
    a.strategy_ids = a.strategy_ids.filter((id) => strategies.has(id));
    a.visual_ids = a.visual_ids.filter((id) => visuals.has(id));
  }
  const activities = new Map(plan.activities.map((a) => [a.id, a]));

  plan.materials = plan.materials.flatMap((m): RecreationPlan["materials"] => {
    const target = activities.get(m.activity_id)?.executor;
    if (!target) return [];
    if (m.kind === "sorting_board") return target.kind === "classify" ? [{ ...m, columns: target.categories.map((c) => c.label) }] : [];
    if (target.kind === "classify") {
      const facts = new Map(plan.facts.map((f) => [f.id, f]));
      const items = uniq(target.item_fact_ids.map((id) => facts.get(id)).flatMap((f) => (f?.kind === "membership" ? [f.item] : [])));
      return items.length >= 2 && items.length <= 12 ? [{ ...m, cards: items }] : [];
    }
    return [m];
  });
  const cards = new Map(plan.materials.map((m) => [m.id, m]));

  plan.visual_requests = plan.visual_requests.flatMap((r) => {
    const ids = r.activity_ids.filter((id) => activities.has(id));
    const objectiveIds = r.objective_ids.filter((id) => objectives.has(id) && ids.some((a) => activities.get(a)!.objective_ids.includes(id)));
    if (ids.length === 0 || objectiveIds.length === 0) return [];
    const target = r.for_cards ? cards.get(r.for_cards) : null;
    return [{
      ...r,
      activity_ids: ids,
      objective_ids: objectiveIds,
      original_ref: r.original_ref && analysis.visuals.some((v) => v.id === r.original_ref) ? r.original_ref : null,
      for_cards: target && target.kind === "cut_out_cards" && ids.includes(target.activity_id) ? r.for_cards : null,
    }];
  });
  // Instructions point only at what the sheet has: a picture (a request or a scheme), arrows (a scheme) and cards or a board (a material).
  // The sheet is one document: a scheme printed for one activity can be named by another.
  const declared = { picture: plan.visual_requests.length > 0, scheme: plan.visuals.length > 0 || plan.visual_requests.length > 0, arrows: plan.visuals.length > 0, cards: plan.materials.length > 0 };
  for (const a of plan.activities) {
    const clean = stripUnresolved(a, declared);
    if (clean.removed > 0 && !clean.empty) Object.assign(a, { prompt: clean.prompt, steps: clean.steps });
  }
  plan.guide.per_activity = plan.guide.per_activity.filter((g) => activities.has(g.activity_id));
  plan.explanation.why = plan.explanation.why.map((w) => ({ ...w, needs: w.needs.filter((n) => needSet.has(n)) })).filter((w) => w.needs.length > 0);
  return plan;
}

/** Explanation and guide lines (teacher-facing) that name an answer or a diagnosis: dropped one by one while the minimums hold. */
function scrubExplanation(plan: RecreationPlan, verification: Verification, needs: ReadonlySet<DimensionKey>): RecreationPlan {
  const bad = (text: string) => explanationIssues({ ...plan, explanation: { adapted: [text], why: [], how_to_use: [] }, guide: { per_activity: [] } }, verification.activities, needs).length > 0;
  const out = structuredClone(plan);
  const adapted = out.explanation.adapted.filter((t) => !bad(t));
  const why = out.explanation.why.filter((w) => !bad(w.text));
  const how = out.explanation.how_to_use.filter((t) => !bad(t));
  if (adapted.length >= 2) out.explanation.adapted = adapted;
  if (why.length >= 1) out.explanation.why = why;
  if (how.length >= 3) out.explanation.how_to_use = how;
  out.guide.per_activity = out.guide.per_activity.filter((g) => !bad(g.observe));
  return out;
}

const activityOf = (path: string) => /^activities\.(ra_[0-9]+)$/.exec(path)?.[1] ?? null;

/** Removes the failing activities (and what only they used) when nothing essential is lost. Null: the plan cannot be saved this way. */
export function salvagePlan(plan: RecreationPlan, verification: Verification, analysis: MaterialAnalysis, needs: readonly DimensionKey[], scope: RecreationScope["type"]): { plan: RecreationPlan; verification: Verification; removed: string[] } | null {
  const needSet = new Set(needs);
  let current = plan;
  let checked = verification;
  const removed: string[] = [];
  for (let round = 0; round < 3 && !checked.ok; round++) {
    const errors = checked.issues.filter((i) => i.severity === "error");
    if (errors.some((e) => e.path === "explanation")) {
      current = scrubExplanation(current, checked, needSet);
      checked = verifyPlan(current, analysis, { needs });
      continue;
    }
    // Facts with a bad quote are dropped only together with the activities that rely on them.
    const badFacts = new Set(errors.flatMap((e) => (/^facts\.(f_[0-9]+)$/.exec(e.path)?.[1] ? [/^facts\.(f_[0-9]+)$/.exec(e.path)![1]!] : [])));
    const usesBadFact = (a: RecreationPlan["activities"][number]) => JSON.stringify(a.executor).match(/f_[0-9]+/g)?.some((id) => badFacts.has(id)) ?? false;
    const failing = new Set([...errors.flatMap((e) => (activityOf(e.path) ? [activityOf(e.path)!] : [])), ...current.activities.filter(usesBadFact).map((a) => a.id)]);
    const fixable = errors.every((e) => activityOf(e.path) !== null || badFacts.has(/^facts\.(f_[0-9]+)$/.exec(e.path)?.[1] ?? ""));
    if (!fixable || failing.size === 0 || failing.size >= current.activities.length) return null;
    const next = structuredClone(current);
    next.activities = next.activities.filter((a) => !failing.has(a.id));
    const used = new Set(next.activities.flatMap((a) => JSON.stringify(a.executor).match(/f_[0-9]+/g) ?? []));
    next.facts = next.facts.filter((f) => used.has(f.id) && !badFacts.has(f.id));
    removed.push(...failing);
    current = sanitizePlan(next, analysis, needs, scope);
    checked = verifyPlan(current, analysis, { needs });
  }
  return checked.ok ? { plan: current, verification: checked, removed } : null;
}
