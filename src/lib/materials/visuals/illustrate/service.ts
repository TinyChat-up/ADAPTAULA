import "server-only";
import type { IMAGE_BRIEF_V1 } from "@prompts/image-brief/v1";
import { IMAGE_RENDER_V1 } from "@prompts/image-render/v1";
import { fingerprint } from "@/lib/adaptation/fingerprint";
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
 * The stage's time is up before a new image could be made: the job is retried later (a transient error), and what was already
 * approved is reused then. Never a reason to stop the adaptation.
 */
export class IllustrationDeferred extends Error {
  constructor() {
    super("illustration_deferred");
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
}

export interface StoredIllustration {
  id: string;
  sha256: string;
  width: number;
  height: number;
  alt: string;
}

export interface IllustrationDeps {
  brief(input: Parameters<typeof IMAGE_BRIEF_V1.buildUserText>[0]): Promise<{ draft: BriefDraft | null; run: AIRunRecord }>;
  image(input: { prompt: string; size: ImageSize }): Promise<{ image: GeneratedImage | null; run: AIRunRecord }>;
  review(input: { png: Uint8Array; stage: string | null; activity: string; brief: IllustrationBrief }): Promise<{ draft: ReviewDraft | null; run: AIRunRecord }>;
  store: {
    /** The illustration already approved for this need of the adaptation (whatever brief produced it). */
    find(adaptationId: string, needKey: string): Promise<StoredIllustration | null>;
    put(input: { request: IllustrationRequest; brief: IllustrationBrief; briefFingerprint: string; prompt: string; png: Uint8Array; sha256: string; width: number; height: number; attempts: number; review: Record<string, unknown> }): Promise<StoredIllustration>;
  };
  quota: { reserve(key: string): Promise<boolean>; refund(key: string): Promise<void> };
  recordAiRun(run: AIRunRecord): Promise<void>;
  sha256(bytes: Uint8Array): string;
}

export type IllustrationOutcome =
  | { ok: true; asset: StoredIllustration; cached: boolean; attempts: number }
  | { ok: false; reason: "brief_rejected" | "quota_exhausted" | "image_failed" | "review_rejected"; detail: string[] };

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
  const record = (run: AIRunRecord) => deps.recordAiRun(run).catch(() => undefined);
  // A resumed job or a correction cycle reuses what was approved: no new brief, no new image, no new unit.
  const cached = await deps.store.find(request.adaptationId, request.needKey);
  if (cached) return { ok: true, asset: cached, cached: true, attempts: 0 };
  const { draft, run: briefRun } = await deps.brief({ stage: request.stage, grade: request.grade, subject: request.subject, activity: request.activity, objective: request.objective, missing: request.missing, purpose: request.purpose, supports: request.supports });
  await record(briefRun);
  const validated = validateBrief(draft, { activity: request.activity, expectedAnswer: request.expectedAnswer, signatures: request.signatures, lowDetail: request.lowDetail });
  if (!validated.ok) return { ok: false, reason: "brief_rejected", detail: validated.violations };
  const brief = validated.brief;
  const briefFingerprint = fingerprint({ brief, render: `${IMAGE_RENDER_V1.key}@v${IMAGE_RENDER_V1.version}`, stage: request.stage });

  const quotaKey = `image:${request.adaptationId}:${request.needKey}:${briefFingerprint.slice(0, 16)}`;
  if (!(await deps.quota.reserve(quotaKey))) return { ok: false, reason: "quota_exhausted", detail: [] };

  let corrections: string[] = [];
  const detail: string[] = [];
  let reviewed = false;
  for (let attempt = 1; attempt <= ILLUSTRATION_LIMITS.attemptsPerImage; attempt++) {
    const prompt = IMAGE_RENDER_V1.build(brief, { stage: request.stage, corrections });
    const { image, run } = await deps.image({ prompt, size: sizeFor(brief.kind) });
    await record({ ...run, attempt });
    // A refusal by the provider's content policy is final; a transient failure gets the second attempt.
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
    const { draft: review, run: reviewRun } = await deps.review({ png: image.data, stage: request.stage, activity: request.activity, brief });
    await record({ ...reviewRun, attempt });
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
