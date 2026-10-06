import { parseStoredAnalysis } from "@/lib/analysis/parse";
import { AnalysisMetaSchema, type AnalysisMeta, type MaterialAnalysis } from "@/lib/schemas/material-analysis";

export interface CacheCandidate {
  id: string;
  status: string;
  analysis_prompt_version: string | null;
  analysis: unknown;
  analysis_meta: unknown;
}

export interface Reusable {
  sourceId: string;
  /** The stored value, copied as it is (same schema version as the source). */
  stored: unknown;
  /** The same analysis in the current shape, for deriving the material's context. */
  analysis: MaterialAnalysis;
  meta: AnalysisMeta;
}

/**
 * Cache identity of an analysis: byte-identical content (hash, matched by the caller INSIDE one workspace),
 * the prompt version that produced it and the schema version it was stored with. A model change alone does not
 * invalidate it (it is recorded in the meta); a new prompt or schema version does. Failed or outdated
 * analyses are never reused.
 */
export function pickReusableAnalysis(candidates: readonly CacheCandidate[], current: { promptVersion: string; schemaVersion: number }): Reusable | null {
  for (const candidate of candidates) {
    if (candidate.status !== "analyzed") continue;
    if (candidate.analysis_prompt_version !== current.promptVersion) continue;
    const meta = AnalysisMetaSchema.safeParse(candidate.analysis_meta);
    if (!meta.success || meta.data.schema_version !== current.schemaVersion) continue;
    const parsed = parseStoredAnalysis(candidate.analysis);
    if (!parsed.analysis || parsed.storedVersion !== current.schemaVersion) continue;
    return { sourceId: candidate.id, stored: candidate.analysis, analysis: parsed.analysis, meta: meta.data };
  }
  return null;
}
