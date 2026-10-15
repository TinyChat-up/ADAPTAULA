import { z } from "zod";

/**
 * Improvement corpus: contracts for admitting a worksheet to Adaptaula's own evaluation and improvement work
 * (docs/legal/FINALIDADES_Y_CORPUS.md). Not wired to any upload, job or screen: nothing in production writes these records yet.
 *
 * Three purposes are kept apart and never derived from one another:
 *   A · service              analysing and adapting the worksheet the teacher asked for (contract with the teacher). It never
 *                            produces an authorization record and never admits a material to the corpus.
 *   B · internal_evaluation  evaluating and improving Adaptaula's own analysis/adaptation rules and prompts, internally.
 *   C · model_training       training or fine-tuning a model. Disabled: no policy can enable it without a code change.
 */

export const PURPOSES = ["service", "internal_evaluation", "model_training"] as const;
export type Purpose = (typeof PURPOSES)[number];
/** Purposes that can only exist through a separate, explicit, per-material authorization. */
export const OPTIONAL_PURPOSES = ["internal_evaluation", "model_training"] as const;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Uuid = z.string().uuid();
const Iso = z.string().datetime({ offset: true });

/**
 * What the teacher states when authorizing. These are DECLARATIONS, not proof: copyright still needs `rights.status` verified by
 * a person, and privacy still needs a passed review. A teacher cannot license someone else's work or authorize the use of
 * third parties' personal data by declaring it.
 */
export const ContributionDeclarationsSchema = z.object({
  /** Who holds the rights to the content, as the teacher understands it. */
  rights: z.enum(["own_work", "licensed_for_this_use", "third_party", "unknown"]),
  /** The teacher states the file contains no data of students or other people (names, answers, grades, photos…). */
  noPersonalData: z.boolean(),
  /** Made for or owned by a school: a school contribution goes through an agreement with the school, not a teacher. */
  institutionalMaterial: z.boolean(),
});

/**
 * Evidence of an optional authorization: who, for which exact material (id + bytes), for which ONE purpose, when, under which
 * version of the information shown (version + hash of its text), until when, and whether it was withdrawn. Off by default:
 * the only way to obtain one is an explicit opt-in action, never accepting the terms or uploading a file.
 */
export const ContributionAuthorizationSchema = z.object({
  id: Uuid,
  workspaceId: Uuid,
  grantedBy: Uuid,
  materialId: Uuid,
  materialSha256: Sha256,
  purpose: z.enum(OPTIONAL_PURPOSES),
  channel: z.literal("explicit_opt_in"),
  noticeVersion: z.string().min(1).max(60),
  noticeSha256: Sha256,
  grantedAt: Iso,
  expiresAt: Iso,
  revokedAt: Iso.nullable(),
  declarations: ContributionDeclarationsSchema,
});
export type ContributionAuthorization = z.infer<typeof ContributionAuthorizationSchema>;

/** What a privacy review can find. Any finding keeps the material out; replacing names by codes is a finding, not a pass. */
export const PRIVACY_FINDINGS = [
  "student_name",
  "student_identifier",
  "pseudonymised_student_data",
  "health_data",
  "diagnosis",
  "medical_report",
  "grades_linked_to_student",
  "identifying_photo",
  "personal_answers_of_minor",
  "student_work",
  "hidden_metadata_identifier",
  "third_party_personal_data",
] as const;
export type PrivacyFinding = (typeof PRIVACY_FINDINGS)[number];

export const EXCLUSION_REASONS = ["authorization_revoked", "authorization_expired", "privacy", "rights", "duplicate", "retention", "other"] as const;

export const CorpusOriginSchema = z.discriminatedUnion("kind", [
  /** Created by the Adaptaula team expressly for evaluation (synthetic or original). */
  z.object({ kind: z.literal("own"), author: z.string().min(1).max(80), synthetic: z.boolean() }),
  /** A teacher's material, with an explicit authorization for this exact file. */
  z.object({ kind: z.literal("contribution"), authorizationId: Uuid, materialId: Uuid, workspaceId: Uuid, uploadedAt: Iso }),
  /** A school's materials under a specific written agreement (school as controller; purposes beyond the service need it). */
  z.object({ kind: z.literal("institutional"), agreementRef: z.string().min(1).max(80) }),
]);

export const CorpusEntrySchema = z.object({
  id: z.string().regex(/^cx_[a-z0-9_]{1,40}$/),
  sha256: Sha256,
  /** Variants of one source (rescans, crops, edits) share a family: a family never spans two splits. */
  family: z.string().regex(/^[a-z0-9_]{1,40}$/),
  origin: CorpusOriginSchema,
  rights: z.object({
    status: z.enum(["own_original", "licence_verified", "pending", "rejected"]),
    /** Where the evidence lives (contract, licence, written permission). Not the document itself. */
    evidence: z.string().max(200).nullable(),
  }),
  privacyReview: z.object({
    status: z.enum(["pending", "passed", "failed"]),
    reviewedAt: Iso.nullable(),
    findings: z.array(z.enum(PRIVACY_FINDINGS)),
  }),
  documentType: z.string().regex(/^[a-z0-9_]{1,40}$/),
  subject: z.string().min(1).max(60),
  stage: z.enum(["infantil", "primaria", "eso", "bachillerato", "fp", "otra"]),
  difficulty: z.enum(["baja", "media", "alta"]),
  versions: z.object({ analysis: z.string().max(60).nullable(), adaptation: z.string().max(60).nullable() }),
  /** Error codes reproduced on this sheet (e.g. `ocr_label_lost`). Codes only, never content. */
  reproducedErrors: z.array(z.string().regex(/^[a-z0-9_]{1,60}$/)).max(40),
  expectedResult: z.object({
    status: z.enum(["none", "draft", "validated"]),
    /** Role of the validator, never a name. */
    validatedBy: z.enum(["docente", "equipo"]).nullable(),
    validatedAt: Iso.nullable(),
  }),
  split: z.enum(["development", "evaluation", "holdout"]),
  addedAt: Iso,
  exclusion: z.object({ at: Iso, reason: z.enum(EXCLUSION_REASONS) }).nullable(),
});
export type CorpusEntry = z.infer<typeof CorpusEntrySchema>;

/**
 * Policy values that only legal review can set. `null` means PENDING, and a pending value keeps every contribution out.
 * `trainingEnabled` is the literal `false`: purpose C cannot be switched on by configuration.
 */
export interface ContributionPolicy {
  /** When the authorization mechanism (notice + recorded opt-in) started to exist. Nothing before it is authorized. */
  mechanismEffectiveAt: string | null;
  /** Published versions of the contribution notice; an authorization under any other version is not valid. */
  noticeVersions: readonly string[];
  /** Longest an authorization (and the corpus copy) may last. */
  maxRetentionDays: number | null;
  /** Signed agreements with schools (references only). */
  institutionalAgreements: readonly string[];
  trainingEnabled: false;
}

/** The policy in force today: no mechanism, no notice, no confirmed retention, no agreements. Only own materials qualify. */
export const CURRENT_CONTRIBUTION_POLICY: ContributionPolicy = {
  mechanismEffectiveAt: null,
  noticeVersions: [],
  maxRetentionDays: null,
  institutionalAgreements: [],
  trainingEnabled: false,
};
