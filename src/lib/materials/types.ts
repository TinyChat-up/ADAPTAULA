import { z } from "zod";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import type { AnalysisMeta, MaterialAnalysis } from "@/lib/schemas/material-analysis";

export const MATERIAL_STATUSES = ["uploading", "uploaded", "queued", "analyzing", "analyzed", "failed"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export const STATUS_LABELS: Record<MaterialStatus, string> = {
  uploading: "Subiendo",
  uploaded: "Recibido",
  queued: "En cola",
  analyzing: "Analizando",
  analyzed: "Analizado",
  failed: "No se pudo analizar",
};

export const IN_PROGRESS: readonly MaterialStatus[] = ["uploading", "uploaded", "queued", "analyzing"];

export const MaterialRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  stage_slug: z.string().nullable(),
  grade_slug: z.string().nullable(),
  subject_slug: z.string().nullable(),
  topic: z.string().nullable(),
  source_type: z.enum(["pdf", "image"]),
  status: z.enum(MATERIAL_STATUSES),
  page_count: z.number().nullable(),
  confirmed_fields: z.array(z.string()),
  failure_code: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MaterialRow = z.infer<typeof MaterialRowSchema>;

export const MATERIAL_COLUMNS =
  "id, title, stage_slug, grade_slug, subject_slug, topic, source_type, status, page_count, confirmed_fields, failure_code, created_at, updated_at";

export interface MaterialFileRow {
  id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  original_name: string | null;
}

export interface MaterialJobRow {
  status: string;
  step: string | null;
  progress: number;
  attempts: number;
}

export interface MaterialDetail {
  material: MaterialRow;
  file: MaterialFileRow | null;
  analysis: MaterialAnalysis | null;
  meta: AnalysisMeta | null;
  /** True when a stored analysis exists but cannot be read (unknown version or damaged): a new analysis is needed. */
  analysisOutdated: boolean;
  job: MaterialJobRow | null;
}

/** Reads the stored analysis in the current shape; a v2 row is lifted in memory (never rewritten). */
export function parseAnalysis(value: unknown): { analysis: MaterialAnalysis | null; outdated: boolean } {
  const { analysis, outdated } = parseStoredAnalysis(value);
  return { analysis, outdated };
}
