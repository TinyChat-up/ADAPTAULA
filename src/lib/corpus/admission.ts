import type { ContributionAuthorization, ContributionPolicy, CorpusEntry, Purpose } from "@/lib/schemas/improvement-corpus";

/**
 * Deterministic admission rules for the improvement corpus (docs/legal/FINALIDADES_Y_CORPUS.md). Pure functions: no storage,
 * no network, no production caller. They fail closed: anything pending, missing or ambiguous keeps a material out.
 */

export type RejectionCode =
  | "excluded"
  | "privacy_review_not_passed"
  | "privacy_finding"
  | "rights_not_verified"
  | "mechanism_not_active"
  | "retention_period_pending"
  | "authorization_missing"
  | "authorization_wrong_material"
  | "authorization_wrong_purpose"
  | "authorization_unknown_notice"
  | "authorization_before_mechanism"
  | "uploaded_before_mechanism"
  | "authorization_revoked"
  | "authorization_expired"
  | "authorization_exceeds_retention"
  | "declared_third_party_rights"
  | "declared_personal_data"
  | "institutional_requires_agreement"
  | "unknown_agreement";

export interface AdmissionResult {
  admitted: boolean;
  /** Purposes this entry may serve. Never `service` (that is the teacher's own request) and never `model_training` today. */
  usableFor: Purpose[];
  rejections: RejectionCode[];
}

const DAY = 86_400_000;
const t = (iso: string) => Date.parse(iso);

/** Problems with an authorization itself, for this material, under this policy, at `now`. */
export function authorizationProblems(
  auth: ContributionAuthorization | undefined,
  material: { materialId: string; sha256: string; uploadedAt: string },
  policy: ContributionPolicy,
  now: Date,
): RejectionCode[] {
  if (!policy.mechanismEffectiveAt) return ["mechanism_not_active"];
  if (policy.maxRetentionDays === null) return ["retention_period_pending"];
  if (!auth) return ["authorization_missing"];
  const out: RejectionCode[] = [];
  if (auth.materialId !== material.materialId || auth.materialSha256 !== material.sha256) out.push("authorization_wrong_material");
  if (auth.purpose !== "internal_evaluation") out.push("authorization_wrong_purpose");
  if (!policy.noticeVersions.includes(auth.noticeVersion)) out.push("authorization_unknown_notice");
  const effective = t(policy.mechanismEffectiveAt);
  if (t(auth.grantedAt) < effective) out.push("authorization_before_mechanism");
  // Conservative: a file uploaded before the mechanism existed is never treated as contributed, even if authorized later.
  if (t(material.uploadedAt) < effective) out.push("uploaded_before_mechanism");
  if (auth.revokedAt !== null && t(auth.revokedAt) <= now.getTime()) out.push("authorization_revoked");
  if (t(auth.expiresAt) <= now.getTime()) out.push("authorization_expired");
  if (t(auth.expiresAt) - t(auth.grantedAt) > policy.maxRetentionDays * DAY) out.push("authorization_exceeds_retention");
  if (auth.declarations.rights === "third_party" || auth.declarations.rights === "unknown") out.push("declared_third_party_rights");
  if (!auth.declarations.noPersonalData) out.push("declared_personal_data");
  if (auth.declarations.institutionalMaterial) out.push("institutional_requires_agreement");
  return out;
}

export function evaluateAdmission(
  entry: CorpusEntry,
  context: { authorizations: ReadonlyMap<string, ContributionAuthorization>; policy: ContributionPolicy; now: Date },
): AdmissionResult {
  const rejections: RejectionCode[] = [];
  if (entry.exclusion) rejections.push("excluded");
  if (entry.privacyReview.status !== "passed") rejections.push("privacy_review_not_passed");
  if (entry.privacyReview.findings.length > 0) rejections.push("privacy_finding");

  const origin = entry.origin;
  if (origin.kind === "own") {
    if (entry.rights.status !== "own_original") rejections.push("rights_not_verified");
  } else {
    // A teacher's declaration is not a licence: third-party content needs verified evidence.
    if (entry.rights.status !== "licence_verified" || !entry.rights.evidence) rejections.push("rights_not_verified");
    if (origin.kind === "contribution") {
      rejections.push(...authorizationProblems(context.authorizations.get(origin.authorizationId), { materialId: origin.materialId, sha256: entry.sha256, uploadedAt: origin.uploadedAt }, context.policy, context.now));
    } else if (!context.policy.institutionalAgreements.includes(origin.agreementRef)) {
      rejections.push("unknown_agreement");
    }
  }
  const unique = [...new Set(rejections)];
  // Purpose C is never granted here: training needs a separate legal basis, agreement and a code change (trainingEnabled: false).
  return { admitted: unique.length === 0, usableFor: unique.length === 0 ? ["internal_evaluation"] : [], rejections: unique };
}

/** Withdrawal: every entry that depends on the authorization leaves the corpus at `at` (its copies must then be deleted). */
export function applyRevocation(entries: readonly CorpusEntry[], authorizationId: string, at: string): CorpusEntry[] {
  return entries.map((e) =>
    e.origin.kind === "contribution" && e.origin.authorizationId === authorizationId && !e.exclusion ? { ...e, exclusion: { at, reason: "authorization_revoked" as const } } : e,
  );
}

export type SplitProblem = { code: "duplicate_id" | "duplicate_bytes_across_splits" | "family_across_splits"; detail: string };

/** Development, evaluation and holdout never share a file, nor variants of one source (family). */
export function splitProblems(entries: readonly CorpusEntry[]): SplitProblem[] {
  const out: SplitProblem[] = [];
  const ids = new Set<string>();
  const bySha = new Map<string, Set<string>>();
  const byFamily = new Map<string, Set<string>>();
  for (const e of entries) {
    if (ids.has(e.id)) out.push({ code: "duplicate_id", detail: e.id });
    ids.add(e.id);
    (bySha.get(e.sha256) ?? bySha.set(e.sha256, new Set()).get(e.sha256)!).add(e.split);
    (byFamily.get(e.family) ?? byFamily.set(e.family, new Set()).get(e.family)!).add(e.split);
  }
  for (const [sha, splits] of bySha) if (splits.size > 1) out.push({ code: "duplicate_bytes_across_splits", detail: sha.slice(0, 12) });
  for (const [family, splits] of byFamily) if (splits.size > 1) out.push({ code: "family_across_splits", detail: family });
  return out;
}
