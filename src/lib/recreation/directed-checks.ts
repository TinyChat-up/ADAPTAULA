import type { DirectorActivity } from "@/lib/schemas/pedagogical-direction";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { Block } from "@/lib/schemas/material-document";
import { containsActivityQuote } from "@/lib/analysis/activity-comprehension";
import { chartPlottable } from "@/lib/render/model";
import type { DirectedPlan } from "./directed-plan";
import { COGNITIVE_OPERATIONS, type RecreationPlan } from "./contract";

export type DirectedIssue = { code: string; original_id?: string; ref?: string };

const sameSet = (proposed: readonly string[], expected: readonly string[]) =>
  new Set(proposed).size === proposed.length && proposed.length === expected.length && expected.every((value) => proposed.includes(value));

export function verifyDirectedLinks(plan: DirectedPlan, expectedFingerprint: string, candidates: readonly DirectorActivity[]): DirectedIssue[] {
  if (plan.request_fingerprint !== expectedFingerprint) return [{ code: "stale_plan" }];
  const expected = new Map(candidates.map((activity) => [activity.activity_id, activity]));
  const resultIds = new Set<string>();
  const issues: DirectedIssue[] = [];
  const replacements: string[] = [];
  for (const link of plan.links) {
    const original_id = link.original_id;
    const row = expected.get(original_id);
    if (!row || resultIds.has(link.result_id)) {
      issues.push({ code: "unexpected_activity_link", original_id });
      continue;
    }
    expected.delete(original_id);
    resultIds.add(link.result_id);
    const changes = row.changes.map((change) => change.kind);
    if (!sameSet(link.changes, changes)) issues.push({ code: "change_not_authorized", original_id });
    if (!sameSet(link.retains, row.retains)) {
      for (const ref of row.retains.filter((needed) => !link.retains.includes(needed))) issues.push({ code: "obligation_missing", original_id, ref });
      if (row.retains.every((ref) => link.retains.includes(ref))) issues.push({ code: "obligation_reference_invalid", original_id });
    }
    if (changes.includes("replacement")) {
      replacements.push(link.result_id);
      if (!link.result_id.startsWith("ra_")) issues.push({ code: "unexpected_activity_link", original_id });
    } else if (link.result_id !== original_id) issues.push({ code: "unexpected_activity_link", original_id });
  }
  for (const original_id of expected.keys()) issues.push({ code: "activity_link_missing", original_id });
  if ((replacements.length === 0) !== (plan.replacement === null) ||
    !sameSet(plan.replacement?.activities.map(({ id }) => id) ?? [], replacements)) {
    issues.push({ code: "replacement_links_invalid" });
  }
  return issues;
}

export function checkReplacement(plan: RecreationPlan, links: DirectedPlan["links"], analysis: MaterialAnalysis, candidates: readonly DirectorActivity[]): DirectedIssue[] {
  const issues: DirectedIssue[] = [];
  if (plan.scope.type !== "methodological") issues.push({ code: "replacement_scope_invalid" });
  if (plan.reading || [plan.visual_requests, plan.visuals, plan.diagrams, plan.materials, plan.custom_resources].some((items) => items?.length)) {
    issues.push({ code: "replacement_extra_content" });
  }
  for (const activity of plan.activities) {
    const original_id = links.find((link) => link.result_id === activity.id)!.original_id;
    const row = candidates.find((item) => item.activity_id === original_id)!;
    const original = analysis.activities.find((item) => item.id === original_id)!;
    const changed = row.changes.find((change) => change.kind === "replacement");
    const strategies = plan.strategies.filter(({ id }) => activity.strategy_ids.includes(id));
    if (!changed || strategies.length === 0 || strategies.some(({ needs }) => needs.some((need) => need !== changed.need))) {
      issues.push({ code: "profile_need_mismatch", original_id });
    }
    if (activity.executor.kind !== "short_answer" || activity.steps.length > 0 || activity.visual_ids.length > 0 ||
        activity.executor.starters.length > 0 || activity.executor.lines < (original.answer_area.lines ?? 1)) {
      issues.push({ code: "replacement_format_invalid", original_id });
    }
    if (!sameSet(activity.objective_ids, original.objective_ids)) issues.push({ code: "objectives_changed", original_id });
    const declaredOperations = row.obligations.filter(({ kind }) => kind === "operation").map(({ value }) => value);
    if (activity.operations.some((operation) => !declaredOperations.includes(operation))) issues.push({ code: "operation_not_authorized", original_id });
    for (const obligation of row.obligations) {
      const { kind, ref, value, evidence } = obligation;
      if (kind === "operation" && !COGNITIVE_OPERATIONS.some((operation) => operation === value)) {
        issues.push({ code: "operation_executor_unavailable", original_id, ref });
      } else if (kind === "operation" && !activity.operations.some((operation) => operation === value)) {
        issues.push({ code: "operation_missing", original_id, ref });
      } else if (kind === "student_decision") {
        // recreation_plan@v1 cannot represent which decision still belongs to the learner.
        issues.push({ code: "student_decision_executor_unavailable", original_id, ref });
      } else if (kind === "evaluation") {
        const criteria = activity.executor.kind === "short_answer" ? activity.executor.criteria : [];
        if (!evidence?.quote || !criteria.some((criterion) => containsActivityQuote(criterion, evidence.quote!))) {
          issues.push({ code: "evaluation_criterion_missing", original_id, ref });
        }
      } else if (kind === "condition" || kind === "information" || kind === "protected") {
        if (evidence && original.resource_ids.includes(evidence.source_ref)) continue;
        const expected = kind === "protected" ? analysis.protected_elements.find(({ id }) => id === value)?.value : evidence?.quote;
        if (!expected || !containsActivityQuote(activity.prompt, expected)) {
          issues.push({ code: "condition_or_data_missing", original_id, ref });
        }
      }
    }
  }
  return issues;
}

export function checkResource(original_id: string, block: Block | undefined, ref: string, images: ReadonlySet<string>): DirectedIssue | null {
  if (!block) return { code: "resource_missing", original_id, ref };
  if (block.type === "image" && (block.source.kind !== "original" || !images.has(ref))) {
    return { code: "original_asset_unavailable", original_id, ref };
  }
  if (block.type === "chart" && (block.chart_type === "other" || !chartPlottable({ chartType: block.chart_type, series: block.series }))) return { code: "chart_plot_unavailable", original_id, ref };
  return null;
}
