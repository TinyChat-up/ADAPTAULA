import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { RecreationScope } from "./contract";
import { originalOperations } from "./verify";

/**
 * What the recreation planner may see, and nothing else (docs/PRIVACY.md). From the student: only the functional needs of the
 * context (dimension + level), never a name, alias, tag, observation or declared text of the V3 profile. From the sheet: its
 * analysis, which travels as untrusted data. The expected answers the analysis may have inferred are left out: the planner must not
 * build activities on answers nobody verified.
 */
export interface RecreationInput {
  context: {
    scope: RecreationScope["type"];
    education: { stage: string; grade: string | null; subject: string | null; language: string };
    needs: Array<{ dimension: string; level: string }>;
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

export function recreationInput(analysis: MaterialAnalysis, context: AdaptationContext, scope: RecreationScope["type"]): RecreationInput {
  return {
    context: {
      scope,
      education: { stage: context.education.stage, grade: context.education.grade, subject: context.education.subject, language: context.education.language },
      needs: context.needs.map((n) => ({ dimension: n.dimension, level: n.level })),
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
