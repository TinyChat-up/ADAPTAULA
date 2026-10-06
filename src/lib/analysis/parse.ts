import { upgradeAnalysisV2 } from "@/lib/analysis/upgrade";
import { MaterialAnalysisSchema as MaterialAnalysisSchemaV2 } from "@/lib/schemas/material-analysis-v2";
import { MaterialAnalysisSchema, type MaterialAnalysis } from "@/lib/schemas/material-analysis";

export interface ParsedAnalysis {
  /** Always the current shape (v3); an old analysis is lifted in memory. */
  analysis: MaterialAnalysis | null;
  /** Version the row was stored with. */
  storedVersion: 2 | 3 | null;
  /** A stored value exists but cannot be read (unknown version or damaged): a new analysis is needed. */
  outdated: boolean;
  /** Repairs made while lifting a v2 analysis (codes and counts only). */
  warnings: string[];
}

/** Reads whatever `materials.analysis` holds. v2 rows are upgraded on read and never rewritten. */
export function parseStoredAnalysis(value: unknown): ParsedAnalysis {
  if (value === null || value === undefined) return { analysis: null, storedVersion: null, outdated: false, warnings: [] };
  const version = typeof value === "object" ? (value as { schema_version?: unknown }).schema_version : undefined;

  if (version === 3) {
    const parsed = MaterialAnalysisSchema.safeParse(value);
    return parsed.success ? { analysis: parsed.data, storedVersion: 3, outdated: false, warnings: [] } : { analysis: null, storedVersion: 3, outdated: true, warnings: [] };
  }
  if (version === 2) {
    const parsed = MaterialAnalysisSchemaV2.safeParse(value);
    if (parsed.success) {
      try {
        const { analysis, warnings } = upgradeAnalysisV2(parsed.data);
        return { analysis, storedVersion: 2, outdated: false, warnings };
      } catch {
        // falls through: a v2 analysis that cannot be lifted is treated as unreadable
      }
    }
    return { analysis: null, storedVersion: 2, outdated: true, warnings: [] };
  }
  return { analysis: null, storedVersion: null, outdated: true, warnings: [] };
}
