import type { ActivityComprehension } from "@/lib/schemas/activity-comprehension";
import type { AnalysisActivity, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { DirectorActivity, DirectorObligation } from "@/lib/schemas/pedagogical-direction";
import type { SubjectProfile } from "@/lib/profiles/subject-profile";

export function sourceObligations(analysis: MaterialAnalysis, activity: AnalysisActivity, understood: ActivityComprehension): DirectorObligation[] {
  const result: DirectorObligation[] = [];
  const add = (kind: DirectorObligation["kind"], value: DirectorObligation["value"], evidence: DirectorObligation["evidence"] = null) => {
    result.push({ ref: `${kind}_${result.length + 1}`, kind, value, evidence });
  };

  for (const id of activity.objective_ids) {
    add("objective", id, understood.objectives.find((item) => item.objective_ref === id)?.evidence);
  }
  const decorative = new Set(analysis.visuals.filter((visual) => visual.role === "decorative").map(({ id }) => id));
  for (const id of activity.resource_ids.filter((ref) => !decorative.has(ref))) {
    add("resource", id, understood.essential_resources.find((item) => item.resource_ref === id)?.evidence);
  }
  for (const item of analysis.protected_elements) {
    if (item.importance === "optional") continue;
    if (item.activity_ids.includes(activity.id) || item.resource_ids.some((id) => activity.resource_ids.includes(id)) ||
        (item.activity_ids.length === 0 && item.resource_ids.length === 0)) {
      add("protected", item.id);
    }
  }
  for (const item of understood.operations) add("operation", item.kind, item.evidence);
  for (const item of understood.student_decisions) add("student_decision", item.kind, item.evidence);
  for (const item of understood.information) add("information", null, item);
  for (const item of understood.evaluation) add("evaluation", item.kind, item.evidence);
  for (const item of understood.conditions) add("condition", item.kind, item.evidence);
  add("response", activity.response_format, understood.response.format_role?.evidence);
  return result;
}

const literal = (value: string) => value.trim().toLocaleLowerCase("es").replace(/\s+/gu, " ");

export function learningEvidence(profile: SubjectProfile, analysis: MaterialAnalysis, understood: ActivityComprehension): DirectorActivity["learning"] {
  if (!profile.learning) return { autonomy: [], reinforcement_objectives: [] };
  const objectives = new Map(analysis.pedagogical_intent.objectives.map(({ id, text }) => [id, text]));
  const { abilities, needs } = profile.learning;
  const reinforcement = new Set(needs.map(literal));
  const autonomy: DirectorActivity["learning"]["autonomy"] = [];
  const reinforce: string[] = [];
  for (const id of new Set(understood.objectives.map(({ objective_ref }) => objective_ref))) {
    const text = literal(objectives.get(id)!);
    for (const [index, ability] of abilities.entries()) {
      if (literal(ability.statement) === text) autonomy.push({ objective_id: id, observation_index: index, autonomy: ability.autonomy });
    }
    if (reinforcement.has(text)) reinforce.push(id);
  }
  return { autonomy, reinforcement_objectives: reinforce };
}
