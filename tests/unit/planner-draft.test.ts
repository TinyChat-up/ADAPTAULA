import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { validatePlan } from "@/lib/adaptation/invariants";
import { needRefTable } from "@/lib/adaptation/plan-v2";
import { createModelPlanner, parsePlanResponse } from "@/lib/adaptation/planner";
import { checkPlanDraft, fixDraftV2, repairNotes } from "@/lib/adaptation/planner-draft";
import { RejectedStageOutput } from "@/lib/adaptation/services";
import type { StructuredResponse } from "@/lib/ai/types";
import { mathAnalysis } from "../support/math-generation-case";
import { fakeProvider, validFractionsDraft, type ProviderLog } from "../support/planner-provider";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";

/**
 * HOTFIX planner_schema: the planner's draft for the fractions sheet (4.º de Primaria, five activities) judged before it becomes a
 * plan. What is unequivocal is fixed and recorded; what is not is described (path and rule, never the model's text) for the single
 * repair; nothing invalid becomes a plan. 0 real model calls.
 */

const analysis = mathAnalysis();
const context = buildAdaptationContext({ profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: "primaria", grade: "4", subject: "matematicas" }, analysis, adaptationType: "accessibility", policy: 2 }).context;
const valid = () => validFractionsDraft(context.needs, analysis);
/** The draft as untrusted JSON, so a test can write what a model could write. */
type Loose = { decisions: Array<Record<string, unknown>>; summary: unknown };
const edit = (f: (d: Loose) => void) => {
  const d = structuredClone(valid()) as unknown as Loose;
  f(d);
  return d;
};
const response = (text: string, over: Partial<StructuredResponse> = {}): StructuredResponse => ({ text, stopReason: "complete", usage: { inputTokens: 6000, outputTokens: 900, cachedInputTokens: 0, cacheCreationInputTokens: 0 }, provider: "anthropic", model: "m", latencyMs: 1, ...over });

describe("a valid plan for the five fractions activities", () => {
  it("becomes the canonical plan as is: no fix, every decision on a real activity, every need from the context, nothing removed", () => {
    const checked = checkPlanDraft(2, valid(), analysis, context);
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    expect(checked.fixes).toEqual([]);
    expect(analysis.activities).toHaveLength(5);
    expect(new Set(checked.plan.decisions.map((d) => d.target))).toEqual(new Set(["act_1", "act_2", "act_3", "act_4", "act_5"]));
    const needs = new Set(context.needs.map((n) => n.dimension));
    expect(checked.plan.decisions.every((d) => d.dimensions.length > 0 && d.dimensions.every((x) => needs.has(x)))).toBe(true);
    expect(checked.plan.decisions.some((d) => d.action === "remove")).toBe(false);
    // The pedagogical invariants still judge it (objectives, protected elements, activities): nothing blocks.
    expect(validatePlan(checked.plan, analysis, context).issues.filter((i) => i.severity === "block")).toEqual([]);
  });
});

describe("what the model gets wrong, diagnosed without its content", () => {
  it("malformed JSON and a cut-off answer are told apart (truncated never parsed), with no value of the answer kept", () => {
    expect(parsePlanResponse(response("Aquí tienes el plan: {\"decisions\": [ {\"target\": \"act_1\",, }"), 2)).toMatchObject({ outcome: "not_json" });
    expect(parsePlanResponse(response(JSON.stringify(valid()).slice(0, 400), { stopReason: "max_tokens" }), 2)).toMatchObject({ outcome: "truncated" });
  });

  it("an unknown enum value, a missing required field and a fifth need: exact path and rule, kind `schema`", () => {
    const badEnum = checkPlanDraft(2, edit((d) => (d.decisions[1]!.strategies = ["chunking"])), analysis, context);
    expect(badEnum).toMatchObject({ ok: false, kind: "schema" });
    if (badEnum.ok) return;
    expect(badEnum.issues).toEqual([expect.objectContaining({ path: "decisions.1.strategies.0", code: "invalid_value" })]);
    expect(badEnum.issues[0]!.rule).toContain("working_memory_support");
    expect(JSON.stringify(badEnum.issues)).not.toContain("chunking");

    const missing = checkPlanDraft(2, edit((d) => delete d.decisions[2]!.intensity), analysis, context);
    expect(missing.ok ? [] : missing.issues).toEqual([expect.objectContaining({ path: "decisions.2.intensity", code: "missing", rule: expect.stringMatching(/^obligatorio/) })]);

    const tooMany = checkPlanDraft(2, edit((d) => (d.decisions[0]!.need_refs = needRefTable(context).slice(0, 5).map((n) => n.ref))), analysis, context);
    expect(tooMany.ok ? [] : tooMany.issues).toEqual([expect.objectContaining({ path: "decisions.0.need_refs", code: "too_big", rule: "como máximo 4 elementos" })]);
  });

  it("a need the context does not have is a reference problem (`normalization`), never a guessed need", () => {
    const unknown = checkPlanDraft(2, edit((d) => (d.decisions[0]!.need_refs = ["need_9"])), analysis, context);
    expect(unknown).toMatchObject({ ok: false, kind: "normalization", issues: [{ path: "decisions.0.need_refs.0", code: "unknown_need_ref" }] });
  });

  it("an activity the material does not have passes the contract (it is an id) and is BLOCKED by the pedagogical validator, never applied", () => {
    const checked = checkPlanDraft(2, edit((d) => (d.decisions[0]!.target = "act_9")), analysis, context);
    if (!checked.ok) throw new Error("expected a plan");
    const issues = validatePlan(checked.plan, analysis, context).issues;
    expect(issues).toContainEqual(expect.objectContaining({ decision_id: "dec_1", severity: "block", flag: "unknown_reference" }));
  });
});

describe("unequivocal fixes only, each recorded", () => {
  it("null optional fields, repeated values, a need reference written otherwise, case and spaces, overlong teacher text", () => {
    const messy = edit((d) => {
      d.decisions[0]!.note = null;
      d.decisions[0]!.flags = null;
      d.decisions[1]!.strategies = ["Working_Memory_Support ", "working_memory_support", "worked_example"];
      d.decisions[2]!.need_refs = [...(d.decisions[2]!.need_refs as string[]).map((r) => r.replace("need_", "need_0")), ...(d.decisions[2]!.need_refs as string[])];
      d.decisions[3]!.action = " Add_Support";
      d.decisions[4]!.note = "x".repeat(200);
      d.summary = ["Punto uno.", "y".repeat(170), "Dos.", "Tres.", "Cuatro.", "Cinco.", "Seis."];
    });
    const checked = checkPlanDraft(2, messy, analysis, context);
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    expect(checked.fixes.length).toBeGreaterThanOrEqual(7);
    // The same decisions, in the same order, on the same targets and needs as the clean draft: nothing reinterpreted.
    const clean = checkPlanDraft(2, valid(), analysis, context);
    if (!clean.ok) throw new Error("clean");
    expect(checked.plan.decisions.map((d) => [d.target, d.action, d.dimensions])).toEqual(clean.plan.decisions.map((d) => [d.target, d.action, d.dimensions]));
    expect(checked.plan.decisions[4]!.note).toBeUndefined();
    expect(checked.plan.summary).toEqual(["Punto uno.", "Dos.", "Tres.", "Cuatro.", "Cinco."]);
  });

  it("never guesses: a fifth need, an unknown strategy or a missing field are left for the model's repair", () => {
    const { fixes } = fixDraftV2(edit((d) => {
      d.decisions[0]!.need_refs = needRefTable(context).slice(0, 5).map((n) => n.ref);
      d.decisions[1]!.strategies = ["chunking"];
      delete d.decisions[2]!.intensity;
    }));
    expect(fixes).toEqual([]);
  });

  it("the repair notes name the field and the rule (server wording); a cut-off answer is asked to be complete and shorter", () => {
    const tooMany = checkPlanDraft(2, edit((d) => (d.decisions[0]!.need_refs = needRefTable(context).slice(0, 5).map((n) => n.ref))), analysis, context);
    if (tooMany.ok) throw new Error("expected issues");
    expect(repairNotes("schema", tooMany.issues)).toEqual([expect.objectContaining({ decision_id: "dec_1", message: expect.stringMatching(/^need_refs: como máximo 4 elementos; .*divídela/) })]);
    expect(repairNotes("truncated", [])[0]!.message).toMatch(/se cortó por longitud.*más breve/);
    expect(repairNotes("not_json", [])[0]!.message).toMatch(/no era un objeto JSON válido/);
  });
});

describe("the real model planner reports what it rejected (paths, rules, tokens), keeping the parsed value only in memory", () => {
  it("schema: issues and the parsed draft; truncated: the tokens and the budget of the call", async () => {
    const log: ProviderLog = { requests: [] };
    const answers = [response(JSON.stringify(edit((d) => (d.decisions[1]!.strategies = ["chunking"])))), response("{\"decisions\": [", { stopReason: "max_tokens", usage: { inputTokens: 6000, outputTokens: 4000, cachedInputTokens: 0, cacheCreationInputTokens: 0 } })];
    const planner = createModelPlanner({ analysis, selection: { alias: "STANDARD", provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" }, provider: fakeProvider((call) => ({ text: answers[call - 1]!.text, stopReason: answers[call - 1]!.stopReason, outputTokens: answers[call - 1]!.usage.outputTokens }), log), maxOutputTokens: 4000, version: 2 });
    const input = { context, material: analysis as never };
    const schema = await planner.plan(input).catch((e: unknown) => e);
    expect(schema).toBeInstanceOf(RejectedStageOutput);
    expect((schema as RejectedStageOutput).detail).toMatchObject({ kind: "schema", issues: [{ path: "decisions.1.strategies.0", code: "invalid_value" }], outputTokens: 900, maxOutputTokens: 4000 });
    expect((schema as RejectedStageOutput).detail?.json).toBeDefined();
    const cut = await planner.plan({ ...input, maxOutputTokens: 8000 }).catch((e: unknown) => e);
    expect((cut as RejectedStageOutput).detail).toMatchObject({ kind: "truncated", issues: [], outputTokens: 4000, maxOutputTokens: 8000 });
    expect((cut as RejectedStageOutput).detail?.json).toBeUndefined();
    expect(log.requests.map((r) => r.maxOutputTokens)).toEqual([4000, 8000]);
  });
});
