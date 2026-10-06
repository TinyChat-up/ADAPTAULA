import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { normalizeGeneratedV2 } from "@/lib/adaptation/generated-v2";
import { mockGenerateDraftV2 } from "@/lib/adaptation/mock";
import { normalizePlan } from "@/lib/adaptation/plan";
import { reviewPlan } from "@/lib/adaptation/plan-review";
import { checkOf, deterministicChecks } from "@/lib/adaptation/review";
import { buildPedagogicalReviewContext } from "@/lib/adaptation/review-context";
import { buildReviewScoped, reviewerRequestParts } from "@/lib/adaptation/reviewer";
import { DraftGeneratedSegmentsV2Schema } from "@/lib/schemas/generated-segments-v2";
import { allBlocks } from "@/lib/schemas/material-document";
import type { AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { BACH_PLAN_DRAFT, bachReviewFor, bachilleratoMirrorAnalysis } from "../../evals/adaptation/generator-fixtures";
import { buildExperimentContext, scanForbidden } from "../../evals/adaptation/planner-lib";
import { MUTATIONS, buildAdversarialCopy, deterministicDetection, scoreMutations, type AdversarialSource } from "../../evals/adaptation/reviewer-adversarial";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const evidenceFile = (name: string) => readFileSync(path.resolve(import.meta.dirname, "../../evals/adaptation/evidence", name), "utf8");

/** The Bachillerato MIRROR (synthetic, public): same structure as the real sheet, so the eval's infrastructure is tested without the private worksheet. */
const analysis = bachilleratoMirrorAnalysis();
const context = buildExperimentContext(analysis, "accessibility", 1);
const rawPlan = normalizePlan(BACH_PLAN_DRAFT, analysis, context);
const review = bachReviewFor(rawPlan);
const reviewedBase = reviewPlan(rawPlan, review, analysis, context);
const generation = normalizeGeneratedV2(DraftGeneratedSegmentsV2Schema.parse(mockGenerateDraftV2(analysis, reviewedBase, context)), reviewedBase, analysis, context);
const document = buildDocument({ analysis, plan: reviewedBase.effective, context, generated: generation.segments, newBlockId: sequentialIds() });
const source: AdversarialSource = { analysis, context, rawPlan, review, document };

const before = JSON.stringify({ document, rawPlan, review });
const copy = buildAdversarialCopy(source);
const input = { analysis, plan: copy.reviewed.effective, context, document: copy.document, validation: copy.reviewed.effectiveValidation };
const reviewContext = buildPedagogicalReviewContext(input, copy.reviewed);
const request = reviewerRequestParts({ reviewContext }).parts.map((p) => (p.type === "text" ? p.text : "")).join("");
const find = (check: AiReviewDraft["checks"][number]["check"], status: "PASS" | "WARN" | "FAIL", targets: string[] = [], detail = "ok"): AiReviewDraft["checks"][number] => ({ check, status, targets, detail });
const byId = (id: string) => copy.mutations.find((m) => m.mutation_id === id)!;
const semantic = deterministicChecks(input).find((c) => c.check === "answers_not_leaked")!;
const answer = (check: Parameters<typeof find>[0], status: "PASS" | "WARN" | "FAIL", targets: string[]) => find(check, status, targets);
const baselinePass = (): AiReviewDraft["checks"] => [
  find("answers_not_leaked", "PASS", semantic.targets),
  find("age_appropriate", "PASS"),
  find("no_infantilization", "PASS"),
  find("functional_supports_applied", "PASS", []),
];
const score = (checks: AiReviewDraft["checks"]) => scoreMutations(copy.mutations, buildReviewScoped(input, { checks }, copy.reviewed.raw.decisions.map((d) => d.id)).review);

describe("the adversarial copy", () => {
  it("1 · the base document, plan and review are not modified", () => {
    expect(JSON.stringify({ document, rawPlan, review })).toBe(before);
    expect(fingerprint(copy.document)).not.toBe(fingerprint(document));
    expect(copy.rawPlan.decisions.length).toBe(rawPlan.decisions.length + MUTATIONS.length);
    expect(copy.review.plan_fingerprint).not.toBe(review.plan_fingerprint);
    expect(review.plan_fingerprint).toBe(fingerprint(rawPlan));
  });

  it("2 · it has exactly the declared mutations, and nothing else differs from the base", () => {
    const baseIds = new Set(allBlocks(document).map((b) => b.id));
    const added = allBlocks(copy.document).filter((b) => !baseIds.has(b.id));
    expect(added.map((b) => b.id).sort()).toEqual(copy.mutations.map((m) => m.block_id).sort());
    for (const m of copy.mutations) {
      const block = added.find((b) => b.id === m.block_id)!;
      expect(block.trace).toEqual({ origin: "support", source_refs: [m.target], decision_ids: [m.decision_id] });
      if (m.block.type === "help_box") expect(block).toMatchObject({ type: "help_box", variant: m.block.variant, text: m.block.text });
      else expect(block).toMatchObject({ type: "planner", slots: m.block.slots });
    }
    const common = allBlocks(copy.document).filter((b) => baseIds.has(b.id));
    expect(common.map((b) => fingerprint(b)).sort()).toEqual(allBlocks(document).map((b) => fingerprint(b)).sort());
    expect(copy.reviewed.decisions.filter((d) => copy.mutations.some((m) => m.decision_id === d.id)).every((d) => d.outcome === "applied")).toBe(true);
  });

  it("nothing in the document or the plan marks a block as adversarial", () => {
    const text = JSON.stringify({ document: copy.document, plan: copy.rawPlan });
    expect(text).not.toMatch(/adversarial|mut_|semantic_leak|safe_control|THIS IS|BAD SUPPORT/i);
    expect(copy.mutations.every((m) => /^blk_\d{4}$/.test(m.block_id))).toBe(true);
  });
});

describe("what the reviewer receives and what the experiment freezes", () => {
  it("3 · the manifest and the expectations never reach the model", () => {
    for (const m of copy.mutations) {
      for (const secret of [m.mutation_id, m.intent, `"risk":"${m.risk}"`]) expect(request, secret).not.toContain(secret);
    }
    expect(request).not.toMatch(/expected_checks|min_severity|mutation_id|adversarial|scoring/i);
  });

  it("4 · the scoring is frozen on disk before the call: hashes and a lock that the run verifies", () => {
    const lock = JSON.parse(evidenceFile("reviewer-adversarial-bachillerato-lock.json")) as { manifest_sha256: string; expectations_sha256: string; frozen_at: string };
    expect(sha(evidenceFile("reviewer-adversarial-bachillerato-manifest.json"))).toBe(lock.manifest_sha256);
    expect(sha(evidenceFile("reviewer-adversarial-bachillerato-expectations.json"))).toBe(lock.expectations_sha256);
    const expectations = JSON.parse(evidenceFile("reviewer-adversarial-bachillerato-expectations.json")) as { expectations: Array<{ mutation_id: string; min_severity: string }> };
    expect(expectations.expectations.map((e) => [e.mutation_id, e.min_severity])).toEqual(MUTATIONS.map((m) => [m.mutation_id, m.min_severity]));
    expect(Number.isNaN(Date.parse(lock.frozen_at))).toBe(false);
  });

  it("5 · the ReviewContext carries no PII, diagnosis, learner alias or administrative fields", () => {
    expect(scanForbidden(request)).toEqual([]);
    expect(request).not.toMatch(/display_name|contextual_tags|teacher_request|administrative|admin_fields|answer_key/);
    for (const f of analysis.administrative_fields) expect(request).not.toContain(f.label);
  });

  it("6 · the inferred answer stays internal-only, and only for the open semantic target", () => {
    expect(reviewContext.internal_reference_only.length).toBeGreaterThan(0);
    expect(reviewContext.internal_reference_only.every((r) => r.use === "internal_reference_only")).toBe(true);
    expect(reviewContext.internal_reference_only.map((r) => r.activity)).toEqual(semantic.targets);
  });

  it("8 · adversarial and control targets are inside the reviewer's scope, and the semantic question is required on the leak target", () => {
    const allowed = new Set(reviewContext.review_scope.allowed_targets);
    for (const m of copy.mutations) {
      expect(allowed.has(m.block_id), m.mutation_id).toBe(true);
      expect(allowed.has(m.decision_id), m.mutation_id).toBe(true);
      expect(allowed.has(m.target), m.mutation_id).toBe(true);
    }
    expect(reviewContext.review_scope.required_targets.answers_not_leaked).toContain("act_3");
    expect(reviewContext.decisions.filter((d) => copy.mutations.some((m) => m.decision_id === d.id)).every((d) => d.outcome === "applied")).toBe(true);
  });
});

describe("merge and scoring on the adversarial copy", () => {
  it("7 · the merge keeps the deterministic WARN/FAIL: an AI PASS never replaces them", () => {
    const base = deterministicChecks(input);
    const out = buildReviewScoped(input, { checks: baselinePass() }, copy.reviewed.raw.decisions.map((d) => d.id));
    for (const c of base.filter((x) => x.status !== "PASS" && x.status !== "SKIPPED" && !x.needs_semantic_review)) expect(checkOf(out.review, c.check).status, c.check).toBe(c.status);
    // The only deterministic result an AI finding may replace is the open SEMANTIC question, and only because every target got its own finding.
    const replaced = base.filter((c) => !out.review.checks.some((x) => x.check === c.check && x.method === "deterministic" && x.status === c.status));
    expect(replaced.map((c) => `${c.check}:${c.needs_semantic_review === true}`)).toEqual(["answers_not_leaked:true", "age_appropriate:false"]);
  });

  it("9 · a finding outside the scope is still rejected, and it cannot close the semantic question", () => {
    const out = buildReviewScoped(input, { checks: [find("answers_not_leaked", "PASS", ["act_3", "blk_9999"]), ...baselinePass().slice(1)] }, copy.reviewed.raw.decisions.map((d) => d.id));
    expect(out.rejected).toEqual([{ check: "answers_not_leaked", targets: ["act_3", "blk_9999"], reason: "target_out_of_scope" }]);
    expect(checkOf(out.review, "answers_not_leaked").status).toBe("WARN");
  });

  it("the deterministic checks react to none of the mutations: they reach the reviewer unseen", () => {
    expect(deterministicDetection(source).every((d) => d.changed.length === 0 && d.fails.length === 0)).toBe(true);
  });

  it("scoring: a semantic leak is a HIT only as FAIL; WARN is partial; PASS or silence is a MISS", () => {
    const A = byId("mut_A_semantic_leak");
    const hit = score([find("answers_not_leaked", "FAIL", [A.block_id]), ...baselinePass().slice(1)]);
    expect(hit.find((s) => s.mutation_id === A.mutation_id)?.detection).toBe("HIT");
    expect(score([find("answers_not_leaked", "WARN", [A.block_id]), ...baselinePass().slice(1)]).find((s) => s.mutation_id === A.mutation_id)?.detection).toBe("PARTIAL");
    expect(score(baselinePass()).find((s) => s.mutation_id === A.mutation_id)?.detection).toBe("MISS");
  });

  it("scoring: hint, infantilization and redundancy are matched by check and target, never by wording; over-severe redundancy is partial", () => {
    const B = byId("mut_B_indirect_hint");
    const C = byId("mut_C_infantilization");
    const D = byId("mut_D_semantic_redundancy");
    const s = score([...baselinePass(), find("functional_supports_applied", "WARN", [B.block_id], "anything"), find("no_infantilization", "WARN", [C.block_id], "anything"), find("functional_supports_applied", "WARN", [D.block_id], "anything")]);
    expect(Object.fromEntries(s.map((x) => [x.mutation_id, x.detection]))).toMatchObject({ [B.mutation_id]: "HIT", [C.mutation_id]: "HIT", [D.mutation_id]: "HIT" });
    const over = score([...baselinePass(), find("functional_supports_applied", "FAIL", [D.block_id])]);
    expect(over.find((x) => x.mutation_id === D.mutation_id)?.detection).toBe("PARTIAL");
    const wide = score([...baselinePass(), find("age_appropriate", "WARN", [])]);
    expect(wide.find((x) => x.mutation_id === C.mutation_id)?.detection).toBe("PARTIAL");
    expect(score(baselinePass()).filter((x) => x.mutation_id !== "mut_E_safe_control").every((x) => x.detection === "MISS")).toBe(true);
  });

  it("scoring: the safe control is CORRECT unless it draws an adverse finding (WARN false positive, FAIL too strict)", () => {
    const E = byId("mut_E_safe_control");
    const verdict = (checks: AiReviewDraft["checks"]) => score(checks).find((x) => x.mutation_id === E.mutation_id)?.detection;
    expect(verdict(baselinePass())).toBe("CORRECT");
    expect(verdict([...baselinePass(), answer("functional_supports_applied", "PASS", [E.block_id])])).toBe("CORRECT");
    expect(verdict([...baselinePass(), answer("functional_supports_applied", "WARN", [E.block_id])])).toBe("FALSE_POSITIVE");
    expect(verdict([...baselinePass(), answer("functional_supports_applied", "FAIL", [E.block_id])])).toBe("TOO_STRICT");
  });
});
