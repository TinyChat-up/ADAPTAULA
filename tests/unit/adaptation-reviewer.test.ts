import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PEDAGOGICAL_REVIEWER_V1 } from "@prompts/pedagogical-reviewer/v1";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { sequentialIds } from "@/lib/adaptation/document";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { createMockGenerator, createMockPlanner } from "@/lib/adaptation/mock";
import { runAdaptation } from "@/lib/adaptation/pipeline";
import { assembleReview, checkOf, deterministicChecks, verdictOf } from "@/lib/adaptation/review";
import { buildPedagogicalReviewContext, reviewScope } from "@/lib/adaptation/review-context";
import { buildReviewScoped, createModelReviewer, findingsToDraft, mergeReviewerFindings, parseReviewerResponse, reviewerRequestParts } from "@/lib/adaptation/reviewer";
import { ACTIVE_ADAPTATION_PROMPT_VERSIONS, getPedagogicalReviewer } from "@/lib/ai/prompts";
import { resolveModel } from "@/lib/ai/registry";
import type { AIProvider, StructuredResponse } from "@/lib/ai/types";
import { AI_REVIEW_CHECKS, CHECK_METHODS, type AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { ReviewerFindingsSchema } from "@/lib/schemas/reviewer-findings";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks } from "@/lib/schemas/material-document";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE, buildExperimentContext, scanForbidden } from "../../evals/adaptation/planner-lib";
import { primariaAnalysis, primariaScenario } from "../../evals/adaptation/reviewer-fixtures";
import { mutate } from "./adaptation-helpers";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const frac: MaterialAnalysis = primariaAnalysis();
const ctx = buildExperimentContext(frac, "accessibility", 2);
const scenario = (analysis: MaterialAnalysis = frac, context = ctx) => primariaScenario(analysis, context);
const s = scenario();
const semantic = s.base.find((c) => c.check === "answers_not_leaked")!;
const blockIds = allBlocks(s.document).filter((b) => b.trace.origin === "support").map((b) => b.id);
const find = (check: AiReviewDraft["checks"][number]["check"], status: "PASS" | "WARN" | "FAIL", targets: string[] = [], detail = "ok"): AiReviewDraft["checks"][number] => ({ check, status, targets, detail });
const allPass = (targets = semantic.targets): AiReviewDraft => ({ checks: [find("answers_not_leaked", "PASS", targets), find("age_appropriate", "PASS"), find("no_infantilization", "PASS"), find("functional_supports_applied", "PASS", blockIds)] });
const merge = (ai: AiReviewDraft, scenarioX = s) => buildReviewScoped(scenarioX.input, ai, scenarioX.ids);

describe("authority: what the AI can and cannot change", () => {
  it("1 · a deterministic FAIL cannot be softened, by a PASS finding or by a finding on the failed check", () => {
    const broken = mutate(s.document, (b) => b.type === "activity" && b.trace.source_refs.includes("act_4"), () => null);
    const input = { ...s.input, document: broken };
    const base = deterministicChecks(input);
    expect(base.filter((c) => c.status === "FAIL").length).toBeGreaterThan(0);
    const out = buildReviewScoped(input, allPass(), s.ids);
    for (const failed of base.filter((c) => c.status === "FAIL")) expect(checkOf(out.review, failed.check).status).toBe("FAIL");
    expect(out.review.verdict).not.toBe("approved");
    const attempt = mergeReviewerFindings(base, { checks: [find("traceability_complete", "PASS"), find("instructions_complete", "PASS")] }, reviewScope(base, input, s.ids));
    expect(attempt.rejected.map((r) => r.reason)).toEqual(["deterministic_check", "deterministic_check"]);
  });

  it("2 · a structural WARN (a decision still pending, a need without a decision) is never closed by the AI: its judgment is added next to it", () => {
    const out = merge(allPass());
    expect(checkOf(out.review, "functional_supports_applied").status).toBe("WARN");
    expect(out.review.checks.filter((c) => c.check === "functional_supports_applied").map((c) => `${c.method}:${c.status}`)).toEqual(["deterministic:WARN", "ai:PASS"]);
    expect(out.review.verdict).toBe("approved_with_warnings");
  });

  it("3 · an open SEMANTIC question is resolved by findings that cover every required target", () => {
    expect(semantic).toMatchObject({ status: "WARN", needs_semantic_review: true });
    const out = merge(allPass());
    expect(checkOf(out.review, "answers_not_leaked")).toMatchObject({ status: "PASS", method: "ai" });
    expect(out.review.checks.filter((c) => c.check === "answers_not_leaked" && c.status === "WARN")).toEqual([]);
  });

  it("4 · a required judgment that never came is not a PASS: it stays open as a WARN, and nothing is invented for the missing checks", () => {
    const empty = merge({ checks: [] });
    expect(checkOf(empty.review, "answers_not_leaked").status).toBe("WARN");
    expect(checkOf(empty.review, "age_appropriate").status).toBe("WARN");
    expect(empty.pending).toEqual(expect.arrayContaining(["answers_not_leaked", "age_appropriate", "functional_supports_applied", "no_infantilization"]));
    expect(empty.review.verdict).not.toBe("approved");
    const partial = merge({ checks: [find("answers_not_leaked", "PASS", semantic.targets.slice(0, 1)), find("age_appropriate", "PASS"), find("no_infantilization", "PASS"), find("functional_supports_applied", "PASS", blockIds)] });
    if (semantic.targets.length > 1) expect(checkOf(partial.review, "answers_not_leaked").status).toBe("WARN");
    expect(merge({ ...allPass(), checks: allPass().checks.filter((c) => c.check !== "age_appropriate") }).review.checks.find((c) => c.check === "age_appropriate")).toMatchObject({ status: "WARN", needs_semantic_review: true });
  });

  it("14 · a finding on a target outside the scope is rejected and recorded, and cannot close anything", () => {
    for (const bad of ["act_99", "blk_zzzz9999", "dec_77"]) {
      const out = merge({ checks: [find("answers_not_leaked", "PASS", [bad, ...semantic.targets]), find("age_appropriate", "PASS"), find("no_infantilization", "PASS"), find("functional_supports_applied", "PASS", blockIds)] });
      expect(out.rejected).toEqual([{ check: "answers_not_leaked", targets: [bad, ...semantic.targets], reason: "target_out_of_scope" }]);
      expect(checkOf(out.review, "answers_not_leaked").status).toBe("WARN");
    }
  });

  it("19 · the deferred decision keeps traceability_complete at WARN whatever the reviewer says", () => {
    expect(checkOf(assembleReview(s.input, s.base), "traceability_complete")).toMatchObject({ status: "WARN", method: "deterministic" });
    const out = merge(allPass());
    expect(checkOf(out.review, "traceability_complete")).toMatchObject({ status: "WARN", method: "deterministic" });
    expect(s.review.decisions.find((d) => d.id === "dec_3")).toMatchObject({ outcome: "deferred_to_renderer", route: "deferred_to_renderer" });
    expect(verdictOf(out.review.checks)).toBe("approved_with_warnings");
  });
});

describe("judgments the reviewer exists for", () => {
  const withBlock = (text: string) => {
    const document = mutate(s.document, (b) => b.id === blockIds[1], (b) => (b.type === "checklist" ? { ...b, items: [text] } : b));
    return { ...s, document, input: { ...s.input, document } };
  };

  it("5 · an inferred answer shown literally is a FAIL that blocks the document", () => {
    const leaky = withBlock("Recuerda: 1/4, 1/2, 3/4.");
    const ref = buildPedagogicalReviewContext(leaky.input, leaky.reviewed);
    expect(ref.document.blocks.some((b) => b.text.includes("1/4, 1/2, 3/4"))).toBe(true);
    expect(ref.internal_reference_only.some((r) => r.inferred_answer.includes("1/4, 1/2, 3/4"))).toBe(true);
    const out = merge({ checks: [find("answers_not_leaked", "FAIL", [blockIds[1]!], "Muestra la respuesta de la actividad 4"), ...allPass().checks.slice(1)] }, leaky);
    expect(checkOf(out.review, "answers_not_leaked").status).toBe("FAIL");
    expect(out.review.verdict).toBe("blocked");
    expect(out.review.blocks_to_revise).toContain(blockIds[1]);
  });

  it("6 · a paraphrased or implied answer (no substring in common) is a FAIL the same way: the semantic path does not depend on matching", () => {
    const paraphrase = withBlock("Empieza por la fracción más pequeña y termina por la más grande.");
    const base = deterministicChecks(paraphrase.input);
    expect(checkOf({ checks: base }, "answers_not_leaked")).toMatchObject({ status: "WARN", needs_semantic_review: true });
    const out = merge({ checks: [find("answers_not_leaked", "FAIL", [blockIds[1]!], "Parafrasea el orden pedido"), ...allPass().checks.slice(1)] }, paraphrase);
    expect(out.review.verdict).toBe("blocked");
  });

  it("7 · a safe support with no answer in it passes", () => {
    const out = merge(allPass());
    expect(checkOf(out.review, "answers_not_leaked").status).toBe("PASS");
    expect(out.rejected).toEqual([]);
  });

  it("8 · an indirect hint that makes the reasoning trivial is a WARN or a FAIL on the support that carries it", () => {
    const warn = merge({ checks: [find("answers_not_leaked", "WARN", [blockIds[1]!], "Orienta casi hacia el resultado"), ...allPass().checks] });
    expect(checkOf(warn.review, "answers_not_leaked").status).toBe("WARN");
    expect(warn.review.verdict).toBe("approved_with_warnings");
    const fail = merge({ checks: [find("answers_not_leaked", "FAIL", [blockIds[1]!], "Resuelve el razonamiento"), ...allPass().checks] });
    expect(fail.review.verdict).toBe("blocked");
  });

  it("9 and 10 · fitting tone passes; clear infantilization is a WARN or a FAIL that cannot be hidden by other PASS", () => {
    expect(checkOf(merge(allPass()).review, "age_appropriate")).toMatchObject({ status: "PASS", method: "ai" });
    const warn = merge({ checks: [...allPass().checks, find("no_infantilization", "WARN", [blockIds[0]!], "Tono pueril para la edad")] });
    expect(checkOf(warn.review, "no_infantilization").status).toBe("WARN");
    const fail = merge({ checks: [...allPass().checks, find("age_appropriate", "FAIL", [blockIds[0]!], "Lenguaje de párvulos")] });
    expect(checkOf(fail.review, "age_appropriate").status).toBe("FAIL");
    expect(fail.review.verdict).toBe("needs_revision");
  });

  it("11, 12 and 13 · a useful support passes; a redundant one and an active need without enough support are WARN", () => {
    const profile: FunctionalProfile = { schema_version: 1, supports: { checklist_support: "medium" }, limits: {}, allowances: {} };
    const only = scenario(frac, buildAdaptationContext({ profile, education: { stage: null, grade: null, subject: null }, analysis: frac, adaptationType: "accessibility", policy: 2 }).context);
    const covered = deterministicChecks(only.input).find((c) => c.check === "functional_supports_applied")!;
    expect(covered.status).toBe("PASS");
    const useful = buildReviewScoped(only.input, { checks: [...allPass().checks.filter((c) => c.check !== "answers_not_leaked"), find("answers_not_leaked", "PASS", semantic.targets)] }, only.ids);
    expect(checkOf(useful.review, "functional_supports_applied").status).toBe("PASS");
    const redundant = merge({ checks: [...allPass().checks, find("functional_supports_applied", "WARN", [blockIds[1]!], "Repite el requisito de la consigna")] });
    expect(checkOf(redundant.review, "functional_supports_applied").status).toBe("WARN");
    const thin = merge({ checks: [...allPass().checks, find("functional_supports_applied", "WARN", ["dec_1"], "La necesidad de planificación queda sin apoyo suficiente")] });
    expect(thin.review.checks.some((c) => c.check === "functional_supports_applied" && c.method === "ai" && c.status === "WARN")).toBe(true);
  });
});

describe("what reaches the model", () => {
  const text = (context = s.review) => reviewerRequestParts({ reviewContext: context }).parts.map((p) => (p.type === "text" ? p.text : "")).join("");

  it("15 · no diagnosis, no personal data, no learner alias, no administrative fields, no catalog of dimensions", () => {
    const request = text();
    expect(scanForbidden(`${PEDAGOGICAL_REVIEWER_V1.system}\n${request}`)).toEqual([]);
    expect(request).not.toMatch(/display_name|contextual_tags|teacher_request|administrative|admin_fields|answer_key/);
    for (const field of frac.administrative_fields) expect(request).not.toContain(field.label);
    expect(s.review.active_needs).toHaveLength(ctx.needs.length);
    expect(request).not.toContain("number_sense_support");
  });

  it("16 · inferred answers travel only as internal reference, only for the open semantic targets", () => {
    expect(s.review.internal_reference_only.length).toBeGreaterThan(0);
    expect(s.review.internal_reference_only.every((r) => r.use === "internal_reference_only")).toBe(true);
    expect(s.review.internal_reference_only.map((r) => r.activity).sort()).toEqual([...semantic.targets].sort());
    expect(PEDAGOGICAL_REVIEWER_V1.system).toMatch(/internal_reference_only.*nunca son contenido de la ficha/s);
    for (const r of s.review.internal_reference_only) expect(s.review.document.blocks.filter((b) => b.origin !== "original").some((b) => b.text.includes(r.inferred_answer))).toBe(false);
  });

  it("17 · the checks the system already settled never reach the model, nor can the model name them", () => {
    const names = (Object.keys(CHECK_METHODS) as Array<keyof typeof CHECK_METHODS>).filter((c) => CHECK_METHODS[c] === "deterministic");
    const request = text();
    for (const name of names) expect(request, name).not.toContain(name);
    expect(s.review.deterministic.every((d) => (AI_REVIEW_CHECKS as readonly string[]).includes(d.check))).toBe(true);
    expect(ReviewerFindingsSchema.safeParse({ findings: [{ check_key: "objectives_preserved", target_ids: [], verdict: "PASS", reason: "x" }] }).success).toBe(false);
  });

  it("18 · the same input produces the same review context", () => {
    expect(fingerprint(scenario().review)).toBe(fingerprint(s.review));
    expect(text(scenario().review)).toBe(text());
  });
});

describe("the reviewer observes: it never corrects", () => {
  it("20 · there is no field for replacement text, and a reason is a short sentence", () => {
    for (const field of ["improved_text", "replacement", "fixed_instruction"]) {
      const parsed = ReviewerFindingsSchema.safeParse({ findings: [{ check_key: "age_appropriate", target_ids: [], verdict: "WARN", reason: "x", [field]: "Texto nuevo" }] });
      expect(parsed.success, field).toBe(false);
    }
    expect(ReviewerFindingsSchema.safeParse({ findings: [{ check_key: "age_appropriate", target_ids: [], verdict: "WARN", reason: "x".repeat(161) }] }).success).toBe(false);
    expect(JSON.stringify(Object.keys(ReviewerFindingsSchema.shape.findings.element.shape))).toBe('["check_key","target_ids","verdict","reason","requires_human_review"]');
    expect(PEDAGOGICAL_REVIEWER_V1.system).toMatch(/No escribas ningún texto de reemplazo/);
  });

  const response = (text: string, stopReason: StructuredResponse["stopReason"] = "complete"): StructuredResponse => ({ text, stopReason, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0 }, provider: "anthropic", model: "m", latencyMs: 1 });

  it("parsing: truncated, refused and malformed answers are never read; a human-review request can raise a PASS to WARN and never lower anything", () => {
    expect(parseReviewerResponse(response("{}", "max_tokens")).outcome).toBe("truncated");
    expect(parseReviewerResponse(response("{}", "refusal")).outcome).toBe("refused");
    expect(parseReviewerResponse(response("no json")).outcome).toBe("not_json");
    const parsed = parseReviewerResponse(response(JSON.stringify({ findings: [{ check_key: "age_appropriate", target_ids: [], verdict: "PASS", reason: "Adecuado", requires_human_review: true }, { check_key: "no_infantilization", target_ids: [], verdict: "FAIL", reason: "Pueril", requires_human_review: true }] })));
    expect(parsed.outcome).toBe("ok");
    if (parsed.outcome === "ok") expect(findingsToDraft(parsed.findings).checks.map((c) => c.status)).toEqual(["WARN", "FAIL"]);
  });

  it("the prompt is published, pinned and not active anywhere; the model-backed reviewer plugs into the pipeline", async () => {
    expect(getPedagogicalReviewer(1)).toBe(PEDAGOGICAL_REVIEWER_V1);
    expect(() => getPedagogicalReviewer(2)).toThrow(/pedagogical_reviewer@v2/);
    expect(ACTIVE_ADAPTATION_PROMPT_VERSIONS).not.toHaveProperty("pedagogical_reviewer");
    expect(PEDAGOGICAL_REVIEWER_V1.system).not.toMatch(/claude|anthropic|openai|gpt|sonnet|haiku|opus/i);
    expect(sha(PEDAGOGICAL_REVIEWER_V1.system)).toBe("98a169e7feeccc1fda23c002f36363d42eb2ad95e8c4d9ad635dcf5f1d04aba7");

    const answers = JSON.stringify({ findings: [{ check_key: "answers_not_leaked", target_ids: [], verdict: "PASS", reason: "Sin fuga" }, { check_key: "age_appropriate", target_ids: [], verdict: "PASS", reason: "Adecuado" }, { check_key: "no_infantilization", target_ids: [], verdict: "PASS", reason: "Sobrio" }, { check_key: "functional_supports_applied", target_ids: [], verdict: "PASS", reason: "Útil" }] });
    const seen: string[] = [];
    const provider: AIProvider = { name: "anthropic", async generateStructured(request) { seen.push(JSON.stringify(request.messages)); return response(answers); } };
    const analysis = fractionsAnalysis();
    const result = await runAdaptation(
      { profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility", policy: 2 },
      { planner: createMockPlanner(analysis, 2), plannerVersion: 2, generator: createMockGenerator(2), generatorVersion: 2, reviewer: createModelReviewer({ selection: resolveModel("STANDARD", {}), provider, maxOutputTokens: 1500 }), newBlockId: sequentialIds() },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("internal_reference_only");
    expect(result.runs.at(-1)).toMatchObject({ purpose: "review", promptKey: "pedagogical_reviewer", promptVersion: 1 });
    // A PASS with no targets cannot close the semantic question: the pipeline keeps it open.
    expect(checkOf(result.review, "age_appropriate").status).toBe("PASS");
    expect(result.review.checks.find((c) => c.check === "answers_not_leaked")).toMatchObject({ status: "WARN", needs_semantic_review: true });
  });
});
