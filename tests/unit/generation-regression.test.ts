import { describe, expect, it } from "vitest";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { planExecutability } from "@/lib/adaptation/execution";
import { OUT_OF_BUDGET_CHECK, auditGeneration } from "@/lib/adaptation/generation-checks";
import { WORKED_EXAMPLE_ALLOWANCE, normalizeGeneratedV2, supportTolerance, supportVisibleWords } from "@/lib/adaptation/generated-v2";
import { buildGeneratorInputV2 } from "@/lib/adaptation/generator";
import { autoReview, reviewPlan } from "@/lib/adaptation/plan-review";
import { instructionWords, supportBudgetWords } from "@/lib/adaptation/proportion";
import { assembleReview, deterministicChecks } from "@/lib/adaptation/review";
import type { DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import { allBlocks } from "@/lib/schemas/material-document";
import { buildExperimentContext } from "../../evals/adaptation/planner-lib";
import { mathAnalysis, realDecisions, realDraft } from "../support/math-generation-case";
import { allPreserved, decision, planOf } from "./adaptation-helpers";

/**
 * Regression of a real «Hacer magia» failure (Matemáticas, 4.º de Primaria; synthetic data, no personal data): six executable
 * decisions, the generator went `generator_validation`. Its generation artifact recorded:
 *   · dec_1 support_over_budget 44/40 · dec_2 support_over_budget 68/64 · dec_2 rewrite_not_needed
 * and two decisions on act_3 (dec_2: worked example + checklist; dec_3: segments and rewrites the same activity).
 * This file rebuilds that case with the same shapes and numbers and runs the real path: plan → automatic review → preflight →
 * generator input → v2 normalisation → assembly → deterministic review → generation audit.
 */

const analysis = mathAnalysis();
const ctx = buildExperimentContext(analysis, "accessibility", 2);
const plan = planOf(analysis, ctx, realDecisions(analysis));
const reviewed = reviewPlan(plan, autoReview(plan, analysis, ctx), analysis, ctx);

function run(draft: DraftGeneratedSegmentsV2) {
  const generation = normalizeGeneratedV2(draft, reviewed, analysis, ctx);
  const document = buildDocument({ analysis, plan: reviewed.effective, context: ctx, generated: generation.segments, newBlockId: sequentialIds() });
  const input = { analysis, plan: reviewed.effective, context: ctx, document, validation: reviewed.effectiveValidation };
  const review = assembleReview(input, deterministicChecks(input));
  const audit = auditGeneration({ analysis, context: ctx, reviewed, generation, document, review });
  return { generation, document, review, audit };
}

describe("regression · Matemáticas 4.º Primaria, «Hacer magia» stopped in generator_validation", () => {
  it("the case is the real one: six executable decisions, budgets 40 and 64, two decisions on act_3", () => {
    expect([instructionWords(analysis.activities[0]!), supportBudgetWords(analysis.activities[0]!)]).toEqual([20, 40]);
    expect([instructionWords(analysis.activities[2]!), supportBudgetWords(analysis.activities[2]!)]).toEqual([32, 64]);
    expect(reviewed.decisions.map((d) => d.outcome)).toEqual(Array(6).fill("applied"));
    expect(planExecutability(reviewed, analysis, ctx).blockers).toEqual([]);
    expect(plan.decisions.filter((d) => d.target === "act_3").map((d) => d.action)).toEqual(["add_support", "segment"]);
  });

  it("the generator is told to rewrite ONLY by the decision that rewrites (dec_3), never by one that only adds supports (dec_2)", () => {
    const sent = buildGeneratorInputV2(reviewed, analysis, ctx).approved.decisions;
    expect(sent.find((d) => d.id === "dec_3")?.instruction_policy).toBe("rewrite");
    expect(sent.find((d) => d.id === "dec_2")?.instruction_policy).toBe("keep");
  });

  it("the real answer now passes the audit: the unrequested rewrite is discarded (the original/dec_3's stays), nothing else is lost", () => {
    const { generation, audit, review, document } = run(realDraft);
    expect(generation.issues.filter((i) => i.code === "rewrite_not_needed").map((i) => i.decision_id)).toEqual(["dec_2"]);
    expect(audit.checks.filter((c) => !c.ok)).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(review.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    // dec_3 is the one that rewrites act_3; dec_2's worked example comes BEFORE the activity (a model to follow), its checklist after.
    const act3 = allBlocks(document).filter((b) => b.trace.source_refs.includes("act_3"));
    expect(act3.map((b) => [b.type, b.trace.decision_ids])).toEqual([
      ["worked_example", ["dec_2"]],
      ["activity", ["dec_3"]],
      ["checklist", ["dec_2"]],
    ]);
  });

  it("44/40 and 68/64: words are counted on what the student reads (the JSON keys «items», «problem», «steps», «result» were counted as words)", () => {
    const over = run(realDraft).generation.issues.filter((i) => i.code === "support_over_budget");
    // dec_2 is exactly on budget once the four key names are not counted; dec_1 (with its title, which the prompt counts) is a
    // small overrun inside the tolerance: kept whole and reported, never a failure.
    expect(over.map((i) => [i.decision_id, i.detail])).toEqual([["dec_1", expect.stringMatching(/^Los apoyos suman 46 palabras y el presupuesto era 40 \(dentro de la tolerancia\)/)]]);
  });
});

const withSegment = (id: string, over: Partial<DraftGeneratedSegmentsV2["segments"][number]>): DraftGeneratedSegmentsV2 => ({ ...realDraft, segments: realDraft.segments.map((s) => (s.decision_id === id ? { ...s, ...over } : s)) });

describe("two decisions on the same activity combine without duplicating", () => {
  it("a checklist item of dec_2 that repeats dec_3's rewritten step word for word is dropped (it was compared only with the original before)", () => {
    const repeated = withSegment("dec_2", { supports: [realDraft.segments[1]!.supports[0]!, { kind: "checklist", items: ["Simplifica el resultado si se puede.", "¿He sumado solo los numeradores?"] }] });
    const { generation, audit } = run(repeated);
    expect(generation.issues.some((i) => i.code === "duplicate_item_dropped" && i.decision_id === "dec_2")).toBe(true);
    expect(audit.ok).toBe(true);
  });

  it("only ONE decision may rewrite an activity: a second rewriting decision's rewrite is discarded, never two versions of the task", () => {
    const twoRewriters = planOf(analysis, ctx, [...realDecisions(analysis), decision({ target: "act_3", action: "rephrase", strategies: ["language_simplification"], dimensions: ["instruction_chunking"], intensity: "light", preserves: allPreserved(analysis, "act_3") })]);
    const r2 = reviewPlan(twoRewriters, autoReview(twoRewriters, analysis, ctx), analysis, ctx);
    const policies = buildGeneratorInputV2(r2, analysis, ctx).approved.decisions.filter((d) => d.target === "act_3").map((d) => [d.id, d.instruction_policy]);
    expect(policies).toEqual([["dec_2", "keep"], ["dec_3", "rewrite"], ["dec_7", "keep"]]);
  });
});

describe("support budgets: a small tolerance, a safe condensation, and an explicit limit beyond it", () => {
  const budgetOf = (id: string) => buildGeneratorInputV2(reviewed, analysis, ctx).approved.decisions.find((d) => d.id === id)!.support_budget_words;
  const items = (id: string, g: ReturnType<typeof run>["generation"]) => {
    const block = g.segments.segments.find((s) => s.decision_ids.includes(id))!.blocks[0]!;
    return block.type === "checklist" ? { title: block.title, items: block.items } : null;
  };

  it("the generator is given the same budget the server applies: a worked example gets its own allowance (its steps are never cut)", () => {
    expect([budgetOf("dec_1"), budgetOf("dec_2"), budgetOf("dec_4")]).toEqual([40, 64 + WORKED_EXAMPLE_ALLOWANCE, 24]);
    expect(supportTolerance(40)).toBe(6);
  });

  it("over the tolerance, the server first condenses SAFELY (optional title, items that nearly repeat the task) and it fits: accepted", () => {
    const wordy = { kind: "checklist" as const, title: "Antes de colorear la figura del ejercicio", items: ["La figura es un rectángulo dividido en cuatro partes iguales", "Cuento una por una las partes iguales que tiene la figura entera", "Miro el número de abajo de la fracción para saber cuántas partes hay", "Coloreo sin salirme de las líneas y repaso al final que está bien"] };
    expect(supportVisibleWords(wordy)).toBeGreaterThan(46);
    const { generation, audit } = run(withSegment("dec_1", { supports: [wordy] }));
    expect(generation.issues.find((i) => i.code === "support_condensed" && i.decision_id === "dec_1")?.detail).toMatch(/título de checklist.*1 elemento\(s\) casi repetidos/);
    // What says something new stays whole; nothing is cut inside an item.
    expect(items("dec_1", generation)).toEqual({ title: undefined, items: wordy.items.slice(1) });
    expect(generation.issues.some((i) => i.code === "support_out_of_budget")).toBe(false);
    expect(audit.ok).toBe(true);
  });

  it("still over after the safe condensation (here +60 %, well under twice): NOT accepted — the audit fails, pinned on its decision", () => {
    const longChecklist = { kind: "checklist" as const, items: ["Cuento con cuidado todas las partes iguales en que está dividida la figura", "Miro el número de abajo para saber en cuántas partes iguales se divide", "Miro el número de arriba para saber cuántas de esas partes debo colorear", "Coloreo con un solo color y repaso que no me sobra ni me falta ninguna"] };
    const { generation, audit } = run(withSegment("dec_1", { supports: [longChecklist] }));
    const words = supportVisibleWords(longChecklist);
    expect(words).toBeGreaterThan(46);
    expect(words).toBeLessThan(80);
    expect(items("dec_1", generation)?.items).toEqual(longChecklist.items); // kept whole: never cut to fit
    expect(audit.checks.filter((c) => !c.ok).map((c) => [c.name, c.decisions])).toEqual([[OUT_OF_BUDGET_CHECK, ["dec_1"]]]);
  });

  it("a worked example within its allowance is accepted whole; one far beyond it fails, and its steps are never removed to fit", () => {
    const fits = { kind: "worked_example" as const, problem: "Calcula 1/7 + 3/7 y simplifica si se puede.", steps: ["Miro si los denominadores son iguales: los dos son 7.", "Sumo solo los numeradores: 1 + 3 = 4.", "Mantengo el denominador común: queda 4/7.", "Busco divisores comunes de 4 y 7: no hay, no se simplifica."], result: "1/7 + 3/7 = 4/7" };
    expect(run(withSegment("dec_2", { rewrite: undefined, supports: [fits] })).audit.ok).toBe(true);
    const huge = {
      ...fits,
      problem: "Calcula 1/7 + 3/7 y simplifica si se puede. Explica cada paso con detalle y con tus propias palabras, di por qué lo haces así, comprueba el resultado con un dibujo de tiras y escribe al final una frase que resuma lo que has aprendido sobre sumar fracciones con el mismo denominador.",
      steps: [
        "Primero observo con atención que las dos fracciones tienen exactamente el mismo denominador, que en este ejemplo es siete.",
        "Después sumo únicamente los numeradores, uno más tres, y obtengo cuatro como nuevo numerador de la fracción final.",
        "A continuación copio sin cambiarlo el denominador común, porque el tamaño de cada parte de la unidad no varía.",
        "Luego busco divisores comunes de cuatro y de siete para decidir si la fracción obtenida admite alguna simplificación.",
        "Finalmente compruebo el resultado dibujando una tira dividida en siete partes y coloreando las cuatro que he sumado.",
      ],
    };
    const { generation, audit } = run(withSegment("dec_2", { rewrite: undefined, supports: [huge] }));
    const example = generation.segments.segments.find((s) => s.decision_ids.includes("dec_2"))!.blocks.find((b) => b.type === "worked_example");
    expect(example?.type === "worked_example" ? example.steps : []).toEqual(huge.steps);
    expect(audit.checks.filter((c) => !c.ok).map((c) => [c.name, c.decisions])).toEqual([[OUT_OF_BUDGET_CHECK, ["dec_2"]]]);
  });
});

describe("the worked example still teaches (pedagogical checks of the repaired case)", () => {
  const { document, review } = run(realDraft);
  const example = allBlocks(document).find((b) => b.type === "worked_example");

  it("is analogous: other data, mathematically right, and it does not solve the student's task", () => {
    expect(example?.type === "worked_example" ? [example.problem, example.result] : []).toEqual(["Calcula 1/7 + 3/7 y simplifica si se puede.", "1/7 + 3/7 = 4/7"]);
    expect(1 + 3).toBe(4); // 1/7 + 3/7 = 4/7, already irreducible
    const text = JSON.stringify(example);
    expect(text).not.toMatch(/2\/5|1\/5|3\/5/); // the task's own data (2/5 + 1/5 = 3/5) never appears in it
    expect(review.checks.find((c) => c.check === "answers_not_leaked")?.status).not.toBe("FAIL");
  });

  it("comes before the activity it helps, repeats no sentence of it, and the task keeps its data and requirements", () => {
    const blocks = allBlocks(document);
    const at = (pred: (b: (typeof blocks)[number]) => boolean) => blocks.findIndex(pred);
    expect(at((b) => b.type === "worked_example")).toBe(at((b) => b.type === "activity" && b.trace.source_refs.includes("act_3")) - 1);
    const task = blocks.find((b) => b.type === "activity" && b.trace.source_refs.includes("act_3"));
    expect(JSON.stringify(task)).toMatch(/2\/5 \+ 1\/5/);
    expect(review.checks.filter((c) => ["instructions_complete", "protected_elements_preserved", "required_data_preserved", "constraints_preserved"].includes(c.check)).map((c) => c.status)).not.toContain("FAIL");
  });
});
