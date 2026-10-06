import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { statedAnswer } from "@/lib/analysis/answers";
import { instructionWords } from "./proportion";

/**
 * What the planner and the generator see of an analysis. Built here, in one place, so two rules cannot be forgotten:
 * - inferred answers never leave the server towards a generating model (they could become an example, a hint or a
 *   "model answer"); only the reviewer, which checks solvability, gets them;
 * - chart series names are potentially inferred metadata: they are blanked, so they cannot be presented as the material's.
 * The learner never appears here: this is the material only.
 */
export function modelFacingAnalysis(analysis: MaterialAnalysis) {
  return {
    identification: {
      title: analysis.identification.title,
      language: analysis.identification.language,
      stage: analysis.identification.stage.value,
      grade: analysis.identification.grade.value,
      subject: analysis.identification.subject.value,
      topic: analysis.identification.topic.value,
    },
    objectives: analysis.pedagogical_intent.objectives,
    texts: analysis.texts.map((t) => ({ id: t.id, kind: t.kind, page: t.page, text: t.text })),
    visuals: analysis.visuals.map((v) => ({
      id: v.id,
      kind: v.kind,
      role: v.role,
      title: v.title,
      description: v.description,
      table: v.table,
      chart: v.chart ? { ...v.chart, series: v.chart.series.map((s) => ({ name: "", values: s.values })) } : null,
    })),
    activities: analysis.activities.map((a) => ({
      id: a.id,
      label: a.label,
      type: a.type,
      instruction: a.instruction,
      context: a.context,
      resource_ids: a.resource_ids,
      objective_ids: a.objective_ids,
      response_format: a.response_format,
      answer_area: a.answer_area,
      stated_answer: statedAnswer(a),
    })),
    protected_elements: analysis.protected_elements.map((p) => ({ id: p.id, type: p.type, importance: p.importance, value: p.value, activity_ids: p.activity_ids, resource_ids: p.resource_ids })),
    uncertainties: analysis.uncertainties.map((u) => ({ kind: u.kind, target_ids: u.target_ids })),
  };
}
export type ModelFacingAnalysis = ReturnType<typeof modelFacingAnalysis>;

/**
 * v2 view for the planner: the same material plus a neutral fact per activity, the words of its instruction. It informs how
 * long an instruction is; it decides nothing (the prompt says so). v1's view (above) is unchanged: v1 evidence depends on it.
 */
export function modelFacingAnalysisV2(analysis: MaterialAnalysis) {
  const base = modelFacingAnalysis(analysis);
  return { ...base, activities: base.activities.map((a) => ({ ...a, instruction_words: instructionWords(analysis.activities.find((x) => x.id === a.id)!) })) };
}
export type ModelFacingAnalysisV2 = ReturnType<typeof modelFacingAnalysisV2>;
