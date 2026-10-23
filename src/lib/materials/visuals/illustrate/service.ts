import "server-only";
import type { IMAGE_BRIEF_V1 } from "@prompts/image-brief/v1";
import { IMAGE_RENDER_V1 } from "@prompts/image-render/v1";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { AdaptationError } from "@/lib/adaptation/orchestration/errors";
import { isTransientAIError } from "@/lib/ai/errors";
import type { AIRunRecord, GeneratedImage, ImageSize } from "@/lib/ai/types";
import { acceptReview, correctionsFrom, validateBrief, type BriefDraft, type IllustrationBrief, type ReviewDraft } from "@/lib/visuals/illustration";

/**
 * A new educational illustration for «Hacer magia» (docs/VISUAL_RESOURCES.md § Ilustraciones generadas):
 *
 *   already approved for this need? reused → pedagogical brief (text model, validated) → reserve one `image` unit (idempotent key) → image model (prompt built from the
 *   brief by a versioned template) → PNG checked → vision review (validated) → stored privately and recorded, or ONE more attempt
 *   told what to fix → nothing approved: the unit is given back and the policy goes on to its next rung.
 *
 * Every call is an `ai_runs` row without content. An adaptation's need that already has an approved illustration reuses it (a
 * resumed job or a correction cycle never pays twice). Nothing about the learner travels: the brief carries the material and the names of the supports only.
 */

export const ILLUSTRATION_LIMITS = {
  /** Generated illustrations one adaptation may get (each one costs a monthly `image` unit). */
  perAdaptation: 3,
  /** Image model calls per illustration: one, plus one corrected attempt after a rejected review. */
  attemptsPerImage: 2,
  /** The private bucket's limit for one object. */
  maxBytes: 10 * 1024 * 1024,
} as const;

/**
 * Hard spending ceiling, enforced on the server BEFORE each call (a provider's budget alert is not a limit). What has been spent on
 * an adaptation's illustrations comes from its `ai_runs`; a call is made only if its worst case still fits. Worst cases are
 * conservative estimates from the price table (`src/lib/ai/costs.ts`, 2026-10-12); a run without a price counts at its worst case.
 */
export const ILLUSTRATION_BUDGET = {
  /** Default per adaptation when the plan sets none (`plans.features.illustration_budget_usd`). */
  perAdaptationUsd: 0.5,
  /** Worst case of one image call (medium quality, 1536×1024, prompt included). */
  imageUsd: 0.08,
  /** Worst case of one brief or one review call. */
  textUsd: 0.03,
} as const;

/**
 * Time an illustration needs. A run has a fixed time (its stage's lease): an illustration is not started, nor a second attempt
 * made, when it could not finish in it, and no call outlives it (each gets what is left, its provider's retries included). So a run
 * cut off by the platform never leaves a unit reserved and unreturned, nor an image paid for and lost.
 */
export const ILLUSTRATION_TIMING = {
  /** Before the brief: the brief, one image and its review at their usual speed. */
  startMs: 120_000,
  /** Before an image: the image at its usual speed, its review and storing it. */
  attemptMs: 90_000,
  /** Kept after the image for its review and storing it. */
  afterImageMs: 45_000,
  /** Kept after the review for storing the illustration. */
  storeMs: 10_000,
  /** The longest an image may take. */
  maxImageMs: 150_000,
  /** The longest a brief or a review may take. */
  maxTextMs: 60_000,
} as const;

/**
 * The illustration could not be made now for a reason that is not an answer: the stage's time is up, or the provider had transient
 * trouble (network, timeout, overload, rate limit). The job is retried later (a transient error) with any unit already given back,
 * and what was approved is reused then. Never a reason to stop the adaptation: that is for a real «no» (a brief that cannot be
 * made, a refusal, an image the review rejects).
 */
export class IllustrationDeferred extends AdaptationError {
  constructor() {
    super("provider_transient", "illustration_deferred");
    this.name = "IllustrationDeferred";
  }
}

export interface IllustrationRequest {
  workspaceId: string;
  adaptationId: string;
  /** What the illustration stands for: an original visual (`vis_N`), a decision's support (`dec_N`) or an activity (`act_N`). */
  needKey: string;
  stage: string | null;
  grade: string | null;
  subject: string | null;
  activity: string;
  objective: string | null;
  /** The analysis's description of the original picture that is missing, when there was one. */
  missing: string | null;
  purpose: string;
  /** Names of the functional supports the sheet attends (never learner data). */
  supports: readonly string[];
  expectedAnswer: string | null;
  signatures: readonly string[];
  lowDetail: boolean;
  /** When the illustration must be finished by (epoch ms: the stage's lease minus what follows it). None: no limit (tests, evals). */
  deadline?: number | null;
}

/** The adaptation's illustration spending so far and its ceiling (USD). Absent: no money ceiling (tests that do not test it). */
export interface IllustrationBudget {
  limitUsd: number;
  spentUsd(): Promise<number>;
}

export interface StoredIllustration {
  id: string;
  sha256: string;
  width: number;
  height: number;
  alt: string;
}

/** Each call gets `timeoutMs`: the most it may take, its provider's own retries included. */
export interface IllustrationDeps {
  brief(input: Parameters<typeof IMAGE_BRIEF_V1.buildUserText>[0] & { timeoutMs: number }): Promise<{ draft: BriefDraft | null; run: AIRunRecord }>;
  image(input: { prompt: string; size: ImageSize; timeoutMs: number }): Promise<{ image: GeneratedImage | null; run: AIRunRecord }>;
  review(input: { png: Uint8Array; stage: string | null; activity: string; brief: IllustrationBrief; timeoutMs: number }): Promise<{ draft: ReviewDraft | null; run: AIRunRecord }>;
  store: {
    /** The illustration already approved for this need of the adaptation (whatever brief produced it). */
    find(adaptationId: string, needKey: string): Promise<StoredIllustration | null>;
    put(input: { request: IllustrationRequest; brief: IllustrationBrief; briefFingerprint: string; prompt: string; png: Uint8Array; sha256: string; width: number; height: number; attempts: number; review: Record<string, unknown> }): Promise<StoredIllustration>;
  };
  quota: { reserve(key: string): Promise<boolean>; refund(key: string): Promise<void> };
  recordAiRun(run: AIRunRecord): Promise<void>;
  sha256(bytes: Uint8Array): string;
  /** The clock (epoch ms) the deadline is measured with. */
  now?(): number;
  budget?: IllustrationBudget | null;
}

export type IllustrationOutcome =
  | { ok: true; asset: StoredIllustration; cached: boolean; attempts: number }
  | { ok: false; reason: "brief_rejected" | "quota_exhausted" | "budget_exhausted" | "image_failed" | "review_rejected"; detail: string[] };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height of a PNG from its IHDR chunk, or null when the bytes are not a PNG the sheet can carry. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.length > ILLUSTRATION_LIMITS.maxBytes) return null;
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width >= 256 && height >= 256 && width <= 4096 && height <= 4096 ? { width, height } : null;
}

const sizeFor = (kind: IllustrationBrief["kind"]): ImageSize => (kind === "vocabulary_support" ? "1024x1024" : "1536x1024");

export async function illustrate(deps: IllustrationDeps, request: IllustrationRequest): Promise<IllustrationOutcome> {
  // Money: what the adaptation already spent on illustrations, plus what this one spends, against the ceiling (worst case for unpriced runs).
  let spent = 0;
  const worstOf = (run: AIRunRecord) => (run.purpose === "image" ? ILLUSTRATION_BUDGET.imageUsd : ILLUSTRATION_BUDGET.textUsd);
  const record = (run: AIRunRecord) => {
    spent += run.estimatedCostUsd ?? worstOf(run);
    return deps.recordAiRun(run);
  };
  const fits = (usd: number) => !deps.budget || spent + usd <= deps.budget.limitUsd + 1e-9;
  const left = () => (request.deadline ?? Number.POSITIVE_INFINITY) - (deps.now ? deps.now() : Date.now());
  /** What a call may take: what is left minus what must follow it, never more than its own maximum. */
  const budget = (max: number, reserve: number) => Math.max(1_000, Math.min(max, left() - reserve));
  // A resumed job or a correction cycle reuses what was approved: no new brief, no new image, no new unit.
  const cached = await deps.store.find(request.adaptationId, request.needKey);
  if (cached) return { ok: true, asset: cached, cached: true, attempts: 0 };
  if (left() < ILLUSTRATION_TIMING.startMs) throw new IllustrationDeferred();
  if (deps.budget) spent = await deps.budget.spentUsd();
  // The whole first attempt must fit before anything is paid: brief, one image, one review.
  if (!fits(2 * ILLUSTRATION_BUDGET.textUsd + ILLUSTRATION_BUDGET.imageUsd)) return { ok: false, reason: "budget_exhausted", detail: [] };
  const { draft, run: briefRun } = await deps.brief({ stage: request.stage, grade: request.grade, subject: request.subject, activity: request.activity, objective: request.objective, missing: request.missing, purpose: request.purpose, supports: request.supports, timeoutMs: budget(ILLUSTRATION_TIMING.maxTextMs, ILLUSTRATION_TIMING.attemptMs) });
  await record(briefRun);
  if (!draft && isTransientAIError(briefRun.errorCode)) throw new IllustrationDeferred();
  const validated = validateBrief(draft, { activity: request.activity, expectedAnswer: request.expectedAnswer, signatures: request.signatures, lowDetail: request.lowDetail });
  if (!validated.ok) return { ok: false, reason: "brief_rejected", detail: validated.violations };
  const brief = validated.brief;
  const briefFingerprint = fingerprint({ brief, render: `${IMAGE_RENDER_V1.key}@v${IMAGE_RENDER_V1.version}`, stage: request.stage });

  const quotaKey = `image:${request.adaptationId}:${request.needKey}:${briefFingerprint.slice(0, 16)}`;
  if (left() < ILLUSTRATION_TIMING.attemptMs) throw new IllustrationDeferred();
  if (!(await deps.quota.reserve(quotaKey))) return { ok: false, reason: "quota_exhausted", detail: [] };
  const defer = async () => {
    await deps.quota.refund(quotaKey);
    return new IllustrationDeferred();
  };

  let corrections: string[] = [];
  const detail: string[] = [];
  let reviewed = false;
  for (let attempt = 1; attempt <= ILLUSTRATION_LIMITS.attemptsPerImage; attempt++) {
    if (attempt > 1 && left() < ILLUSTRATION_TIMING.attemptMs) throw await defer();
    if (attempt > 1 && !fits(ILLUSTRATION_BUDGET.imageUsd + ILLUSTRATION_BUDGET.textUsd)) {
      await deps.quota.refund(quotaKey);
      return { ok: false, reason: "budget_exhausted", detail: [...new Set(detail)].slice(0, 12) };
    }
    const prompt = IMAGE_RENDER_V1.build(brief, { stage: request.stage, corrections });
    const { image, run } = await deps.image({ prompt, size: sizeFor(brief.kind), timeoutMs: budget(ILLUSTRATION_TIMING.maxImageMs, ILLUSTRATION_TIMING.afterImageMs) });
    await record({ ...run, attempt });
    // Transient trouble (or the run's time) is tried again in a later run, never taken as an answer. A refusal by the provider's
    // content policy is final.
    if (!image && isTransientAIError(run.errorCode)) throw await defer();
    if (!image) {
      detail.push(`image:${run.errorCode ?? run.status}`);
      if (run.status === "refused") break;
      continue;
    }
    const size = image.mediaType === "image/png" ? pngSize(image.data) : null;
    if (!size) {
      detail.push("image:invalid_png");
      continue;
    }
    const { draft: review, run: reviewRun } = await deps.review({ png: image.data, stage: request.stage, activity: request.activity, brief, timeoutMs: budget(ILLUSTRATION_TIMING.maxTextMs, ILLUSTRATION_TIMING.storeMs) });
    await record({ ...reviewRun, attempt });
    if (!review && isTransientAIError(reviewRun.errorCode)) throw await defer();
    reviewed = true;
    const verdict = acceptReview(review, brief);
    if (verdict.ok) {
      const asset = await deps.store.put({ request, brief, briefFingerprint, prompt, png: image.data, sha256: deps.sha256(image.data), width: size.width, height: size.height, attempts: attempt, review: { approved: true, attempts: attempt, elements: review!.elements.map((e) => ({ name: e.name, present: e.present, marker_ok: e.marker_ok, label_ok: e.label_ok })) } });
      return { ok: true, asset, cached: false, attempts: attempt };
    }
    detail.push(...verdict.issues);
    corrections = correctionsFrom(verdict.issues);
  }
  await deps.quota.refund(quotaKey);
  return { ok: false, reason: reviewed ? "review_rejected" : "image_failed", detail: [...new Set(detail)].slice(0, 12) };
}
