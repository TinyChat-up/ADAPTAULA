import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MATERIAL_GENERATOR_V2 } from "@prompts/material-generator/v2";
import { ADAPTATION_PLANNER_V2 } from "@prompts/adaptation-planner/v2";
import { stableStringify, fingerprint } from "@/lib/adaptation/fingerprint";
import { EXECUTION_ROUTES, ExecutionBlockedError, SUPPORT_CAPACITY, planExecutability } from "@/lib/adaptation/execution";
import { normalizeGeneratedV2 } from "@/lib/adaptation/generated-v2";
import { buildGeneratorInputV2 } from "@/lib/adaptation/generator";
import { createMockGenerator, createMockPlanner, createMockReviewer } from "@/lib/adaptation/mock";
import { runAdaptation } from "@/lib/adaptation/pipeline";
import { plannerRequestParts } from "@/lib/adaptation/planner";
import { reviewPlan } from "@/lib/adaptation/plan-review";
import { sequentialIds } from "@/lib/adaptation/document";
import { DraftAdaptationPlanV2Schema } from "@/lib/schemas/adaptation-plan-draft-v2";
import { DraftGeneratedSegmentsV2Schema } from "@/lib/schemas/generated-segments-v2";
import { PLAN_REVIEW_SCHEMA_VERSION, PlanReviewSchema, type PlanReview, type PlanReviewEntry } from "@/lib/schemas/plan-review";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE, buildExperimentContext } from "../../evals/adaptation/planner-lib";
import { allPreserved, decision, planOf } from "./adaptation-helpers";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const evidenceFile = (name: string) => readFileSync(path.resolve(import.meta.dirname, "../../evals/adaptation/evidence", name), "utf8");

const frac: MaterialAnalysis = fractionsAnalysis();
const ctx2: AdaptationContext = buildExperimentContext(frac, "accessibility", 2);
const ctx1: AdaptationContext = buildExperimentContext(frac, "accessibility", 1);

const checklist = decision({ target: "document", action: "add_support", strategies: ["planning_support"], dimensions: ["checklist_support"], supports: [{ kind: "checklist", uses_task_data: false }] });
const reminder = decision({ target: "act_5", action: "add_support", strategies: ["planning_support"], dimensions: ["explicit_expectations"], intensity: "light", preserves: allPreserved(frac, "act_5"), supports: [{ kind: "self_check", uses_task_data: true }] });
const spatial = decision({ target: "act_2", action: "segment", strategies: ["task_sequencing"], dimensions: ["instruction_chunking", "predictable_structure"], intensity: "light", preserves: allPreserved(frac, "act_2") });
const steps = decision({ target: "act_3", action: "segment", strategies: ["task_sequencing"], dimensions: ["instruction_chunking"], preserves: allPreserved(frac, "act_3"), supports: [{ kind: "step_list", uses_task_data: false }] });
const nothingToRun = decision({ target: "act_1", action: "rephrase", strategies: ["instruction_clarification"], dimensions: ["instruction_chunking"], intensity: "light", preserves: allPreserved(frac, "act_1") });

const reviewFor = (plan: AdaptationPlan, entries: Array<[string, PlanReviewEntry["action"]] | PlanReviewEntry>): PlanReview => ({
  schema_version: PLAN_REVIEW_SCHEMA_VERSION,
  plan_fingerprint: fingerprint(plan),
  reviewer: { kind: "eval", label: "test" },
  reviewed_at: "2026-10-05T15:00:00Z",
  entries: entries.map((e) => (Array.isArray(e) ? { decision_id: e[0], action: e[1] as "approved" | "rejected", reason: "test" } : e)),
});
const reviewed = (analysis: MaterialAnalysis, context: AdaptationContext, decisions: ReturnType<typeof decision>[], make: (plan: AdaptationPlan) => PlanReview) => {
  const raw = planOf(analysis, context, decisions);
  return reviewPlan(raw, make(raw), analysis, context);
};

describe("every effective decision has an executor, or the preflight says why not", () => {
  const all = reviewed(frac, ctx2, [checklist, reminder, spatial, steps, nothingToRun], (plan) => reviewFor(plan, [["dec_1", "approved"], ["dec_2", "approved"], ["dec_3", "approved"], ["dec_4", "rejected"], ["dec_5", "approved"]]));
  const report = planExecutability(all, frac, ctx2);

  it("1 · an applied decision never ends without a route: AI, deferred or, when nothing can run it, an explicit `unsupported` that blocks", () => {
    const applied = all.decisions.filter((d) => d.outcome === "applied");
    expect(applied).toHaveLength(4);
    for (const d of applied) expect(EXECUTION_ROUTES).toContain(report.decisions.find((x) => x.id === d.id)!.route);
    expect(report.byRoute.ai_generation).toEqual(["dec_1", "dec_2"]);
    expect(report.byRoute.deferred_to_renderer).toEqual(["dec_3"]);
    expect(report.byRoute.unsupported).toEqual(["dec_5"]);
    expect(report.blockers.join(" ")).toMatch(/dec_5.*sin apoyo autorizado/);
    const total = Object.values(report.byRoute).reduce((n, ids) => n + ids.length, 0);
    expect(total).toBe(applied.length);
  });

  it("2 · a rejected decision has no executor: no route, never in the AI list", () => {
    const rejected = report.decisions.find((d) => d.id === "dec_4")!;
    expect(rejected).toMatchObject({ outcome: "rejected", route: null });
    expect(Object.values(report.byRoute).flat()).not.toContain("dec_4");
    expect(report.ai).not.toContain("dec_4");
  });

  it("14 · across the three materials and the mock planners, no effective decision is lost: each has a route", async () => {
    for (const build of [geographyAnalysis, argumentationAnalysis, fractionsAnalysis]) {
      const analysis = build();
      for (const version of [1, 2] as const) {
        const result = await runAdaptation(
          { profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility", policy: version },
          { planner: createMockPlanner(analysis, version), plannerVersion: version, generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds() },
        );
        const effective = result.reviewed.effective.decisions.map((d) => d.id);
        const routed = Object.values(result.execution.byRoute).flat();
        expect([...routed].sort()).toEqual([...effective].sort());
      }
    }
  });

  it("pipeline: `requireExecutable` stops before the generator when something cannot be executed", async () => {
    const analysis = frac;
    const planner = { plan: async () => ({ draft: { decisions: [nothingToRun], summary: [] }, runs: [] }) };
    const run = (requireExecutable: boolean) =>
      runAdaptation({ profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility", policy: 2 }, { planner, generator: createMockGenerator(), reviewer: null, requireExecutable });
    await expect(run(true)).rejects.toBeInstanceOf(ExecutionBlockedError);
    expect((await run(false)).execution.byRoute.unsupported).toEqual(["dec_1"]);
  });
});

describe("capability compatibility, before any model call", () => {
  const withRequest = (min_items: number) =>
    reviewed(frac, ctx2, [checklist], (plan) => reviewFor(plan, [{ decision_id: "dec_1", action: "approved", reason: "test", support_requests: [{ kind: "checklist", min_items }] }]));

  it("3 · a review that requires more elements than the block holds is found before AI, from the contract's capacity (no rule about activities)", () => {
    const report = planExecutability(withRequest(5), frac, ctx2);
    expect(report.decisions[0]!.issues.map((i) => i.code)).toEqual(["cardinality_exceeds_capability"]);
    expect(report.blockers.join(" ")).toMatch(/al menos 5 elementos en checklist y el bloque admite 4/);
    const other = reviewed(frac, ctx2, [steps], (plan) => reviewFor(plan, [{ decision_id: "dec_1", action: "approved", reason: "test", support_requests: [{ kind: "step_list", min_items: 5 }] }]));
    expect(planExecutability(other, frac, ctx2).blockers.join(" ")).toMatch(/step_list y el bloque admite 4/);
  });

  it("4 · a global checklist within the capacity reaches the generator", () => {
    const report = planExecutability(withRequest(4), frac, ctx2);
    expect(report.blockers).toEqual([]);
    expect(report.ai).toEqual(["dec_1"]);
    expect(buildGeneratorInputV2(withRequest(4), frac, ctx2).approved.decisions.map((d) => d.id)).toEqual(["dec_1"]);
  });

  it("a request for a support the decision does not authorise is also a blocker", () => {
    const wrong = reviewed(frac, ctx2, [checklist], (plan) => reviewFor(plan, [{ decision_id: "dec_1", action: "approved", reason: "test", support_requests: [{ kind: "planner", min_items: 2 }] }]));
    expect(planExecutability(wrong, frac, ctx2).decisions[0]!.issues.map((i) => i.code)).toEqual(["support_request_not_authorised"]);
  });

  it("5 · the planner needs no knowledge of the generator's limits: neither its prompt, its schema nor its request mention them", () => {
    const text = [ADAPTATION_PLANNER_V2.system, JSON.stringify(z.toJSONSchema(DraftAdaptationPlanV2Schema, { io: "input" })), plannerRequestParts({ analysis: frac, context: ctx2, version: 2 }).parts.map((p) => (p.type === "text" ? p.text : "")).join("")].join("\n");
    expect(text).not.toMatch(/generador|generator|capacity|capacidad|elementos como máximo|SUPPORT_CAPACITY/i);
    expect(sha(ADAPTATION_PLANNER_V2.system)).toBe("1007c10dfeab94efde695ea787312f7dd9dd821088953c73c15669a924ea4b8b");
  });
});

describe("decisions that no textual generator should receive", () => {
  const presentation = decision({ target: "act_1", action: "segment", strategies: ["task_sequencing"], dimensions: ["number_of_visible_tasks"], intensity: "light", preserves: allPreserved(frac, "act_1") });

  it("6 · a presentation decision is classified as such and never sent as text generation", () => {
    const r = reviewed(frac, ctx1, [presentation, checklist], (plan) => reviewFor(plan, [["dec_1", "approved"], ["dec_2", "approved"]]));
    const report = planExecutability(r, frac, ctx1);
    expect(report.byRoute.presentation).toEqual(["dec_1"]);
    expect(buildGeneratorInputV2(r, frac, ctx1).approved.decisions.map((d) => d.id)).toEqual(["dec_2"]);
    expect(report.ai).toEqual(["dec_2"]);
  });

  it("7 · a layout decision with no structure to carry it is recorded as deferred: the original stays and it is never reported as executed", () => {
    const r = reviewed(frac, ctx2, [spatial, checklist], (plan) => reviewFor(plan, [["dec_1", "approved"], ["dec_2", "approved"]]));
    const report = planExecutability(r, frac, ctx2);
    expect(report.deferred).toEqual([{ id: "dec_1", target: "act_2", action: "segment" }]);
    expect(report.decisions[0]).toMatchObject({ route: "deferred_to_renderer", outcome: "applied" });
    expect(buildGeneratorInputV2(r, frac, ctx2).approved.decisions.map((d) => d.id)).toEqual(["dec_2"]);
    expect(report.blockers).toEqual([]);
  });
});

describe("`skipped` is a structured answer, and the contract is not relaxed", () => {
  const r = reviewed(frac, ctx2, [checklist, reminder], (plan) => reviewFor(plan, [["dec_1", "approved"], ["dec_2", "approved"]]));
  const normalized = (skipped: Array<{ decision_id: string; support: "checklist"; reason: "no_new_function" }>, segments: z.input<typeof DraftGeneratedSegmentsV2Schema>["segments"] = []) =>
    normalizeGeneratedV2(DraftGeneratedSegmentsV2Schema.parse({ segments, skipped, blocked: [], change_summary: ["x"] }), r, frac, ctx2);

  it("8 · the generator can decline a redundant support with a reason", () => {
    const g = normalized([{ decision_id: "dec_2", support: "checklist", reason: "no_new_function" }], [{ decision_id: "dec_1", target: "document", supports: [{ kind: "checklist", items: ["Empiezo por lo que entiendo", "Reviso antes de entregar"] }] }]);
    expect(g.issues.some((i) => i.code === "skipped_support" && i.decision_id === "dec_2")).toBe(true);
    expect(g.generated).toEqual(["dec_1"]);
  });

  it("9 · a skipped decision is declined, not ignored", () => {
    const g = normalized([{ decision_id: "dec_2", support: "checklist", reason: "no_new_function" }], [{ decision_id: "dec_1", target: "document", supports: [{ kind: "checklist", items: ["Empiezo por lo que entiendo", "Reviso antes de entregar"] }] }]);
    expect(g.declined).toContain("dec_2");
    expect(g.ignored).toEqual([]);
    const silent = normalized([], [{ decision_id: "dec_1", target: "document", supports: [{ kind: "checklist", items: ["Empiezo por lo que entiendo", "Reviso antes de entregar"] }] }]);
    expect(silent.ignored).toEqual(["dec_2"]);
  });

  it("10 · five checklist items still fail the schema (the failure of the first Primaria run)", () => {
    const draft = { segments: [{ decision_id: "dec_1", target: "document", supports: [{ kind: "checklist", items: ["a", "b", "c", "d", "e"] }] }], skipped: [], blocked: [], change_summary: ["x"] };
    const parsed = DraftGeneratedSegmentsV2Schema.safeParse(draft);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toMatch(/<=4 items/);
  });

  it("11 · `DraftGeneratedSegments v2` and the generator prompt are exactly the published ones; the checklist cap is still 4", () => {
    const published = JSON.parse(evidenceFile("generator-v2-bachillerato.json")) as { generator: { prompt_sha256: string; schema: { draft_schema_fingerprint: string } } };
    expect(sha(MATERIAL_GENERATOR_V2.system)).toBe(published.generator.prompt_sha256);
    expect(sha(stableStringify(z.toJSONSchema(DraftGeneratedSegmentsV2Schema, { io: "input" })))).toBe(published.generator.schema.draft_schema_fingerprint);
    expect(SUPPORT_CAPACITY.checklist).toBe(4);
  });
});

describe("the review layer is versioned, not rewritten", () => {
  const planFingerprint = (JSON.parse(evidenceFile("planner-v2-primaria.json")) as { run: { raw_plan_fingerprint: string } }).run.raw_plan_fingerprint;
  const first = PlanReviewSchema.parse(JSON.parse(evidenceFile("review-primaria.json")));
  const second = PlanReviewSchema.parse(JSON.parse(evidenceFile("review-primaria-2.json")));

  it("12 · the first Primaria review is historical: byte for byte what produced the failed run", () => {
    expect(sha(evidenceFile("review-primaria.json"))).toBe("0e9aa2d45c3cb3e82bc36b433dc81354cf920043fc121437ccde756cbed1a9a2");
    expect(first.entries.find((e) => e.decision_id === "dec_1")).toMatchObject({ action: "approved" });
  });

  it("13 · the new review points to the same raw plan, keeps the rejection and edits only the global checklist", () => {
    expect(first.plan_fingerprint).toBe(planFingerprint);
    expect(second.plan_fingerprint).toBe(planFingerprint);
    expect(second.reviewer.label).not.toBe(first.reviewer.label);
    const by = (review: PlanReview, id: string) => review.entries.find((e) => e.decision_id === id)!;
    expect(by(second, "dec_2")).toMatchObject({ action: "rejected" });
    expect(by(second, "dec_1")).toMatchObject({ action: "edited" });
    expect(JSON.stringify(by(second, "dec_1").restrictions)).not.toMatch(/uno por actividad|una casilla por actividad/);
    expect(JSON.stringify(by(second, "dec_1").restrictions)).toMatch(/máximo 4/);
    expect(by(second, "dec_3")).toMatchObject({ action: "approved" });
    expect(by(second, "dec_4")).toMatchObject({ action: "approved" });
  });
});
