import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MATERIAL_GENERATOR_V1 } from "@prompts/material-generator/v1";
import { MATERIAL_GENERATOR_V2 } from "@prompts/material-generator/v2";
import { z } from "zod";
import { buildAdaptationContext, contextFingerprint } from "@/lib/adaptation/context";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { studentText, textOf } from "@/lib/adaptation/document-text";
import { stableStringify } from "@/lib/adaptation/fingerprint";
import { auditGeneration } from "@/lib/adaptation/generation-checks";
import { normalizeGeneratedV2 } from "@/lib/adaptation/generated-v2";
import { buildGeneratorInputV2, callGenerator, createModelGenerator, generatorRequestParts, normalizeGeneration, parseGeneratorResponse } from "@/lib/adaptation/generator";
import { mockGenerateDraft, mockGenerateDraftV2 } from "@/lib/adaptation/mock";
import { runAdaptation } from "@/lib/adaptation/pipeline";
import { reviewPlan } from "@/lib/adaptation/plan-review";
import { PROPORTION_POLICY, instructionNeedsRewrite, supportBudgetWords } from "@/lib/adaptation/proportion";
import { activityExpansion, expansionBand, repeatsAmong } from "@/lib/adaptation/redundancy";
import { buildReview, checkOf, mergeAiChecks, deterministicChecks, verdictOf } from "@/lib/adaptation/review";
import { isMechanicallyVerifiable } from "@/lib/adaptation/review-checks";
import { validatePlan } from "@/lib/adaptation/invariants";
import { getMaterialGenerator, ACTIVE_ADAPTATION_PROMPT_VERSIONS } from "@/lib/ai/prompts";
import { resolveModel } from "@/lib/ai/registry";
import type { AIProvider, StructuredRequest, StructuredResponse } from "@/lib/ai/types";
import { DraftGeneratedSegmentsSchema } from "@/lib/schemas/ai-contracts";
import { DraftGeneratedSegmentsV2Schema, type DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import { allBlocks } from "@/lib/schemas/material-document";
import { materialNumbers } from "@/lib/adaptation/facts";
import { argumentationAnalysis, fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { AB_MATERIALS, runAb } from "../../evals/adaptation/generator-ab";
import { BACH_PLAN_DRAFT, MOBILITY_PLAN_DRAFT, bachReviewFor, bachilleratoMirrorAnalysis, evalReviewFor, mobilityAnalysis, mobilityRawPlan } from "../../evals/adaptation/generator-fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE, buildExperimentContext } from "../../evals/adaptation/planner-lib";
import { SCENARIOS } from "../../evals/adaptation/scenarios";
import { decision, planOf } from "./adaptation-helpers";
import { normalizePlan } from "@/lib/adaptation/plan";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const evidence = (name: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../evals/adaptation/evidence", name), "utf8"));

// Bachillerato mirror: 5 activities, a textual inferred answer, a 31-word statement for activity 5, the review of the real experiment.
const bach = bachilleratoMirrorAnalysis();
const bachContext = buildExperimentContext(bach);
const bachRaw = normalizePlan(BACH_PLAN_DRAFT, bach, bachContext);
const bachReviewed = reviewPlan(bachRaw, bachReviewFor(bachRaw), bach, bachContext);
const geo = mobilityAnalysis();
const geoContext = buildExperimentContext(geo);
const geoRaw = mobilityRawPlan(geo, geoContext);
const geoReviewed = reviewPlan(geoRaw, evalReviewFor(geoRaw), geo, geoContext);

const v2 = (reviewed = bachReviewed, analysis = bach, context = bachContext) => (draft: DraftGeneratedSegmentsV2) => {
  const generation = normalizeGeneratedV2(DraftGeneratedSegmentsV2Schema.parse(draft), reviewed, analysis, context);
  const document = buildDocument({ analysis, plan: reviewed.effective, context, generated: generation.segments, newBlockId: sequentialIds() });
  const review = buildReview({ analysis, plan: reviewed.effective, context, document, validation: reviewed.effectiveValidation });
  return { generation, document, review, audit: auditGeneration({ analysis, context, reviewed, generation, document, review }) };
};
const assembleBach = v2();
const empty = { skipped: [], blocked: [], change_summary: ["x"] };
const codes = (g: { issues: Array<{ code: string }> }) => g.issues.map((i) => i.code);
const activityText = (doc: ReturnType<typeof assembleBach>["document"], ref: string) => textOf(allBlocks(doc).filter((b) => b.trace.source_refs.includes(ref) && b.type === "activity"));

describe("the Bachillerato mirror reproduces the real structure the experiments saw", () => {
  it("5 activities, a 10-word and a 31-word instruction, the review of the experiment applied (dec_2,3,4,6,7)", () => {
    expect(bach.activities).toHaveLength(5);
    expect(bachReviewed.effective.decisions.map((d) => d.id)).toEqual(["dec_2", "dec_3", "dec_4", "dec_6", "dec_7"]);
    expect(bachReviewed.classification.counts).toEqual({ valid: 6, review: 2, blocked: 0 });
    expect(bach.activities.map((a) => instructionNeedsRewrite(a, null))).toEqual([false, false, false, false, true]);
  });
});

describe("generator v2: the original instruction is canonical", () => {
  it("1 · a short instruction plus executive supports does not multiply text: the original is kept, a requested rewrite is refused", () => {
    const out = assembleBach({
      ...empty,
      segments: [{ decision_id: "dec_3", target: "act_1", rewrite: { lead: "Sigue estos pasos", steps: ["Localiza las ideas principales.", "Redacta el resumen."] }, supports: [{ kind: "checklist", items: ["Mi resumen es único y propio."] }] }],
    });
    expect(codes(out.generation)).toContain("rewrite_not_needed");
    const act1 = allBlocks(out.document).find((b) => b.type === "activity" && b.trace.source_refs.includes("act_1"))!;
    expect(act1.trace.origin).toBe("original");
    expect(act1.type === "activity" && act1.prompt).toBe(bach.activities[0]!.instruction);
    const e = activityExpansion(bach, out.document).find((x) => x.id === "act_1")!;
    expect(e.multiplier).toBeLessThanOrEqual(2);
  });

  it("proportionality is a versioned policy: 30 words (or the profile's limit) decide whether a rewrite is allowed", () => {
    expect(PROPORTION_POLICY.keepInstructionMaxWords).toBe(30);
    expect(instructionNeedsRewrite({ instruction: "a ".repeat(30).trim(), context: null }, null)).toBe(false);
    expect(instructionNeedsRewrite({ instruction: "a ".repeat(31).trim(), context: null }, null)).toBe(true);
    expect(instructionNeedsRewrite({ instruction: "a ".repeat(12).trim(), context: null }, 8)).toBe(true);
    expect(supportBudgetWords(bach.activities[0])).toBe(24);
    expect(supportBudgetWords(bach.activities[4])).toBe(2 * 31);
  });

  it("2 · a rewrite never repeats the prompt inside its steps: repeated steps are dropped; a copy of the original is replaced by the original", () => {
    const act5 = bach.activities[4]!.instruction;
    const copy = assembleBach({
      ...empty,
      segments: [{ decision_id: "dec_7", target: "act_5", rewrite: { lead: "Redacta un texto argumentativo de 150-180 palabras sobre esta cuestión: «¿Deberían las bibliotecas abrir también por la noche durante el verano?»", steps: ["Incluye una tesis,", "al menos dos argumentos y una conclusión."] }, supports: [] }],
    });
    expect(codes(copy.generation)).toContain("rewrite_copies_original");
    expect(allBlocks(copy.document).find((b) => b.type === "activity" && b.trace.source_refs.includes("act_5"))!.trace.origin).toBe("original");
    expect(act5.length).toBeGreaterThan(160); // the lead cap alone already stops "the whole instruction as a lead"
    const dup = assembleBach({
      ...empty,
      segments: [{ decision_id: "dec_7", target: "act_5", rewrite: { lead: "Redacta un texto argumentativo de 150-180 palabras sobre esta cuestión: «¿Deberían las bibliotecas abrir también por la noche durante el verano?»", steps: ["Incluye una tesis, al menos dos argumentos y una conclusión.", "Incluye una tesis, al menos dos argumentos y una conclusión.", "Revisa el texto al terminar."] }, supports: [] }],
    });
    expect(codes(dup.generation)).toContain("duplicate_item_dropped");
    const block = allBlocks(dup.document).find((b) => b.type === "activity" && b.trace.source_refs.includes("act_5"))!;
    expect(block.type === "activity" && block.steps).toEqual(["Incluye una tesis, al menos dos argumentos y una conclusión.", "Revisa el texto al terminar."]);
    expect(dup.audit.expansion.find((e) => e.id === "act_5")!.exactRepeats).toBe(0);
  });

  it("3 · requirements are never regenerated: the field does not exist and the original carries them (a rewrite that drops one falls back)", () => {
    const parsed = DraftGeneratedSegmentsV2Schema.parse({ ...empty, segments: [{ decision_id: "dec_7", target: "act_5", rewrite: { lead: "x y z", steps: ["a b c d", "e f g h"], requirements: ["150-180 palabras"] }, supports: [] }] });
    expect(JSON.stringify(parsed)).not.toContain("requirements");
    const lossy = assembleBach({ ...empty, segments: [{ decision_id: "dec_7", target: "act_5", rewrite: { lead: "Redacta un texto argumentativo sobre las bibliotecas.", steps: ["Escribe una tesis.", "Cierra con una conclusión."] }, supports: [] }] });
    expect(codes(lossy.generation)).toContain("rewrite_lost_requirements");
    expect(activityText(lossy.document, "act_5")).toContain("150-180 palabras");
    expect(activityText(lossy.document, "act_5")).toContain("«¿Deberían las bibliotecas abrir también por la noche durante el verano?»");
  });

  it("8/9 · two arguments and the length survive a faithful rewrite and are guaranteed by the fallback when a rewrite loses them", () => {
    const faithful = assembleBach({
      ...empty,
      segments: [{ decision_id: "dec_7", target: "act_5", rewrite: { lead: "Redacta un texto argumentativo de 150-180 palabras sobre esta cuestión: «¿Deberían las bibliotecas abrir también por la noche durante el verano?»", steps: ["Escribe una tesis.", "Da al menos dos argumentos.", "Cierra con una conclusión."] }, supports: [] }],
    });
    expect(codes(faithful.generation)).not.toContain("rewrite_lost_requirements");
    const faithfulText = activityText(faithful.document, "act_5");
    expect(faithfulText).toContain("150-180 palabras");
    expect(faithfulText).toContain("al menos dos argumentos");
    const lost = assembleBach({ ...empty, segments: [{ decision_id: "dec_7", target: "act_5", rewrite: { lead: "Redacta un texto de 150-180 palabras sobre esta cuestión: «¿Deberían las bibliotecas abrir también por la noche durante el verano?»", steps: ["Escribe una tesis.", "Cierra con una conclusión."] }, supports: [] }] });
    expect(codes(lost.generation)).toContain("rewrite_lost_requirements");
    expect(activityText(lost.document, "act_5")).toContain("al menos dos argumentos");
    expect(checkOf(lost.review, "constraints_preserved").status).toBe("PASS");
  });
});

describe("generator v2: one function per piece, exact repeats dropped, near repeats reported", () => {
  it("4 · a checklist that only replicates the instruction is dropped; one that verifies the result is kept", () => {
    const out = assembleBach({
      ...empty,
      segments: [
        { decision_id: "dec_3", target: "act_1", supports: [{ kind: "checklist", items: ["sin copiar frases completas", "Resume el texto en 60-80 palabras, sin copiar frases completas."] }] },
        { decision_id: "dec_6", target: "act_4", supports: [{ kind: "checklist", items: ["He indicado un registro y lo he justificado."] }] },
      ],
    });
    expect(codes(out.generation)).toEqual(expect.arrayContaining(["redundant_support_dropped"]));
    expect(out.generation.generated).toEqual(["dec_6"]);
    expect(allBlocks(out.document).some((b) => b.type === "checklist" && b.trace.decision_ids.includes("dec_6"))).toBe(true);
  });

  it("5 · a planner label that restates the statement is reported; structural labels are not", () => {
    const restating = assembleBach({ ...empty, segments: [{ decision_id: "dec_7", target: "act_5", supports: [{ kind: "planner", slots: [{ label: "Escribe un texto de 150-180 palabras", lines: 2 }] }] }] });
    expect(codes(restating.generation)).toContain("planner_label_restates");
    const structural = assembleBach({ ...empty, segments: [{ decision_id: "dec_7", target: "act_5", supports: [{ kind: "planner", slots: [{ label: "Tesis", lines: 2 }, { label: "Argumento 1", lines: 3 }, { label: "Argumento 2", lines: 3 }, { label: "Conclusión", lines: 2 }] }] }] });
    expect(codes(structural.generation)).not.toContain("planner_label_restates");
  });

  it("6 · a reminder that only repeats a condition is dropped, and the model is told to decline it in `skipped` (declining is a structured answer, not an omission)", () => {
    const repeated = assembleBach({ ...empty, segments: [{ decision_id: "dec_4", target: "act_2", supports: [{ kind: "reminder", text: "Formula con tus palabras la tesis principal del texto" }] }] });
    expect(codes(repeated.generation)).toContain("redundant_support_dropped");
    expect(repeated.generation.generated).not.toContain("dec_4");
    const declined = assembleBach({ ...empty, segments: [], skipped: [{ decision_id: "dec_4", support: "reminder", reason: "already_visible" }] });
    expect(declined.generation.declined).toEqual(["dec_4"]);
    expect(declined.generation.ignored).not.toContain("dec_4");
    expect(MATERIAL_GENERATOR_V2.system).toMatch(/devuélvelos en "skipped" con "already_visible" o "no_new_function"/);
  });

  it("near repeats are only REPORTED (fidelity over brevity): the support stays", () => {
    const out = assembleBach({ ...empty, segments: [{ decision_id: "dec_6", target: "act_4", supports: [{ kind: "checklist", items: ["Justifico la respuesta con dos rasgos lingüísticos del texto observado."] }] }] });
    expect(codes(out.generation)).toContain("near_duplicate");
    expect(out.generation.generated).toEqual(["dec_6"]);
  });

  it("a support the decision does not authorise, or repeated in the same decision, is dropped; self_check authorises a checklist", () => {
    const out = assembleBach({ ...empty, segments: [{ decision_id: "dec_6", target: "act_4", supports: [{ kind: "planner", slots: [{ label: "Idea", lines: 2 }] }, { kind: "checklist", items: ["He nombrado el registro."] }, { kind: "checklist", items: ["Otra comprobación distinta."] }] }] });
    expect(codes(out.generation).filter((c) => c === "unauthorized_support")).toHaveLength(2);
    expect(allBlocks(out.document).filter((b) => b.trace.decision_ids.includes("dec_6")).map((b) => b.type)).toEqual(["checklist"]);
    const selfCheck = reviewPlan(bachRaw, { ...bachReviewFor(bachRaw), entries: bachReviewFor(bachRaw).entries.map((e) => (e.decision_id === "dec_6" ? { ...e, action: "edited" as const, edits: { supports: [{ kind: "self_check" as const, uses_task_data: false }] } } : e)) }, bach, bachContext);
    expect(v2(selfCheck)({ ...empty, segments: [{ decision_id: "dec_6", target: "act_4", supports: [{ kind: "checklist", items: ["He nombrado el registro."] }] }] }).generation.generated).toEqual(["dec_6"]);
  });

  it("supports over the word budget are reported (not trimmed: cutting a support could change what it asks)", () => {
    const long = Array.from({ length: 4 }, (_, i) => `Compruebo el punto número ${i} de mi propio trabajo con calma`);
    const out = assembleBach({ ...empty, segments: [{ decision_id: "dec_3", target: "act_1", supports: [{ kind: "checklist", items: long }] }] });
    expect(codes(out.generation)).toContain("support_over_budget");
    expect(out.generation.generated).toEqual(["dec_3"]);
  });
});

describe("generator v2: nothing essential is lost, nothing is revealed, nothing outside the decisions changes", () => {
  const clean = assembleBach(mockGenerateDraftV2(bach, bachReviewed, bachContext));

  it("7 · protected essential elements stay visible in a full v2 run", () => {
    expect(clean.review.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(checkOf(clean.review, "protected_elements_preserved").status).toBe("PASS");
    expect(checkOf(clean.review, "constraints_preserved").status).toBe("PASS");
    expect(clean.audit.ok).toBe(true);
  });

  it("10 · the inferred answer never appears (numeric or textual) and the answer key stays empty", () => {
    const text = allBlocks(clean.document).map(studentText).join("\n").toLowerCase();
    for (const term of ["oposición", "contraste", "adversativa"]) expect(text).not.toContain(term);
    expect(clean.document.answer_key).toEqual([]);
    const geoOut = v2(geoReviewed, geo, geoContext)(mockGenerateDraftV2(geo, geoReviewed, geoContext));
    const geoText = allBlocks(geoOut.document).map(studentText).join("\n");
    for (const fragment of ["6.700", "21,5", "4 puntos porcentuales"]) expect(geoText).not.toContain(fragment);
    expect(checkOf(geoOut.review, "answers_not_leaked").status).toBe("PASS");
  });

  it("12 · what has no effective decision is copied identically (activity 3 and the source text), and rejected decisions leave nothing", () => {
    expect(clean.audit.checks.find((c) => c.name.startsWith("lo que no tiene decisión efectiva"))?.ok).toBe(true);
    const act3 = allBlocks(clean.document).find((b) => b.type === "activity" && b.trace.source_refs.includes("act_3"))!;
    expect(act3.trace.origin).toBe("original");
    expect(act3.type === "activity" && act3.prompt).toBe(bach.activities[2]!.instruction);
    const reading = allBlocks(clean.document).find((b) => b.type === "reading_text")!;
    expect(reading.type === "reading_text" && reading.literal && reading.paragraphs.join("\n\n")).toBe(bach.texts[0]!.text);
    expect(allBlocks(clean.document).some((b) => b.trace.decision_ids.some((id) => ["dec_1", "dec_5", "dec_8"].includes(id)))).toBe(false);
  });

  it("a supports-only segment for a decision that `segments` no longer erases the activity (assembler regression found by the A/B)", () => {
    const out = assembleBach({ ...empty, segments: [{ decision_id: "dec_6", target: "act_4", supports: [{ kind: "checklist", items: ["He nombrado el registro."] }] }] });
    expect(allBlocks(out.document).filter((b) => b.type === "activity")).toHaveLength(5);
    expect(checkOf(out.review, "traceability_complete").status).not.toBe("FAIL");
  });

  it("a leak in a v2 support is still caught: numeric answers FAIL and block", () => {
    const leaky = v2(geoReviewed, geo, geoContext)({ ...empty, segments: [{ decision_id: "dec_6", target: "act_4", supports: [{ kind: "planner", slots: [{ label: "Crecimiento: 6.700 habitantes", lines: 1 }] }] }] });
    expect(checkOf(leaky.review, "answers_not_leaked").status).toBe("FAIL");
    expect(leaky.review.verdict).toBe("blocked");
  });
});

describe("a textual inferred answer is never a false PASS", () => {
  const doc = (analysis = bach, reviewed = bachReviewed, context = bachContext) => {
    const generation = normalizeGeneratedV2(DraftGeneratedSegmentsV2Schema.parse({ ...empty, segments: [] }), reviewed, analysis, context);
    const document = buildDocument({ analysis, plan: reviewed.effective, context, generated: generation.segments, newBlockId: sequentialIds() });
    return { document, input: { analysis, plan: reviewed.effective, context, document } };
  };

  it("11 · cannot be excluded by matching → WARN that asks for a semantic review, not PASS and not FAIL", () => {
    const { input, document } = doc();
    const check = checkOf(buildReview(input), "answers_not_leaked");
    expect(check).toMatchObject({ status: "WARN", needs_semantic_review: true, targets: ["act_3"] });
    expect(check.detail).toMatch(/requiere revisión semántica/);
    expect(buildReview(input).verdict).toBe("approved_with_warnings");
    expect(document.answer_key).toEqual([]);
  });

  it("it is general: any textual answer behaves the same, with no keyword about any particular answer", () => {
    const other = structuredClone(bach);
    other.activities[2]!.expected_answer = { basis: "inferred", value: "Un resultado que nadie debería escribir aquí, sea cual sea." };
    const { input } = doc(other);
    expect(checkOf(buildReview(input), "answers_not_leaked")).toMatchObject({ status: "WARN", needs_semantic_review: true });
    const source = readFileSync(path.resolve(import.meta.dirname, "../../src/lib/adaptation/review-checks.ts"), "utf8");
    for (const term of ["oposici", "contraste", "adversativ"]) expect(source.toLowerCase()).not.toContain(term);
  });

  it("numbers decide mechanically only when the answer carries numbers the material does not print", () => {
    const numbers = materialNumbers(bach);
    expect(isMechanicallyVerifiable("Una relación de oposición o contraste", numbers)).toBe(false);
    expect(isMechanicallyVerifiable("6.700 habitantes", materialNumbers(geo))).toBe(true);
    expect(isMechanicallyVerifiable("Entre 2010 y 2025", materialNumbers(geo))).toBe(false);
    expect(checkOf(buildReview(doc(geo, geoReviewed, geoContext).input), "answers_not_leaked").status).toBe("PASS");
  });

  it("a literal leak of a short textual answer is still a FAIL; the reviewer can close an open question with a PASS but never soften a finding", () => {
    const short = structuredClone(bach);
    short.activities[2]!.expected_answer = { basis: "inferred", value: "Una oposición clara" };
    const generated = { segments: [{ target: "act_4", decision_ids: ["dec_6"], blocks: [{ id: "x", type: "help_box" as const, variant: "tip" as const, text: "Piensa en una oposición clara.", trace: { origin: "support" as const, source_refs: ["act_4"], decision_ids: ["dec_6"] } }], new_item_answers: [] }], change_summary: ["x"] };
    const document = buildDocument({ analysis: short, plan: bachReviewed.effective, context: bachContext, generated, newBlockId: sequentialIds() });
    expect(checkOf(buildReview({ analysis: short, plan: bachReviewed.effective, context: bachContext, document }), "answers_not_leaked").status).toBe("FAIL");

    const { input } = doc();
    const checks = deterministicChecks(input);
    const resolved = mergeAiChecks(checks, { checks: [{ check: "answers_not_leaked", status: "PASS", targets: [], detail: "Sin fuga semántica" }] });
    expect(checkOf({ checks: resolved }, "answers_not_leaked")).toMatchObject({ status: "PASS", method: "ai" });
    expect(verdictOf(resolved.filter((c) => c.check === "answers_not_leaked"))).toBe("approved");
    expect(verdictOf(checks.filter((c) => c.check === "answers_not_leaked"))).toBe("approved_with_warnings");
    const found = mergeAiChecks(checks, { checks: [{ check: "answers_not_leaked", status: "FAIL", targets: [], detail: "Insinúa la respuesta" }] });
    expect(checkOf({ checks: found }, "answers_not_leaked").status).toBe("FAIL");
    const leaky = deterministicChecks({ analysis: short, plan: bachReviewed.effective, context: bachContext, document });
    expect(checkOf({ checks: mergeAiChecks(leaky, { checks: [{ check: "answers_not_leaked", status: "PASS", targets: [], detail: "ok" }] }) }, "answers_not_leaked").status).toBe("FAIL");
  });
});

describe("context policy: needs fully resolved by presentation stop reaching the planner, without breaking history", () => {
  const golden = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "adaptation-context.golden.json"), "utf8")) as Record<string, string>;
  const input = (analysis = geo, profile = EXECUTIVE_EXPERIMENT_PROFILE) => ({ profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" as const });

  it("15 · policy 1 (the default) reproduces every historical context, byte for byte: golden fingerprints and the frozen real runs", () => {
    for (const s of SCENARIOS) {
      const ctx = buildAdaptationContext({ profile: s.profile, education: { stage: null, grade: null, subject: null }, analysis: s.analysis(), adaptationType: s.adaptationType }).context;
      expect(contextFingerprint(ctx), s.id).toBe(golden[`scenario:${s.id}`]);
      expect("policy_version" in ctx).toBe(false);
    }
    for (const [name, a] of [["mobility", geo], ["argumentation", argumentationAnalysis()], ["fractions", fractionsAnalysis()]] as const) expect(contextFingerprint(buildAdaptationContext(input(a)).context), name).toBe(golden[`executive:${name}`]);
    expect(buildAdaptationContext({ ...input(), policy: 1 }).context).toEqual(buildAdaptationContext(input()).context);
    // The structure of the real worksheets: the fixtures' contexts are the ones the real planner saw.
    expect(contextFingerprint(geoContext)).toBe(evidence("planner-v1-geografia.json").run.context_fingerprint);
    expect(contextFingerprint(bachContext)).toBe(evidence("planner-v1-bachillerato.json").run.context_fingerprint);
  });

  it("16 · under policy 2, number_of_visible_tasks (resolved by max_tasks_per_page) is not a need again, and it is recorded why", () => {
    const old = buildAdaptationContext(input());
    const next = buildAdaptationContext({ ...input(), policy: 2 });
    expect(old.context.needs.map((n) => n.dimension)).toContain("number_of_visible_tasks");
    expect(next.context.needs.map((n) => n.dimension)).not.toContain("number_of_visible_tasks");
    expect(next.omitted).toContainEqual({ dimension: "number_of_visible_tasks", reason: "resolved_by_presentation" });
    expect(next.context.presentation.max_tasks_per_page).toBe(3);
    expect(next.context.policy_version).toBe(2);
    expect(contextFingerprint(next.context)).not.toBe(contextFingerprint(old.context));
    expect(next.context.needs).toHaveLength(old.context.needs.length - 1);
    // Deterministic too.
    expect(buildAdaptationContext({ ...input(), policy: 2 }).context).toEqual(next.context);
  });

  it("a decision that cites a need the policy removed is blocked under policy 2 and still allowed under policy 1 (the plan validates against its own context)", () => {
    const d = decision({ target: "document", action: "reorganize", strategies: ["spatial_organization"], dimensions: ["number_of_visible_tasks"] });
    const ctx2 = buildAdaptationContext({ ...input(), policy: 2 }).context;
    expect(validatePlan(planOf(geo, ctx2, [d]), geo, ctx2).issues.map((i) => i.flag)).toContain("unjustified_change");
    expect(validatePlan(planOf(geo, geoContext, [d]), geo, geoContext).valid).toBe(true);
  });

  it("only what presentation fully resolves is removed: decoration needs go only with decoration 'none', and nothing without a setting", () => {
    const decoration = (level: "low" | "medium") => ({ ...EXECUTIVE_EXPERIMENT_PROFILE, supports: { ...EXECUTIVE_EXPERIMENT_PROFILE.supports, unnecessary_decoration: level } });
    const full = buildAdaptationContext({ ...input(geo, decoration("medium")), policy: 2 });
    expect(full.context.presentation.decoration).toBe("none");
    expect(full.omitted).toContainEqual({ dimension: "unnecessary_decoration", reason: "resolved_by_presentation" });
    const partial = buildAdaptationContext({ ...input(geo, decoration("low")), policy: 2 });
    expect(partial.context.presentation.decoration).toBe("reduced");
    expect(partial.context.needs.map((n) => n.dimension)).toContain("unnecessary_decoration");
    const noLimit = { ...EXECUTIVE_EXPERIMENT_PROFILE, supports: { instruction_chunking: "high" as const } };
    expect(buildAdaptationContext({ ...input(geo, noLimit), policy: 2 }).context.needs.map((n) => n.dimension)).toEqual(["instruction_chunking"]);
  });

  it("the policy is part of the contract's history: absent means 1, only 2 is ever written", () => {
    const parsed = buildAdaptationContext({ ...input(), policy: 2 }).context;
    expect(parsed.context_version).toBe(1);
    expect(parsed.policy_version).toBe(2);
  });
});

describe("source order of the assembled document", () => {
  const order = (analysis = bach) => {
    const doc = buildDocument({ analysis, plan: { ...bachReviewed.effective, decisions: [] }, context: bachContext, generated: null, newBlockId: sequentialIds() });
    return doc.pages.map((p) => p.blocks.filter((b) => b.trace.origin === "original").map((b) => b.trace.source_refs[0]));
  };

  it("17 · uses page, section, kind and id (never text): activity 4 comes before the fragments of activity 5's statement", () => {
    expect(order()).toEqual([["ctt_1", "ctt_2", "act_1", "act_2", "act_3"], ["act_4", "ctt_3", "ctt_4", "act_5"]]);
  });

  it("items without a section come first on their page; the limit inside one section (kind order) is explicit", () => {
    const loose = structuredClone(bach);
    loose.texts[2]!.section_id = null;
    expect(order(loose)[1]).toEqual(["ctt_3", "act_4", "ctt_4", "act_5"]);
    const text = readFileSync(path.resolve(import.meta.dirname, "../../src/lib/adaptation/document.ts"), "utf8");
    expect(text).toMatch(/analysis does[\s*]+not record the order BETWEEN kinds inside one section/);
  });
});

describe("generator v1 stays frozen and v2 is a new, versioned contract", () => {
  it("14 · v1's prompt and draft schema are exactly what produced the real evidence (Geografía and Bachillerato)", () => {
    for (const name of ["generator-v1-geografia.json", "generator-v1-bachillerato.json"]) {
      const e = evidence(name);
      expect(sha(MATERIAL_GENERATOR_V1.system), name).toBe(e.generator.prompt_sha256);
      expect(sha(stableStringify(z.toJSONSchema(DraftGeneratedSegmentsSchema, { io: "input" }))), name).toBe(e.generator.schema.draft_schema_fingerprint);
    }
    expect(MATERIAL_GENERATOR_V1).toMatchObject({ version: 1, schemaVersion: 1 });
    expect(getMaterialGenerator(1)).toBe(MATERIAL_GENERATOR_V1);
  });

  it("v2 is registered next to it with its own version and schema version, and is NOT the active one until validated", () => {
    expect(getMaterialGenerator(2)).toBe(MATERIAL_GENERATOR_V2);
    expect(MATERIAL_GENERATOR_V2).toMatchObject({ key: "material_generator", version: 2, schemaVersion: 2, output: { name: "generated_segments", delivery: "prompted" } });
    expect(ACTIVE_ADAPTATION_PROMPT_VERSIONS.material_generator).toBe(1);
    expect(getMaterialGenerator()).toBe(MATERIAL_GENERATOR_V1);
    expect(() => getMaterialGenerator(3)).toThrow(/material_generator@v3/);
  });

  it("pins the published v2 text: a change must be a new version, never an edit", () => {
    expect(sha(MATERIAL_GENERATOR_V2.system)).toBe("2fd7367e8f6a2e36eab487978b27a5e07557bcb4085b1693c63abdfdba0ac185");
  });

  it("13 · a historical v1 plan and a v1 draft are still interpreted with v1's rules, and no draft is read with another version's", () => {
    // The plan of the real Geografía experiment (v1 planner) goes through the v2 generator pipeline unchanged.
    expect(geoReviewed.raw.schema_version).toBe(1);
    expect(MOBILITY_PLAN_DRAFT.decisions).toHaveLength(8);
    const v1Draft = mockGenerateDraft(geo, geoReviewed);
    expect(normalizeGeneration(1, v1Draft, geoReviewed, geo, geoContext).version).toBe(1);
    expect(() => normalizeGeneration(2, v1Draft, geoReviewed, geo, geoContext)).toThrow();
    const v2Draft = mockGenerateDraftV2(geo, geoReviewed, geoContext);
    expect(normalizeGeneration(2, v2Draft, geoReviewed, geo, geoContext).version).toBe(2);
    expect(() => normalizeGeneration(1, v2Draft, geoReviewed, geo, geoContext)).toThrow();
  });

  it("the v2 contract is lean: no prompt, requirements, ids, trace, answer areas, resources or HTML to write", () => {
    const schema = JSON.stringify(z.toJSONSchema(DraftGeneratedSegmentsV2Schema, { io: "input" }));
    for (const property of ["prompt", "requirements", "id", "trace", "response", "resource_block_ids", "answer", "html", "css", "color"]) expect(schema, property).not.toContain(`"${property}":{`);
  });

  it("the v2 prompt makes the canonical-source rule explicit, forbids answers and has no diagnosis, label or vendor", () => {
    const system = MATERIAL_GENERATOR_V2.system;
    expect(system).toMatch(/El sistema conserva el contenido original/);
    expect(system).toMatch(/Cada dato o condición debe verse una sola vez/);
    expect(system).toMatch(/Si "instruction_policy" es "keep", no escribas "rewrite"/);
    expect(system).toMatch(/no escribas ninguna solución, resultado de cálculo, tesis, argumento, conclusión, interpretación de un gráfico ni respuesta parcial, en ningún bloque/);
    expect(system).toMatch(/no improvises otra adaptación/);
    expect(system).not.toMatch(/claude|anthropic|openai|gpt|sonnet|haiku|opus|tdah|autis|dislex|diagn/i);
  });
});

describe("v2 request: what the model receives", () => {
  const input = buildGeneratorInputV2(bachReviewed, bach, bachContext);
  const text = generatorRequestParts({ analysis: bach, context: bachContext, reviewed: bachReviewed, version: 2 }).parts.map((p) => (p.type === "text" ? p.text : "")).join("");

  it("carries the policy and the budget per decision, never the rejected ones, the profile or any inferred answer", () => {
    expect(input.approved.decisions.map((d) => [d.id, d.instruction_policy])).toEqual([["dec_2", null], ["dec_3", "keep"], ["dec_4", "keep"], ["dec_6", "keep"], ["dec_7", "rewrite"]]);
    expect(input.approved.decisions.find((d) => d.id === "dec_3")).toMatchObject({ original_words: 10, support_budget_words: 24, supports: ["step_list", "checklist"] });
    for (const rejected of ["dec_1", "dec_5", "dec_8"]) expect(text).not.toContain(rejected);
    expect(text).not.toContain("Una relación de oposición");
    expect(text).not.toContain('"supports":{');
    expect(text).not.toContain("answer_area");
  });

  it("is smaller than v1's input for the same plan (no strategies, dimensions, answer areas or resources)", () => {
    const v1 = generatorRequestParts({ analysis: bach, context: bachContext, reviewed: bachReviewed, version: 1 }).parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    expect(text.length).toBeLessThan(v1.length);
  });
});

describe("v2 through the real call path with a scripted provider", () => {
  const selection = resolveModel("STANDARD", {});
  const respond = (body: unknown, stopReason: StructuredResponse["stopReason"] = "complete"): StructuredResponse => ({ text: JSON.stringify(body), stopReason, usage: { inputTokens: 2800, outputTokens: 900, cachedInputTokens: 0, cacheCreationInputTokens: 3300 }, provider: "anthropic", model: "claude-sonnet-5-5", latencyMs: 7000 });
  const scripted = (...responses: StructuredResponse[]) => {
    const requests: StructuredRequest[] = [];
    const provider: AIProvider = { name: "anthropic", async generateStructured(request) { requests.push(request); return responses[Math.min(requests.length - 1, responses.length - 1)]!; } };
    return { provider, requests };
  };
  const draft = () => mockGenerateDraftV2(bach, bachReviewed, bachContext);

  it("one request with the v2 prompt and contract; the run is recorded with version 2", async () => {
    const { provider, requests } = scripted(respond(draft()));
    const { response, run } = await callGenerator({ analysis: bach, context: bachContext, reviewed: bachReviewed, selection, provider, maxOutputTokens: 3000, version: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ system: MATERIAL_GENERATOR_V2.system, output: { name: "generated_segments", delivery: "prompted" } });
    expect(requests[0]!.output.schema).toBe(DraftGeneratedSegmentsV2Schema);
    expect(parseGeneratorResponse(response, 2).outcome).toBe("ok");
    expect(parseGeneratorResponse(response, 1).outcome).toBe("schema");
    expect(run).toMatchObject({ promptKey: "material_generator", promptVersion: 2, schemaKey: "generated_segments", schemaVersion: 2, callKind: "initial" });
  });

  it("a truncated v2 answer throws and never triggers a second call", async () => {
    const { provider, requests } = scripted(respond({}, "max_tokens"), respond(draft()));
    await expect(createModelGenerator({ selection, provider, maxOutputTokens: 3000, version: 2 }).generate({ context: bachContext, analysis: bach, reviewed: bachReviewed })).rejects.toMatchObject({ code: "truncated" });
    expect(requests).toHaveLength(1);
  });

  it("works end to end through the pipeline with the review applied and the v2 normaliser chosen by version", async () => {
    const { provider } = scripted(respond(draft()));
    const result = await runAdaptation(
      { profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis: bach, adaptationType: "accessibility" },
      { planner: { plan: async () => ({ draft: BACH_PLAN_DRAFT, runs: [] }) }, generator: createModelGenerator({ selection, provider, maxOutputTokens: 3000, version: 2 }), reviewer: null, newBlockId: sequentialIds(), generatorVersion: 2, humanReview: bachReviewFor },
    );
    expect(result.generation.version).toBe(2);
    expect(result.reviewed.effective.decisions.map((d) => d.id)).toEqual(["dec_2", "dec_3", "dec_4", "dec_6", "dec_7"]);
    expect(result.review.checks.filter((c) => c.status === "FAIL")).toEqual([]);
  });
});

describe("offline A/B of v1 vs v2 (mocks follow each contract: this compares the pipeline, not a model)", () => {
  it("on the three worksheets v2 shows fewer visible words per transformed activity, no literal repeats, and the same safety", async () => {
    for (const m of AB_MATERIALS) {
      const [a, b] = [await runAb(m, 1), await runAb(m, 2)];
      expect(b.words.final, m.id).toBeLessThanOrEqual(a.words.final);
      expect(b.exactRepeats, m.id).toBe(0);
      for (const r of [a, b]) {
        expect(r.protectedOk, `${m.id} v${r.version}`).toBe(true);
        expect(r.leakFails).toBe(0);
        expect(r.nonEffective).toBe(0);
        expect(r.auditOk, `${m.id} v${r.version}`).toBe(true);
      }
    }
  });

  it("expansion bands are report-only helpers and the helpers detect exact and near repeats", () => {
    expect([1.2, 1.8, 2.5, 3.5].map(expansionBand)).toEqual(["baja", "moderada", "alta", "muy alta"]);
    const blocks = [
      { id: "blk_1", type: "paragraph" as const, text: "Resume el texto en 70-90 palabras sin copiar", trace: { origin: "original" as const, source_refs: ["act_1"], decision_ids: [] } },
      { id: "blk_2", type: "paragraph" as const, text: "Resume el texto en 70-90 palabras sin copiar", trace: { origin: "support" as const, source_refs: ["act_1"], decision_ids: [] } },
      { id: "blk_3", type: "paragraph" as const, text: "Resume el texto en 70-90 palabras sin copiar frases", trace: { origin: "support" as const, source_refs: ["act_1"], decision_ids: [] } },
    ];
    const repeats = repeatsAmong(blocks);
    expect(repeats.filter((r) => r.exact)).toHaveLength(1);
    expect(repeats.filter((r) => !r.exact)).toHaveLength(2);
    expect(fractionsAnalysis().activities.length).toBe(5);
  });
});
