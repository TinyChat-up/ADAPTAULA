import "server-only";
import { buildReadiness, unavailableReadiness, type ReadinessSource } from "@/lib/analysis/readiness";
import type { AnalysisReadiness } from "@/lib/schemas/analysis-readiness";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";

/**
 * Computes the readiness report of a finished analysis from the stored original (shadow mode). Reads the PDF's printed strings once
 * (no rendering, no model, no network) within a time budget. It never throws and never fails an analysis: if anything goes wrong
 * the report says it could not be computed (or there is none), and the analysis is saved exactly as before.
 */
export const READINESS_MAX_PAGES = 30;
export const READINESS_BUDGET_MS = 15_000;

export async function computeReadiness(
  analysis: MaterialAnalysis,
  file: { bytes: Uint8Array; mime: string; pages: number },
  budgetMs: number = READINESS_BUDGET_MS,
): Promise<AnalysisReadiness | null> {
  try {
    if (file.mime !== "application/pdf") return buildReadiness(analysis, { kind: "image", pages: file.pages, strings: null });
    if (budgetMs < 1000) return unavailableReadiness(analysis, { kind: "pdf", pages: file.pages }, "timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), Math.min(budgetMs, READINESS_BUDGET_MS));
    });
    try {
      // Loaded only here: a deployment without the rasteriser's files degrades to «could not be computed», never to a failed analysis.
      const { documentStrings } = await import("./visuals/raster");
      const read = await Promise.race([documentStrings(file.bytes, file.mime, READINESS_MAX_PAGES).catch(() => "failed" as const), timeout]);
      if (read === "timeout") return unavailableReadiness(analysis, { kind: "pdf", pages: file.pages }, "timeout");
      if (read === "failed") return unavailableReadiness(analysis, { kind: "pdf", pages: file.pages }, "extraction_failed");
      const source: ReadinessSource = { kind: "pdf", pages: read.pages, strings: read.items };
      return buildReadiness(analysis, source);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
