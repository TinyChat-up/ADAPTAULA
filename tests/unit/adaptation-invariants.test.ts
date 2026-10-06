import { describe, expect, it } from "vitest";
import { applicablePlan, planMatches } from "@/lib/adaptation/plan";
import { validatePlan } from "@/lib/adaptation/invariants";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { PROFILES } from "../../evals/adaptation/scenarios";
import { allPreserved, contextFor, decision, issuesOf, planOf } from "./adaptation-helpers";

const geo = geographyAnalysis();
const bach = argumentationAnalysis();
const frac = fractionsAnalysis();
const geoWriting = contextFor(geo, PROFILES.writingReduction);
const bachWriting = contextFor(bach, PROFILES.readingVsSource);

describe("plan invariants: a change needs a functional reason, never a label", () => {
  it("a change without a dimension of the context, or with a dimension the profile does not have, is blocked", () => {
    expect(issuesOf(geo, geoWriting, [decision({ target: "act_2", action: "rephrase", strategies: ["language_simplification"], preserves: allPreserved(geo, "act_2") })])).toContain("block:unjustified_change");
    expect(issuesOf(geo, geoWriting, [decision({ target: "act_2", action: "rephrase", strategies: ["language_simplification"], dimensions: ["literal_language"], preserves: allPreserved(geo, "act_2") })])).toContain("block:unjustified_change");
  });

  it("references must exist in the analysis (no text as identity, no invented targets)", () => {
    expect(issuesOf(geo, geoWriting, [decision({ target: "act_9", action: "segment", strategies: ["task_sequencing"], dimensions: ["writing_amount"] })])).toContain("block:unknown_reference");
    expect(issuesOf(geo, geoWriting, [decision({ target: "act_2", action: "add_support", strategies: ["planning_support"], dimensions: ["writing_amount"], preserves: ["prt_99"] })])).toContain("block:unknown_reference");
  });

  it("a plan is bound to the analysis and context it was built for", () => {
    const plan = planOf(geo, geoWriting, []);
    expect(planMatches(plan, geo, geoWriting)).toBe(true);
    expect(planMatches(plan, frac, geoWriting)).toBe(false);
    expect(planMatches(plan, geo, contextFor(geo, PROFILES.executive))).toBe(false);
  });
});

describe("writing: reduced only when it is not what is assessed", () => {
  it("1 · reducing writing where writing is NOT the objective is allowed", () => {
    const issues = issuesOf(geo, geoWriting, [decision({ target: "act_2", action: "change_response_format", strategies: ["writing_load_reduction"], dimensions: ["writing_amount"], response_target: "keyboard", preserves: allPreserved(geo, "act_2") })]);
    expect(issues.filter((i) => i.startsWith("block:"))).toEqual([]);
    expect(issues).not.toContain("block:written_expression_replaced");
  });

  it("2 · reducing or replacing writing where written expression IS the objective is blocked", () => {
    const reduce = decision({ target: "act_5", action: "change_response_format", strategies: ["writing_load_reduction"], dimensions: ["writing_amount"], response_target: "write_text_short", preserves: allPreserved(bach, "act_5") });
    expect(issuesOf(bach, bachWriting, [reduce])).toContain("block:written_expression_replaced");
    expect(issuesOf(geo, geoWriting, [{ ...reduce, preserves: allPreserved(geo, "act_5") }])).toContain("block:written_expression_replaced");
    const choice = decision({ target: "act_5", action: "change_response_format", strategies: ["response_choice"], dimensions: ["writing_amount"], response_target: "select_option", preserves: allPreserved(bach, "act_5") });
    expect(issuesOf(bach, bachWriting, [choice])).toContain("block:written_expression_replaced");
  });

  it("supporting evaluated writing (planner, starters) is fine", () => {
    const issues = issuesOf(bach, bachWriting, [decision({ target: "act_5", action: "add_support", strategies: ["planning_support"], dimensions: ["writing_amount"], supports: [{ kind: "planner", uses_task_data: false }] })]);
    expect(issues.filter((i) => i.startsWith("block:"))).toEqual([]);
    expect(issues).toContain("review:needs_conflict");
  });
});

describe("protected elements condition every decision that modifies a target", () => {
  it("3 · segmenting an instruction without declaring its essential conditions is blocked; declaring them passes", () => {
    const ctx = contextFor(geo, PROFILES.executive);
    const without = decision({ target: "act_4", action: "segment", strategies: ["task_sequencing"], dimensions: ["instruction_chunking"] });
    expect(issuesOf(geo, ctx, [without])).toContain("block:protected_element_modified");
    const withAll = { ...without, preserves: allPreserved(geo, "act_4") };
    expect(issuesOf(geo, ctx, [withAll]).filter((i) => i.startsWith("block:"))).toEqual([]);
  });

  it("15 · an essential protected element left out of a modifying decision blocks it (important ones only need review)", () => {
    const ctx = contextFor(geo, PROFILES.language);
    const essentialOnly = allPreserved(geo, "act_3").filter((id) => geo.protected_elements.find((p) => p.id === id)?.importance === "essential");
    const issues = issuesOf(geo, ctx, [decision({ target: "act_3", action: "rephrase", strategies: ["language_simplification"], dimensions: ["syntax_complexity"], preserves: essentialOnly })]);
    expect(issues).toContain("review:protected_element_modified");
    expect(issues).not.toContain("block:protected_element_modified");
  });
});

describe("data, visuals and source texts", () => {
  const visual = contextFor(geo, PROFILES.visualLoad);

  it("5 · removing or reducing a required table is blocked", () => {
    expect(issuesOf(geo, visual, [decision({ target: "vis_1", action: "remove", strategies: ["visual_load_reduction"], dimensions: ["visual_density"] })])).toContain("block:required_data_removed");
    expect(issuesOf(geo, visual, [decision({ target: "vis_1", action: "reduce", strategies: ["text_segmentation"], dimensions: ["visual_density"], preserves: allPreserved(geo, "vis_1") })])).toContain("block:required_data_removed");
  });

  it("7 · a necessary chart is never replaced by a new representation; transforming it needs review", () => {
    const base = { target: "act_2", action: "add_support" as const, strategies: ["visual_support" as const], dimensions: ["visual_support" as const] };
    expect(issuesOf(geo, visual, [decision({ ...base, visual: { mode: "new_representation", source_visual: "vis_2", purpose: "Otra forma de ver las edades", essential: true } })])).toContain("block:essential_visual_replaced");
    expect(issuesOf(geo, visual, [decision({ ...base, visual: { mode: "transform_original", source_visual: "vis_2", purpose: "Más contraste", essential: true } })])).toContain("review:essential_visual_replaced");
    expect(issuesOf(geo, visual, [decision({ target: "vis_2", action: "rephrase", strategies: ["language_simplification"], dimensions: ["visual_density"], preserves: allPreserved(geo, "vis_2") })])).toContain("block:essential_visual_replaced");
  });

  it("8 · removing a decorative visual for a visual-load need is a clean decision", () => {
    expect(issuesOf(geo, visual, [decision({ target: "vis_4", action: "remove", strategies: ["visual_load_reduction"], dimensions: ["unnecessary_decoration"] })])).toEqual([]);
  });

  it("12 · a literal source text cannot be rephrased, reduced or removed; it can be segmented", () => {
    for (const action of ["rephrase", "reduce", "remove"] as const) {
      expect(issuesOf(bach, bachWriting, [decision({ target: "ctt_1", action, strategies: ["text_segmentation", "language_simplification"], dimensions: ["text_length"], preserves: allPreserved(bach, "ctt_1") })]), action).toContain("block:source_text_altered");
    }
    const seg = issuesOf(bach, bachWriting, [decision({ target: "ctt_1", action: "segment", strategies: ["text_segmentation"], dimensions: ["text_length"], preserves: allPreserved(bach, "ctt_1") })]);
    expect(seg.filter((i) => i.startsWith("block:"))).toEqual([]);
    expect(seg).toContain("review:needs_conflict");
  });
});

describe("operations, open tasks, extension and answers", () => {
  it("turning a calculation into choosing a result is blocked (the operation is what is assessed)", () => {
    const ctx = contextFor(frac, { ...PROFILES.writingReduction, supports: { selection_based_response: "high" } });
    expect(issuesOf(frac, ctx, [decision({ target: "act_3", action: "change_response_format", strategies: ["response_choice"], dimensions: ["selection_based_response"], response_target: "select_option", preserves: allPreserved(frac, "act_3") })])).toContain("block:target_operation_replaced");
  });

  it("closing an open reasoning task needs review", () => {
    const ctx = contextFor(geo, { ...PROFILES.writingReduction, supports: { selection_based_response: "high" } });
    const issues = issuesOf(geo, ctx, [decision({ target: "act_2", action: "change_response_format", strategies: ["response_choice"], dimensions: ["selection_based_response"], response_target: "select_option", preserves: allPreserved(geo, "act_2") })]);
    expect(issues).toContain("review:open_task_closed");
  });

  it("18 · changing the extension of a task that does not assess writing needs the teacher's review", () => {
    const ctx = contextFor(frac, PROFILES.writingReduction);
    const issues = issuesOf(frac, ctx, [decision({ target: "act_5", action: "change_response_format", strategies: ["writing_load_reduction"], dimensions: ["writing_amount"], response_target: "write_text_short", preserves: allPreserved(frac, "act_5") })]);
    expect(issues).toContain("review:extension_changed");
    expect(issues.filter((i) => i.startsWith("block:"))).toEqual([]);
  });

  it("4 · a worked example on the task's own data is its answer: blocked; an analogous one is fine", () => {
    const ctx = contextFor(geo, { ...PROFILES.reading, supports: { worked_examples: "high" } });
    const base = { target: "act_1", action: "add_support" as const, strategies: ["worked_example" as const], dimensions: ["worked_examples" as const] };
    expect(issuesOf(geo, ctx, [decision({ ...base, supports: [{ kind: "worked_example", uses_task_data: true }] })])).toContain("block:answer_revealed");
    expect(issuesOf(geo, ctx, [decision({ ...base, supports: [{ kind: "worked_example", uses_task_data: false }] })]).filter((i) => i.startsWith("block:"))).toEqual([]);
  });

  it("removing an activity changes what is assessed: blocked (and the objective it served is reported)", () => {
    const issues = issuesOf(frac, contextFor(frac, PROFILES.executive), [decision({ target: "act_3", action: "remove", strategies: ["pacing"], dimensions: ["number_of_visible_tasks"] })]);
    expect(issues).toEqual(expect.arrayContaining(["block:activity_removed", "block:objective_changed"]));
  });

  it("a curricular adaptation may drop an activity, but only with review", () => {
    const issues = issuesOf(frac, contextFor(frac, PROFILES.executive, "curricular"), [decision({ target: "act_3", action: "remove", strategies: ["pacing"], dimensions: ["number_of_visible_tasks"] })]);
    expect(issues).toEqual(expect.arrayContaining(["review:activity_removed", "review:objective_changed"]));
  });
});

describe("blocked decisions are never applied", () => {
  it("applicablePlan drops exactly the blocked decisions and keeps the validation for the teacher and the planner repair", () => {
    const ok = decision({ target: "vis_4", action: "remove", strategies: ["visual_load_reduction"], dimensions: ["unnecessary_decoration"] });
    const bad = decision({ target: "vis_1", action: "remove", strategies: ["visual_load_reduction"], dimensions: ["unnecessary_decoration"] });
    const ctx = contextFor(geo, PROFILES.visualLoad);
    const { plan, validation } = applicablePlan(planOf(geo, ctx, [ok, bad]), geo, ctx);
    expect(validation.valid).toBe(false);
    expect(plan.decisions.map((d) => d.target)).toEqual(["vis_4"]);
    expect(validatePlan(plan, geo, ctx).valid).toBe(true);
  });
});
