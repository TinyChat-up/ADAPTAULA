/**
 * Single place for what Adaptaula accepts as a material and how much of it.
 * Plans can lower the limits (plans.features.max_file_mb / max_pages_per_material) but never exceed the hard caps.
 */

export const FILE_TYPES = {
  pdf: { kind: "pdf", mime: "application/pdf", extensions: ["pdf"], label: "PDF" },
  jpeg: { kind: "image", mime: "image/jpeg", extensions: ["jpg", "jpeg"], label: "JPG" },
  png: { kind: "image", mime: "image/png", extensions: ["png"], label: "PNG" },
  webp: { kind: "image", mime: "image/webp", extensions: ["webp"], label: "WEBP" },
} as const;

export type FileFormat = keyof typeof FILE_TYPES;
export type FileKind = (typeof FILE_TYPES)[FileFormat]["kind"];

export const ACCEPT_ATTRIBUTE = Object.values(FILE_TYPES)
  .flatMap((t) => [t.mime, ...t.extensions.map((e) => `.${e}`)])
  .join(",");

export const FORMATS_LABEL = "PDF, JPG, PNG o WEBP";

const MIB = 1024 * 1024;

/**
 * Hard caps, independent of the plan.
 * - PDF 20 MiB: the provider accepts 32 MB requests and base64 inflates the file by a third (20 MiB ≈ 28 MB).
 * - Image 5 MiB: the provider's per-image limit.
 * - 30 pages: above the largest plan (25) and far below the provider's limit; analysis cost grows with every page.
 */
export const HARD_LIMITS = {
  maxPdfBytes: 20 * MIB,
  maxImageBytes: 5 * MIB,
  maxPdfPages: 30,
} as const;

/** Used only when a plan row carries no limits at all (the Free values from supabase/seed.sql). */
export const FALLBACK_PLAN_LIMITS = { maxFileMb: 15, maxPages: 5 } as const;

export interface MaterialLimits {
  maxPdfBytes: number;
  maxImageBytes: number;
  maxPages: number;
}

export function effectiveLimits(features: { max_file_mb?: number | undefined; max_pages_per_material?: number | undefined }): MaterialLimits {
  const planBytes = (features.max_file_mb ?? FALLBACK_PLAN_LIMITS.maxFileMb) * MIB;
  return {
    maxPdfBytes: Math.min(planBytes, HARD_LIMITS.maxPdfBytes),
    maxImageBytes: Math.min(planBytes, HARD_LIMITS.maxImageBytes),
    maxPages: Math.min(features.max_pages_per_material ?? FALLBACK_PLAN_LIMITS.maxPages, HARD_LIMITS.maxPdfPages),
  };
}

/** Abuse protection and recovery. Rationale in docs/AI_PIPELINE.md. */
export const ANALYSIS_LIMITS = {
  /** Uploads started per user per hour. */
  uploadsPerUserPerHour: 30,
  /** Analyses requested per workspace per hour (retries included). */
  analysesPerWorkspacePerHour: 20,
  /** Analyses queued or running at the same time per workspace. */
  maxActivePerWorkspace: 3,
  /** An upload that never completed is cleaned up after this long. */
  staleUploadMinutes: 60,
  /** Lease of a processing job. Must exceed the longest legitimate run (function maxDuration is 300 s). */
  leaseSeconds: 330,
  /** Wait before a transient failure is retried. */
  retryBackoffSeconds: 45,
  /** Signed URLs live this long: a fresh one is requested for every view. */
  signedReadUrlSeconds: 60,
  signedUploadUrlSeconds: 7200,
} as const;

export const SOURCE_BUCKET = "source-materials";

export function buildStoragePath(input: { workspaceId: string; userId: string; materialId: string; fileId: string; extension: string }): string {
  const { workspaceId, userId, materialId, fileId, extension } = input;
  return `${workspaceId}/${userId}/${materialId}/${fileId}.${extension}`;
}

/** Original names are only metadata: no path separators, control characters or absurd lengths. */
export function sanitizeOriginalName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(-255) || "material";
}

export function titleFromFileName(name: string): string {
  const base = sanitizeOriginalName(name).replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").trim();
  return (base || "Material").slice(0, 200);
}
