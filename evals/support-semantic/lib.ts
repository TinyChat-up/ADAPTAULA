import type { AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { SHEETS, type CorpusEntry, type CorpusSheet } from "./corpus";

/**
 * A corpus entry as the structures the semantic review reads: the analysis of its sheet (one activity, its evaluated concept, its
 * objective, its table and reading), the plan decision that motivated the support and the document that carries it. Minimal on purpose:
 * only what `assessSupports`, the semantic scope and the policy read. No learner data.
 */
export function sheetOf(entry: CorpusEntry): { analysis: MaterialAnalysis; plan: Pick<AdaptationPlan, "decisions">; document: MaterialDocument; blockId: string; protectedId: string } {
  const c: CorpusSheet = SHEETS[entry.sheet];
  const analysis = {
    activities: [{ id: "act_1", type: c.type, instruction: c.instruction, context: c.context ?? null, response_format: "write_text", objective_ids: ["obj_1"], resource_ids: [...(c.table ? ["vis_1"] : []), ...(c.reading ? ["ctt_1"] : [])], expected_answer: c.answer ? { basis: "inferred", value: c.answer } : { basis: "not_inferable", value: null } }],
    protected_elements: c.evaluates.map((value, i) => ({ id: `prt_${i + 1}`, type: "concept", importance: "essential", value, activity_ids: ["act_1"], resource_ids: [] })),
    pedagogical_intent: { objectives: [{ id: "obj_1", text: c.objective }] },
    visuals: c.table ? [{ id: "vis_1", kind: "table", table: { ...c.table, unit: null }, chart: null }] : [],
    texts: c.reading ? [{ id: "ctt_1", kind: "reading_text", text: c.reading }] : [],
  };
  const blockId = "blk_supp0001";
  const document = { pages: [{ blocks: [{ id: blockId, ...entry.block, trace: { origin: "support", source_refs: ["act_1"], decision_ids: ["dec_1"] } }] }] };
  const plan = { decisions: [{ id: "dec_1", target: "act_1", action: "add_support", dimensions: [entry.need.dimension], supports: [{ kind: entry.kind, uses_task_data: false }] }] };
  return { analysis: analysis as unknown as MaterialAnalysis, plan: plan as unknown as Pick<AdaptationPlan, "decisions">, document: document as unknown as MaterialDocument, blockId, protectedId: "prt_1" };
}
