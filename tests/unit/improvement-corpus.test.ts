import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyRevocation, evaluateAdmission, splitProblems } from "@/lib/corpus/admission";
import {
  CURRENT_CONTRIBUTION_POLICY,
  ContributionAuthorizationSchema,
  CorpusEntrySchema,
  type ContributionAuthorization,
  type ContributionPolicy,
  type CorpusEntry,
} from "@/lib/schemas/improvement-corpus";
import { REGISTRY_DIR, loadRegistry } from "../../evals/corpus/registry";

// Hypothetical future policy, ONLY to test the rules once legal review fills it in. It is not the policy in force.
const FUTURE: ContributionPolicy = {
  mechanismEffectiveAt: "2027-01-01T00:00:00Z",
  noticeVersions: ["contribucion@1"],
  maxRetentionDays: 365,
  institutionalAgreements: ["acuerdo_centro_demo"],
  trainingEnabled: false,
};
const NOW = new Date("2027-03-01T00:00:00Z");
const SHA = "a".repeat(64);
const IDS = { auth: "11111111-1111-4111-8111-111111111111", material: "22222222-2222-4222-8222-222222222222", ws: "33333333-3333-4333-8333-333333333333", user: "44444444-4444-4444-8444-444444444444" };

const auth = (over: Partial<ContributionAuthorization> = {}): ContributionAuthorization => ({
  id: IDS.auth,
  workspaceId: IDS.ws,
  grantedBy: IDS.user,
  materialId: IDS.material,
  materialSha256: SHA,
  purpose: "internal_evaluation",
  channel: "explicit_opt_in",
  noticeVersion: "contribucion@1",
  noticeSha256: "b".repeat(64),
  grantedAt: "2027-02-01T00:00:00Z",
  expiresAt: "2028-01-01T00:00:00Z",
  revokedAt: null,
  declarations: { rights: "own_work", noPersonalData: true, institutionalMaterial: false },
  ...over,
});

const entry = (over: Partial<CorpusEntry> = {}): CorpusEntry => ({
  id: "cx_contrib",
  sha256: SHA,
  family: "contrib",
  origin: { kind: "contribution", authorizationId: IDS.auth, materialId: IDS.material, workspaceId: IDS.ws, uploadedAt: "2027-01-15T00:00:00Z" },
  rights: { status: "licence_verified", evidence: "declaración de autoría + revisión del equipo" },
  privacyReview: { status: "passed", reviewedAt: "2027-02-02T00:00:00Z", findings: [] },
  documentType: "esquema_numerado",
  subject: "Ciencias",
  stage: "primaria",
  difficulty: "media",
  versions: { analysis: null, adaptation: null },
  reproducedErrors: [],
  expectedResult: { status: "none", validatedBy: null, validatedAt: null },
  split: "development",
  addedAt: "2027-02-03T00:00:00Z",
  exclusion: null,
  ...over,
});

const own = (over: Partial<CorpusEntry> = {}): CorpusEntry =>
  entry({ id: "cx_own", family: "own", origin: { kind: "own", author: "equipo Adaptaula", synthetic: true }, rights: { status: "own_original", evidence: "repo" }, ...over });

const judge = (e: CorpusEntry, a: ContributionAuthorization | null = auth(), policy = FUTURE, now = NOW) =>
  evaluateAdmission(e, { authorizations: new Map(a ? [[a.id, a]] : []), policy, now });

describe("improvement corpus · policy in force", () => {
  it("today no user contribution can enter: no mechanism, no notice, no confirmed retention, training off", () => {
    expect(CURRENT_CONTRIBUTION_POLICY).toEqual({ mechanismEffectiveAt: null, noticeVersions: [], maxRetentionDays: null, institutionalAgreements: [], trainingEnabled: false });
    expect(judge(entry(), auth(), CURRENT_CONTRIBUTION_POLICY).rejections).toContain("mechanism_not_active");
    expect(judge(own(), null, CURRENT_CONTRIBUTION_POLICY)).toEqual({ admitted: true, usableFor: ["internal_evaluation"], rejections: [] });
  });

  it("a pending retention period keeps contributions out even with a mechanism", () => {
    expect(judge(entry(), auth(), { ...FUTURE, maxRetentionDays: null }).rejections).toEqual(["retention_period_pending"]);
  });
});

describe("improvement corpus · authorization", () => {
  it("admits an explicit, current, per-material authorization only for internal evaluation", () => {
    expect(judge(entry())).toEqual({ admitted: true, usableFor: ["internal_evaluation"], rejections: [] });
  });

  it("uploading or accepting the terms is not an authorization: without a record the material stays out", () => {
    expect(judge(entry(), null).rejections).toEqual(["authorization_missing"]);
  });

  it("only an explicit opt-in can be recorded; any other channel is invalid", () => {
    expect(ContributionAuthorizationSchema.safeParse({ ...auth(), channel: "terms_acceptance" }).success).toBe(false);
    expect(ContributionAuthorizationSchema.safeParse({ ...auth(), purpose: "service" }).success).toBe(false);
  });

  it("an authorization for training (C) never admits for evaluation (B), and B never yields C", () => {
    expect(judge(entry(), auth({ purpose: "model_training" })).rejections).toContain("authorization_wrong_purpose");
    expect(judge(entry()).usableFor).not.toContain("model_training");
  });

  it("binds to the exact material and bytes", () => {
    expect(judge(entry(), auth({ materialSha256: "c".repeat(64) })).rejections).toContain("authorization_wrong_material");
    expect(judge(entry(), auth({ materialId: "55555555-5555-4555-8555-555555555555" })).rejections).toContain("authorization_wrong_material");
  });

  it("rejects an unknown notice version (cannot prove what the teacher was told)", () => {
    expect(judge(entry(), auth({ noticeVersion: "contribucion@0" })).rejections).toContain("authorization_unknown_notice");
  });

  it("nothing is authorized retroactively: authorizations or uploads before the mechanism existed stay out", () => {
    expect(judge(entry(), auth({ grantedAt: "2026-12-01T00:00:00Z" })).rejections).toContain("authorization_before_mechanism");
    const old = entry({ origin: { kind: "contribution", authorizationId: IDS.auth, materialId: IDS.material, workspaceId: IDS.ws, uploadedAt: "2026-10-01T00:00:00Z" } });
    expect(judge(old).rejections).toContain("uploaded_before_mechanism");
  });

  it("withdrawal and expiry take effect; an authorization cannot outlast the retention limit", () => {
    expect(judge(entry(), auth({ revokedAt: "2027-02-20T00:00:00Z" })).rejections).toContain("authorization_revoked");
    expect(judge(entry(), auth({ expiresAt: "2027-02-28T00:00:00Z" })).rejections).toContain("authorization_expired");
    expect(judge(entry(), auth({ expiresAt: "2029-01-01T00:00:00Z" })).rejections).toContain("authorization_exceeds_retention");
  });

  it("revocation marks every dependent entry as excluded, and an excluded entry is never admitted", () => {
    const [revoked, other] = applyRevocation([entry(), own()], IDS.auth, "2027-02-20T00:00:00Z");
    expect(revoked!.exclusion).toEqual({ at: "2027-02-20T00:00:00Z", reason: "authorization_revoked" });
    expect(other!.exclusion).toBeNull();
    expect(judge(revoked!).rejections).toContain("excluded");
  });
});

describe("improvement corpus · rights and privacy", () => {
  it("a teacher cannot grant rights over third-party content: declaration and verified licence are both required", () => {
    expect(judge(entry(), auth({ declarations: { rights: "third_party", noPersonalData: true, institutionalMaterial: false } })).rejections).toContain("declared_third_party_rights");
    expect(judge(entry(), auth({ declarations: { rights: "unknown", noPersonalData: true, institutionalMaterial: false } })).rejections).toContain("declared_third_party_rights");
    expect(judge(entry({ rights: { status: "pending", evidence: null } })).rejections).toContain("rights_not_verified");
    expect(judge(entry({ rights: { status: "licence_verified", evidence: null } })).rejections).toContain("rights_not_verified");
  });

  it("school material needs a signed agreement with the school, not a teacher's authorization", () => {
    expect(judge(entry(), auth({ declarations: { rights: "own_work", noPersonalData: true, institutionalMaterial: true } })).rejections).toContain("institutional_requires_agreement");
    const inst = (ref: string) => entry({ origin: { kind: "institutional", agreementRef: ref } });
    expect(judge(inst("acuerdo_inexistente"), null).rejections).toEqual(["unknown_agreement"]);
    expect(judge(inst("acuerdo_centro_demo"), null).admitted).toBe(true);
  });

  it("any student or third-party personal data keeps it out; codes instead of names are not anonymisation", () => {
    for (const finding of ["student_name", "pseudonymised_student_data", "health_data", "diagnosis", "medical_report", "grades_linked_to_student", "identifying_photo", "personal_answers_of_minor", "student_work", "hidden_metadata_identifier"] as const) {
      const r = judge(entry({ privacyReview: { status: "failed", reviewedAt: "2027-02-02T00:00:00Z", findings: [finding] } }));
      expect(r.admitted).toBe(false);
      expect(r.rejections).toContain("privacy_finding");
    }
    expect(judge(entry(), auth({ declarations: { rights: "own_work", noPersonalData: false, institutionalMaterial: false } })).rejections).toContain("declared_personal_data");
  });

  it("a pending privacy review keeps even our own material out", () => {
    expect(judge(own({ privacyReview: { status: "pending", reviewedAt: null, findings: [] } }), null).rejections).toEqual(["privacy_review_not_passed"]);
  });
});

describe("improvement corpus · splits and example registry", () => {
  it("development, evaluation and holdout never share bytes or a family of variants", () => {
    const a = own({ id: "cx_a", family: "f1", split: "development" });
    expect(splitProblems([a, own({ id: "cx_b", family: "f2", split: "evaluation" })]).map((p) => p.code)).toEqual(["duplicate_bytes_across_splits"]);
    expect(splitProblems([a, own({ id: "cx_b", family: "f1", sha256: "d".repeat(64), split: "holdout" })]).map((p) => p.code)).toEqual(["family_across_splits"]);
    expect(splitProblems([a, own({ id: "cx_a", family: "f1", sha256: "e".repeat(64) })]).map((p) => p.code)).toEqual(["duplicate_id"]);
  });

  it("the example registry is synthetic, hashes its files, keeps splits apart and admits only own sheets today", () => {
    const registry = loadRegistry();
    expect(registry.entries.every((e) => CorpusEntrySchema.safeParse(e).success)).toBe(true);
    expect(splitProblems(registry.entries)).toEqual([]);
    expect(new Set(registry.entries.map((e) => e.split))).toEqual(new Set(["development", "evaluation", "holdout"]));
    for (const e of registry.entries.filter((x) => x.file)) {
      expect(createHash("sha256").update(readFileSync(path.join(REGISTRY_DIR, e.file!))).digest("hex")).toBe(e.sha256);
      expect(e.origin).toMatchObject({ kind: "own", synthetic: true });
    }
    const results = Object.fromEntries(registry.entries.map((e) => [e.id, evaluateAdmission(e, { authorizations: new Map(), policy: CURRENT_CONTRIBUTION_POLICY, now: NOW })]));
    expect(Object.entries(results).filter(([, r]) => r.admitted).map(([id]) => id).sort()).toEqual(["cx_celula_numerada", "cx_fracciones_barra", "cx_lectura_comprension", "cx_recta_numerica"]);
    expect(results.cx_contribucion_hipotetica!.rejections).toEqual(["privacy_review_not_passed", "rights_not_verified", "mechanism_not_active"]);
  });
});
