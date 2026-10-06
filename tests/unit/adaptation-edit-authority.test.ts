import { describe, expect, it } from "vitest";
import { normalizeTeacherEdits, reviewPlan } from "@/lib/adaptation/plan-review";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { projectPreserves, projectRestrictions } from "@/lib/adaptation/orchestration/plan-projection";
import { editsFor } from "@/lib/adaptation/presentation/review-form";
import { PlanReviewSchema, type PlanReview } from "@/lib/schemas/plan-review";
import { argumentationAnalysis } from "../../evals/adaptation/fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";
import { allPreserved, contextFor, decision, planOf } from "./adaptation-helpers";

/**
 * Who declares `uses_task_data` on a teacher's edit? Not the browser. A synthetic Bachillerato writing activity (act_5 is an
 * evaluated production) where a teacher adjusts a help and, by accident, asks for one built on the task's own material.
 */
const analysis = argumentationAnalysis();
const context = contextFor(analysis, EXECUTIVE_EXPERIMENT_PROFILE);
const WRITING = analysis.activities.filter((a) => a.type === "writing").at(-1)!.id;
const raw = planOf(analysis, context, [
  decision({ target: WRITING, action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], supports: [{ kind: "checklist", uses_task_data: false }, { kind: "key_idea", uses_task_data: true }], preserves: allPreserved(analysis, WRITING) }),
]);
const DEC = raw.decisions[0]!.id;

const teacher = (supports: unknown[]): PlanReview =>
  PlanReviewSchema.parse({ schema_version: 1, plan_fingerprint: fingerprint(raw), reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T12:00:00Z", entries: [{ decision_id: DEC, action: "edited", reason: "Ajustada por la docente", edits: { supports } }] });
const supportsOf = (review: PlanReview) => review.entries[0]!.edits!.supports!;

describe("uses_task_data is not the browser's to declare", () => {
  it("1 · the form never sends the flag, and a forged `false` for a new help is overruled by the server", () => {
    expect(JSON.stringify(editsFor({ ...decisionDto(), supports: ["checklist"] }, { supports: ["checklist", "sentence_starters"] }))).not.toContain("uses_task_data");
    const forged = normalizeTeacherEdits(raw, teacher([{ kind: "checklist", uses_task_data: false }, { kind: "sentence_starters", uses_task_data: false }]));
    expect(supportsOf(forged)).toEqual([
      { kind: "checklist", uses_task_data: false },
      { kind: "sentence_starters", uses_task_data: true },
    ]);
  });

  it("2 · a flag that cannot be proven is read conservatively (true), also when the payload omits it", () => {
    const omitted = PlanReviewSchema.parse({ ...teacher([]), entries: [{ decision_id: DEC, action: "edited", reason: "x", edits: { supports: [{ kind: "sentence_starters" }] } }] });
    expect(supportsOf(omitted)[0]!.uses_task_data).toBe(true);
    expect(supportsOf(normalizeTeacherEdits(raw, omitted))[0]!.uses_task_data).toBe(true);
  });

  it("editing around a flagged help does not launder it: the proposal's own `true` is kept", () => {
    const edited = normalizeTeacherEdits(raw, teacher([{ kind: "key_idea", uses_task_data: false }]));
    expect(supportsOf(edited)).toEqual([{ kind: "key_idea", uses_task_data: true }]);
  });

  it("4 · adversarial: a help built on the task's material cannot pass silently as `false`; an honest, normal edit still works", () => {
    const attempt = teacher([{ kind: "checklist", uses_task_data: false }, { kind: "sentence_starters", uses_task_data: false }]);
    // Before the fix the forged flag reached the validator as false and the edit was applied without a block.
    const trusted = reviewPlan(raw, attempt, analysis, context);
    expect(trusted.decisions[0]!.outcome).toBe("applied");
    // Now the server derives the flag first: the same payload is refused by the existing validator (P6 untouched).
    const normalized = reviewPlan(raw, normalizeTeacherEdits(raw, attempt), analysis, context);
    expect(normalized.decisions[0]).toMatchObject({ outcome: "edit_still_blocked", effective: null });

    const normal = reviewPlan(raw, normalizeTeacherEdits(raw, teacher([{ kind: "checklist", uses_task_data: false }])), analysis, context);
    expect(normal.decisions[0]).toMatchObject({ outcome: "applied", origin: "teacher_edit" });
  });

  it("3 · persisted reviews keep their saved values: replaying one does not renormalise it", () => {
    const stored = teacher([{ kind: "checklist", uses_task_data: false }, { kind: "sentence_starters", uses_task_data: false }]);
    const replay = reviewPlan(raw, stored, analysis, context);
    expect(replay.decisions[0]!.effective!.supports).toEqual([
      { kind: "checklist", uses_task_data: false },
      { kind: "sentence_starters", uses_task_data: false },
    ]);
    // Only a submission is normalised, and only a teacher's: an eval's explicit values are its own.
    const evalReview: PlanReview = { ...stored, reviewer: { kind: "eval" } };
    expect(normalizeTeacherEdits(raw, evalReview)).toBe(evalReview);
    // Historical plans (the raw decisions) are never touched.
    expect(raw.decisions[0]!.supports).toEqual([{ kind: "checklist", uses_task_data: false }, { kind: "key_idea", uses_task_data: true }]);
  });
});

describe("projection of preservations and restrictions", () => {
  const INFERRED = "RESPUESTA_INFERIDA_SECRETA";
  const withInferred = { ...analysis, activities: analysis.activities.map((a) => (a.id === WRITING ? { ...a, expected_answer: { basis: "inferred" as const, value: INFERRED } } : a)) };

  it("7 · carries the requirement's type and wording, and nothing from the activity's inferred answer", () => {
    const ids = allPreserved(withInferred, WRITING);
    const projection = projectPreserves(withInferred, ids);
    expect(projection.length).toBeGreaterThan(0);
    expect(projection.some((p) => /150-180 palabras/.test(p.value))).toBe(true);
    expect(JSON.stringify(projection)).not.toContain(INFERRED);
    expect(Object.keys(projection[0]!).sort()).toEqual(["type", "value"]);
  });

  it("unknown ids and a missing analysis project nothing; restrictions are clipped, trimmed and typed", () => {
    expect(projectPreserves(withInferred, ["prt_999"])).toEqual([]);
    expect(projectPreserves(null, ["prt_1"])).toEqual([]);
    expect(projectRestrictions(undefined)).toEqual([]);
    expect(projectRestrictions(["  No sugerir la tesis  ", "", 4, "x".repeat(500)]).map((r) => r.length)).toEqual([19, 200]);
  });
});

function decisionDto() {
  return { id: DEC, target: WRITING, action: "add_support", intensity: "moderate", strategies: [] as string[], needs: [] as string[], supports: [] as string[], note: null, preserves: [], restrictions: [], status: "valid" as const, issues: [] };
}
