import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { ActivityComprehension } from "@/lib/schemas/activity-comprehension";
import type { AnalysisActivity, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { DirectorActivity, DirectorActivityProposal, DirectorChange, DirectorIssue, DirectorObligation } from "@/lib/schemas/pedagogical-direction";
import { RESPONSE_NEEDS, type SheetScope } from "@/lib/adaptation/pedagogical-scope";
import { PRESENTATION_DIMENSIONS } from "@/lib/adaptation/strategies";

type ActivityInput = {
  activity: AnalysisActivity;
  understood: ActivityComprehension;
  context: AdaptationContext;
  analysis: MaterialAnalysis;
  obligations: DirectorObligation[];
  scope: SheetScope;
  needs: ReadonlyMap<DimensionKey, "low" | "medium" | "high">;
};

const READING: readonly DimensionKey[] = ["decoding_support", "reading_chunk_size", "instruction_chunking", "sentence_length", "receptive_language_support"];
const PLANNING: readonly DimensionKey[] = ["planning_support", "operation_steps", "working_memory_support", "checklist_support"];
const NAVIGATION: readonly DimensionKey[] = ["visual_support", "visual_distraction_reduction", "visual_density"];
const ACCESS_CHANGES = ["segment_instruction", "blank_workspace", "visual_navigation", "change_presentation"] as const;
const FREE_WRITING_FORMATS = new Set(["write_text", "write_number", "calculate"]);
const PROTECTED_EVALUATIONS = new Set(["written_production", "response_format", "argumentation"]);

function permitsChange(change: DirectorChange, input: ActivityInput): boolean {
  const { activity, needs } = input;
  if (!needs.has(change.need)) return false;
  switch (change.kind) {
    case "segment_instruction":
      // Split only explicit sentences; never supply implicit academic steps.
      return READING.includes(change.need) && /[.!?]\s+\S/u.test(activity.instruction);
    case "blank_workspace":
      return PLANNING.includes(change.need) && FREE_WRITING_FORMATS.has(activity.response_format);
    case "visual_navigation":
    case "new_illustration":
      return NAVIGATION.includes(change.need) && (activity.resource_ids.length > 0 || /[.!?]\s+\S/u.test(activity.instruction));
    case "change_presentation":
      return (PRESENTATION_DIMENSIONS as readonly DimensionKey[]).includes(change.need);
    case "oral_response":
      return RESPONSE_NEEDS.includes(change.need);
    case "replacement":
      return (READING.includes(change.need) && permitsChange({ kind: "segment_instruction", need: change.need }, input)) ||
        (PLANNING.includes(change.need) && FREE_WRITING_FORMATS.has(activity.response_format)) || RESPONSE_NEEDS.includes(change.need);
  }
}

export function responseIsProtected(input: ActivityInput) {
  const { activity, understood, context, analysis, obligations } = input;
  const ids = new Set(obligations.filter(({ kind }) => kind === "protected").map(({ value }) => value));
  return understood.response.format_role?.kind === "assessed" ||
    context.material.writing_evaluated_activities.includes(activity.id) ||
    understood.evaluation.some(({ kind }) => PROTECTED_EVALUATIONS.has(kind)) ||
    understood.operations.some(({ kind }) => kind === "compose") ||
    understood.conditions.some(({ kind }) => kind === "response_format" || kind === "response_length") ||
    analysis.protected_elements.some((item) => ids.has(item.id) && ["response_constraint", "format_requirement"].includes(item.type));
}

function sourceUncertain(input: ActivityInput, changingMethod: boolean): boolean {
  const { activity, understood, context, analysis } = input;
  return analysis.quality.readability === "poor" ||
    understood.original_uncertainty_ids.length > 0 ||
    context.material.ambiguous_targets.some((ref) => ref === activity.id || activity.resource_ids.includes(ref)) ||
    activity.objective_ids.length === 0 ||
    activity.objective_ids.some((ref) => !understood.objectives.some(({ objective_ref }) => ref === objective_ref)) ||
    understood.operations.length === 0 || understood.evaluation.length === 0 ||
    understood.uncertainties.some(({ field }) => field !== "response_format_role" || changingMethod);
}

function oralAvailable(input: ActivityInput) {
  return input.context.pedagogy?.response?.available.includes("oral_or_alternative") === true;
}

function oralAllowed(input: ActivityInput) {
  return input.scope === "methodological" && oralAvailable(input) &&
    input.understood.response.format_role?.kind === "access" && !responseIsProtected(input) &&
    !sourceUncertain(input, true) && input.activity.response_format === "write_text";
}

function replacementMatches(input: ActivityInput) {
  const { understood, activity } = input;
  // The existing short_answer executor provides at most four lines. Preserve the space offered by the original.
  const area = activity.answer_area;
  const shortSpace = area.type === "line" || (area.type === "lines" && area.lines !== null && area.lines <= 4);
  return activity.response_format === "write_text" && shortSpace && understood.operations.length > 0 &&
    understood.operations.every(({ kind }) => ["recall", "identify", "locate_evidence", "infer", "compare"].includes(kind)) &&
    understood.student_decisions.every(({ kind }) => ["select_data", "select_evidence", "infer_conclusion"].includes(kind));
}

export function defaultProposal(input: ActivityInput): DirectorActivityProposal {
  const { activity, obligations, needs } = input;
  const base = { activity_id: activity.id, retains: obligations.map(({ ref }) => ref) };
  if (sourceUncertain(input, false)) return { ...base, decision: "keep", changes: [] };

  const changes: DirectorChange[] = [];
  const candidates = [...ACCESS_CHANGES, "oral_response"] as const;
  for (const kind of candidates) {
    if (kind === "oral_response" && (changes.length > 0 || !oralAllowed(input))) continue;
    const need = [...needs.keys()].find((dimension) => permitsChange({ kind, need: dimension }, input));
    if (need) changes.push({ kind, need });
  }
  if (changes[0]?.kind === "oral_response") {
    return { ...base, decision: "transform", changes, retains: obligations.filter(({ kind }) => kind !== "response").map(({ ref }) => ref) };
  }
  return { ...base, decision: changes.length > 0 ? "facilitate" : "keep", changes };
}

export function verifyDirection(proposal: DirectorActivityProposal, input: ActivityInput, learning: DirectorActivity["learning"]): DirectorIssue[] {
  const issues: DirectorIssue[] = [];
  const report = (code: DirectorIssue["code"], ref: string | null = null) => issues.push({ code, ref });
  const { decision, changes } = proposal;
  const changingMethod = decision === "transform" || decision === "substitute";
  if (sourceUncertain(input, changingMethod)) report("source_uncertain");
  if (decision === "keep" && changes.length === 0) {
    const responseBarrier = input.activity.response_format !== "none" && RESPONSE_NEEDS.some((dimension) => input.needs.has(dimension));
    const learningBarrier = learning.reinforcement_objectives.length > 0 ||
      learning.autonomy.some(({ autonomy }) => autonomy === "with_help" || autonomy === "not_yet");
    if (responseBarrier || learningBarrier) report("profile_support_unresolved");
  }

  const changesResponse = decision === "transform" && changes[0]?.kind === "oral_response" && oralAllowed(input);
  const required = new Set(input.obligations.filter(({ kind }) => !changesResponse || kind !== "response").map(({ ref }) => ref));
  const retained = new Set(proposal.retains);
  for (const ref of required) if (!retained.has(ref)) report("retention_missing", ref);
  for (const ref of retained) if (!required.has(ref)) report("retention_unknown", ref);
  const kindMatches = decision === "keep" ? changes.length === 0 :
    decision === "facilitate" ? changes.length > 0 && changes.every(({ kind }) => kind !== "oral_response" && kind !== "replacement") :
      changes.length === 1 && changes[0]!.kind === (decision === "transform" ? "oral_response" : "replacement");
  if (!kindMatches || new Set(changes.map(({ kind }) => kind)).size !== changes.length) report("wrong_change_for_decision");
  if (changingMethod && input.scope !== "methodological") report("scope_forbids_change");

  for (const change of changes) {
    if (!permitsChange(change, input)) report("need_not_supported", change.need);
    if (change.kind === "new_illustration" || (change.kind === "replacement" && change.executor === "unavailable")) report("fabrication_unavailable", change.kind);
    if (change.kind === "oral_response") {
      if (!oralAvailable(input)) report("fabrication_unavailable", change.kind);
      if (input.understood.response.format_role?.kind !== "access" || responseIsProtected(input) || input.activity.response_format !== "write_text") {
        report("response_protected", "oral_response");
      }
    }
    if (change.kind === "replacement" && change.executor !== "unavailable" &&
      (responseIsProtected(input) || !replacementMatches(input))) {
      report("executor_incompatible", change.executor);
    }
  }
  return issues;
}
