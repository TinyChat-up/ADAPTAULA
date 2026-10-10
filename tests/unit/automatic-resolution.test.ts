import { describe, expect, it } from "vitest";
import { resolveAutomatically } from "@/lib/adaptation/automatic-resolution";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { classifyDecisionExecution, planExecutability } from "@/lib/adaptation/execution";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { autoReview, reviewPlan } from "@/lib/adaptation/plan-review";
import { allBlocks } from "@/lib/schemas/material-document";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { buildExperimentContext } from "../../evals/adaptation/planner-lib";
import { allPreserved, decision, planOf } from "./adaptation-helpers";

/**
 * «Hacer magia» decides the plan knowing what the executors can do: the capability-aware resolution, without any model call.
 * The profile (EXECUTIVE_EXPERIMENT_PROFILE) has high needs (instruction chunking, working memory, planning) and lower ones.
 */

const frac: MaterialAnalysis = fractionsAnalysis();
const ctx: AdaptationContext = buildExperimentContext(frac, "accessibility", 2);
const level = (dim: string) => ctx.needs.find((n) => n.dimension === dim)?.level;
const resolve = (decisions: ReturnType<typeof decision>[]) => {
  const raw = planOf(frac, ctx, decisions);
  return { raw, ...resolveAutomatically(raw, frac, ctx) };
};
const outcome = (r: ReturnType<typeof resolve>, id: string) => r.outcomes.find((o) => o.decision_id === id)!;

const checklist = decision({ target: "document", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], supports: [{ kind: "checklist", uses_task_data: false }] });

describe("capability-aware planning: what cannot be executed is resolved, never left for a person to approve", () => {
  it("the profile has the needs these cases rely on", () => {
    expect([level("instruction_chunking"), level("working_memory_support"), level("planning_support")]).toEqual(["high", "high", "high"]);
    expect(level("explicit_expectations")).toBe("low");
  });

  it("an executable plan is applied as the planner wrote it", () => {
    const r = resolve([checklist]);
    expect(outcome(r, "dec_1")).toMatchObject({ kind: "applied" });
    expect(r.review.entries).toEqual([{ decision_id: "dec_1", action: "approved", reason: "Sin avisos" }]);
    expect(r.unresolved).toEqual([]);
  });

  it("an unsupported decision with an equivalent capability gets it: rewording a short instruction to clarify it → a list of steps", () => {
    const clarify = decision({ target: "act_1", action: "rephrase", strategies: ["instruction_clarification"], dimensions: ["instruction_chunking"], intensity: "light", preserves: allPreserved(frac, "act_1") });
    expect(classifyDecisionExecution({ id: "dec_1", ...clarify }, frac, ctx).route).toBe("unsupported");
    const r = resolve([clarify]);
    expect(outcome(r, "dec_1").kind).toBe("alternative");
    const entry = r.review.entries[0]!;
    expect(entry).toMatchObject({ action: "edited", edits: { action: "add_support", supports: [{ kind: "step_list", uses_task_data: false }] } });
    // Same target, same needs: the edit cannot change what ties the decision to the profile.
    const reviewed = reviewPlan(r.raw, r.review, frac, ctx);
    expect(reviewed.effective.decisions[0]).toMatchObject({ target: "act_1", dimensions: ["instruction_chunking"] });
    expect(planExecutability(reviewed, frac, ctx)).toMatchObject({ blockers: [], ai: ["dec_1"] });
  });

  it("a closed answer format for less writing (blocked here: recognising is not doing the operation) → a short open answer, set by the assembler", () => {
    const closed = decision({ target: "act_3", action: "change_response_format", strategies: ["writing_load_reduction"], dimensions: ["working_memory_support"], response_target: "select_option", preserves: allPreserved(frac, "act_3") });
    const r = resolve([closed]);
    expect(outcome(r, "dec_1").kind).toBe("alternative");
    expect(r.review.entries[0]).toMatchObject({ action: "edited", edits: { response_target: "write_text_short" } });
    const reviewed = reviewPlan(r.raw, r.review, frac, ctx);
    const execution = planExecutability(reviewed, frac, ctx);
    expect(execution).toMatchObject({ blockers: [], ai: [] });
    expect(execution.byRoute.deterministic).toEqual(["dec_1"]);
    const doc = buildDocument({ analysis: frac, plan: reviewed.effective, context: ctx, generated: null, newBlockId: sequentialIds() });
    const activity = allBlocks(doc).find((b) => b.type === "activity" && b.trace.source_refs.includes("act_3"));
    expect(activity).toMatchObject({ trace: { origin: "adapted", decision_ids: ["dec_1"] } });
    expect(activity?.type === "activity" ? activity.prompt : "").toContain(frac.activities.find((a) => a.id === "act_3")!.instruction);
  });

  it("no superficial equivalence: choosing between options is not «less writing» (no alternative); for a high need it is NOT dropped", () => {
    const choose = decision({ target: "act_4", action: "change_response_format", strategies: ["response_choice"], dimensions: ["working_memory_support"], response_target: "select_option", preserves: allPreserved(frac, "act_4") });
    const r = resolve([choose]);
    expect(outcome(r, "dec_1")).toMatchObject({ kind: "unresolved", uncovered: ["working_memory_support"] });
    expect(r.unresolved).toHaveLength(1);
    // Kept approved, so the preflight stops (it is never silently left out).
    expect(r.review.entries[0]).toMatchObject({ action: "approved" });
    expect(planExecutability(reviewPlan(r.raw, r.review, frac, ctx), frac, ctx).blockers.length).toBe(1);
  });

  it("an unsupported decision whose need another executable decision covers is left out, with its reason", () => {
    const choose = decision({ target: "act_4", action: "change_response_format", strategies: ["response_choice"], dimensions: ["planning_support"], response_target: "select_option", preserves: allPreserved(frac, "act_4") });
    const r = resolve([checklist, choose]);
    expect(outcome(r, "dec_2")).toMatchObject({ kind: "left_out_covered", uncovered: [] });
    expect(r.review.entries[1]).toMatchObject({ action: "rejected" });
    expect(r.unresolved).toEqual([]);
  });

  it("a low need with no executor and no alternative is left out (recorded), never stopping the sheet", () => {
    const choose = decision({ target: "act_4", action: "change_response_format", strategies: ["response_choice"], dimensions: ["explicit_expectations"], response_target: "select_option", preserves: allPreserved(frac, "act_4") });
    expect(outcome(resolve([choose]), "dec_1")).toMatchObject({ kind: "left_out_minor", uncovered: ["explicit_expectations"] });
  });

  it("asking a short instruction to be shorter or simpler: the original already does it", () => {
    const simplify = decision({ target: "act_1", action: "rephrase", strategies: ["language_simplification"], dimensions: ["instruction_chunking"], intensity: "light", preserves: allPreserved(frac, "act_1") });
    expect(outcome(resolve([simplify]), "dec_1")).toMatchObject({ kind: "left_out_satisfied" });
  });

  it("a blocked decision is never approved; for a high need nothing else covers, the sheet is not finished automatically", () => {
    const unsafe = decision({ target: "act_5", action: "add_support", strategies: ["worked_example"], dimensions: ["working_memory_support"], supports: [{ kind: "worked_example", uses_task_data: true }], preserves: allPreserved(frac, "act_5") });
    const r = resolve([unsafe]);
    expect(r.review.entries[0]).toMatchObject({ action: "rejected" });
    expect(outcome(r, "dec_1")).toMatchObject({ kind: "unresolved" });
    // Covered by something executable: left out as blocked, the sheet goes on.
    const covered = resolve([decision({ ...unsafe, dimensions: ["planning_support"] }), checklist]);
    expect(outcome(covered, "dec_1")).toMatchObject({ kind: "left_out_blocked" });
    expect(covered.unresolved).toEqual([]);
  });

  it("deterministic and the same policy as `autoReview` (offline pipeline): same plan, same review, same fingerprint", () => {
    const decisions = [checklist, decision({ target: "act_1", action: "rephrase", strategies: ["instruction_clarification"], dimensions: ["instruction_chunking"], intensity: "light", preserves: allPreserved(frac, "act_1") })];
    const a = resolve(decisions);
    const b = resolve(decisions);
    expect(fingerprint(a.review)).toBe(fingerprint(b.review));
    expect(autoReview(a.raw, frac, ctx)).toEqual(a.review);
    expect(a.review.reviewer).toEqual({ kind: "auto" });
  });
});
