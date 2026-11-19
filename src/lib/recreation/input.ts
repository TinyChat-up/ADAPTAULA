import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { RecreationScope } from "./contract";
import { originalOperations } from "./verify";

/**
 * What the recreation planner may see, and nothing else (docs/PRIVACY.md). From the student: only what the server already turned into
 * structured, non-identifying data — the functional needs (dimension + level), the numeric limits, and for a methodological sheet the
 * response formats the profile allows (best first) and the original activities the teacher marked as a learning focus (ids only).
 * Never a name, alias, tag, observation or declared text of the V3 profile. From the sheet: its
 * analysis, which travels as untrusted data. The expected answers the analysis may have inferred are left out: the planner must not
 * build activities on answers nobody verified.
 */
import { RECREATION_APPROACHES, type RecreationApproach } from "@/lib/adaptation/recreation/engine";
export { RECREATION_APPROACHES, type RecreationApproach };

export interface RecreationInput {
  context: {
    scope: RecreationScope["type"];
    approach: RecreationApproach;
    education: { stage: string; grade: string | null; subject: string | null; language: string };
    needs: Array<{ dimension: string; level: string }>;
    limits: { max_instruction_words: number | null; max_visible_tasks: number | null; max_task_minutes: number | null };
    response_formats: string[] | null;
    focus_activity_ids: string[];
    required_operations: Record<string, string[]>;
  };
  material: {
    title: string | null;
    objectives: Array<{ id: string; text: string }>;
    texts: Array<{ id: string; kind: string; text: string }>;
    visuals: Array<{ id: string; kind: string; title: string | null; text: string | null; table: { headers: string[]; rows: string[][] } | null }>;
    activities: Array<{ id: string; label: string | null; type: string; instruction: string; context: string | null; objective_ids: string[] }>;
  };
}

export function recreationInput(analysis: MaterialAnalysis, context: AdaptationContext, scope: RecreationScope["type"], approach: RecreationApproach = "auto"): RecreationInput {
  return {
    context: {
      scope,
      approach,
      education: { stage: context.education.stage, grade: context.education.grade, subject: context.education.subject, language: context.education.language },
      needs: context.needs.map((n) => ({ dimension: n.dimension, level: n.level })),
      limits: { ...context.limits },
      response_formats: context.pedagogy?.response?.available ? [...context.pedagogy.response.available] : null,
      focus_activity_ids: [...(context.pedagogy?.focus_targets ?? [])],
      required_operations: originalOperations(analysis),
    },
    material: {
      title: analysis.identification.title,
      objectives: analysis.pedagogical_intent.objectives.map((o) => ({ id: o.id, text: o.text })),
      texts: analysis.texts.map((t) => ({ id: t.id, kind: t.kind, text: t.text })),
      visuals: analysis.visuals.filter((v) => v.kind !== "decorative").map((v) => ({ id: v.id, kind: v.kind, title: v.title, text: v.text, table: v.table ? { headers: v.table.headers, rows: v.table.rows } : null })),
      activities: analysis.activities.map((a) => ({ id: a.id, label: a.label, type: a.type, instruction: a.instruction, context: a.context, objective_ids: a.objective_ids })),
    },
  };
}
