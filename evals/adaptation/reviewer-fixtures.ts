import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { normalizeGeneratedV2 } from "@/lib/adaptation/generated-v2";
import { reviewPlan } from "@/lib/adaptation/plan-review";
import { planOf, decision, allPreserved } from "../../tests/unit/adaptation-helpers";
import { deterministicChecks } from "@/lib/adaptation/review";
import { buildPedagogicalReviewContext, reviewScope } from "@/lib/adaptation/review-context";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { DraftGeneratedSegmentsV2Schema } from "@/lib/schemas/generated-segments-v2";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { fractionsAnalysis } from "./fixtures";
import { buildExperimentContext } from "./planner-lib";

/**
 * The Primaria chain as it really happened, in miniature (synthetic sheet, same structure): a global checklist, a reminder in
 * activity 5, a spatial decision deferred to the renderer and one rejected decision. Used by the reviewer tests and the offline
 * reviewer eval so both exercise the same document. The real worksheet stays private.
 */
export const primariaAnalysis = (): MaterialAnalysis => fractionsAnalysis();

export const primariaDecisions = (analysis: MaterialAnalysis) => ({
  checklist: decision({ target: "document", action: "add_support", strategies: ["planning_support"], dimensions: ["checklist_support"], supports: [{ kind: "checklist", uses_task_data: false }] }),
  reminder: decision({ target: "act_5", action: "add_support", strategies: ["planning_support"], dimensions: ["explicit_expectations"], intensity: "light", preserves: allPreserved(analysis, "act_5"), supports: [{ kind: "self_check", uses_task_data: true }] }),
  spatial: decision({ target: "act_2", action: "segment", strategies: ["task_sequencing"], dimensions: ["instruction_chunking", "predictable_structure"], intensity: "light", preserves: allPreserved(analysis, "act_2") }),
  steps: decision({ target: "act_3", action: "segment", strategies: ["task_sequencing"], dimensions: ["instruction_chunking"], preserves: allPreserved(analysis, "act_3"), supports: [{ kind: "step_list", uses_task_data: false }] }),
});

export const PRIMARIA_DRAFT = DraftGeneratedSegmentsV2Schema.parse({
  segments: [
    { decision_id: "dec_1", target: "document", supports: [{ kind: "checklist", title: "Mi forma de trabajar", items: ["Empecé sabiendo qué me pedían.", "Hice todo lo que pude.", "Revisé mi trabajo al terminar."] }] },
    { decision_id: "dec_2", target: "act_5", supports: [{ kind: "checklist", items: ["He escrito una sola frase con mis palabras.", "Mi frase responde a lo que se pregunta."] }] },
  ],
  skipped: [],
  blocked: [],
  change_summary: ["x"],
});

export function primariaScenario(analysis: MaterialAnalysis = primariaAnalysis(), context: AdaptationContext = buildExperimentContext(analysis, "accessibility", 2)) {
  const d = primariaDecisions(analysis);
  const raw = planOf(analysis, context, [d.checklist, d.reminder, d.spatial, d.steps]);
  const entries = [["dec_1", "approved"], ["dec_2", "approved"], ["dec_3", "approved"], ["dec_4", "rejected"]] as const;
  const reviewed = reviewPlan(raw, { schema_version: 1, plan_fingerprint: fingerprint(raw), reviewer: { kind: "eval", label: "fixture" }, reviewed_at: "fixture", entries: entries.map(([id, action]) => ({ decision_id: id, action, reason: "fixture" })) }, analysis, context);
  const generation = normalizeGeneratedV2(PRIMARIA_DRAFT, reviewed, analysis, context);
  const document = buildDocument({ analysis, plan: reviewed.effective, context, generated: generation.segments, newBlockId: sequentialIds() });
  const input = { analysis, plan: reviewed.effective, context, document, validation: reviewed.effectiveValidation };
  const base = deterministicChecks(input);
  const ids = reviewed.raw.decisions.map((x) => x.id);
  return { analysis, context, reviewed, document, input, base, ids, scope: reviewScope(base, input, ids), review: buildPedagogicalReviewContext(input, reviewed) };
}
