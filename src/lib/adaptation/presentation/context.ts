import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";

/**
 * What the review screen knows about the material, derived from the stored analysis on the server and handed to the client as
 * plain data. Only original-material content: titles, activity wording, objectives and protected requirements. Never an inferred
 * expected answer, a learner's name or an internal id shown as text.
 */
export interface AdaptationContextView {
  materialId: string;
  materialTitle: string;
  stage: string | null;
  grade: string | null;
  subject: string | null;
  activityCount: number;
  /** target id → "Actividad 3". */
  targets: Record<string, string>;
  /** target id → a short quote of the activity's instruction, to recognise it. */
  hints: Record<string, string>;
  /** target id → what the adaptation must keep ("Objetivo: …", "Debe mantenerse: …"). */
  preserved: Record<string, string[]>;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const MAX_PRESERVED = 4;

export function buildContextView(input: {
  materialId: string;
  title: string;
  stage: string | null;
  grade: string | null;
  subject: string | null;
  analysis: MaterialAnalysis | null;
}): AdaptationContextView {
  const { analysis } = input;
  const view: AdaptationContextView = {
    materialId: input.materialId,
    materialTitle: input.title,
    stage: input.stage,
    grade: input.grade,
    subject: input.subject,
    activityCount: analysis?.activities.length ?? 0,
    targets: {},
    hints: {},
    preserved: {},
  };
  if (!analysis) return view;

  const objectives = new Map(analysis.pedagogical_intent.objectives.map((o) => [o.id, o.text]));
  analysis.activities.forEach((activity, index) => {
    view.targets[activity.id] = `Actividad ${activity.label ?? index + 1}`;
    view.hints[activity.id] = clip(activity.instruction, 110);
    const kept = [
      ...activity.objective_ids.flatMap((id) => (objectives.has(id) ? [`Objetivo: ${clip(objectives.get(id)!, 140)}`] : [])),
      ...analysis.protected_elements
        .filter((p) => p.importance !== "optional" && p.activity_ids.includes(activity.id))
        .map((p) => `Debe mantenerse: ${clip(p.value, 140)}`),
    ];
    if (kept.length > 0) view.preserved[activity.id] = kept.slice(0, MAX_PRESERVED);
  });
  const documentLevel = [
    ...analysis.pedagogical_intent.objectives.map((o) => `Objetivo: ${clip(o.text, 140)}`),
    ...analysis.protected_elements.filter((p) => p.importance === "essential" && p.activity_ids.length === 0).map((p) => `Debe mantenerse: ${clip(p.value, 140)}`),
  ];
  if (documentLevel.length > 0) view.preserved["document"] = documentLevel.slice(0, MAX_PRESERVED);
  return view;
}
