import "server-only";
import type { Actor, ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { logger } from "@/lib/logger";
import type { VisualDeps } from "@/lib/materials/visuals/service";
import { loadRenderInputWith, sheetModel } from "@/lib/render/load";
import type { PdfEngine, PdfRenderResult } from "./print/engine";
import { PdfEngineError } from "./print/engine";
import { pdfContentDisposition } from "./pdf-filename";
import { renderPrintHtml } from "./print/html";
import { validatePdf } from "./print/validation";

/**
 * On-demand PDF of an adaptation's CURRENT, DELIVERED version, for whoever may read it. The one chain, nothing parallel:
 * stored `MaterialDocument` → `sheetModel` (`buildRenderModel`, student mode, as the student view) → `renderPrintHtml` (the same
 * `MaterialSheet` and `material.css`) → `PdfEngine` → `validatePdf`. No model is called, no quota is touched and nothing is
 * written: exporting twice gives the same document (only the PDF's own metadata may differ). The PDF is not stored (5.2B).
 */

// PostScript name of the embedded faces (`Inter-Regular`…), not the CSS family the sheet declares.
const PDF_FONT_PREFIX = "Inter";

export type PdfExportError = "not_found" | "not_ready" | "not_renderable" | "render_failed";

export type PdfExportResult =
  | { ok: true; pdf: Uint8Array; filename: string; contentDisposition: string; pageCount: number; timings: PdfRenderResult["timings"] & { prepareMs: number; validateMs: number } }
  | { ok: false; code: PdfExportError };

export interface PdfExportDeps {
  service: ServiceDeps;
  visuals?: VisualDeps;
  engine: PdfEngine;
}

export async function exportAdaptationPdf(deps: PdfExportDeps, actor: Actor, adaptationId: string): Promise<PdfExportResult> {
  const started = performance.now();
  const loaded = await loadRenderInputWith(deps.service, actor, adaptationId, deps.visuals, { pin: true });
  if (loaded.kind === "not_found") return { ok: false, code: "not_found" };
  if (loaded.kind === "not_ready") return { ok: false, code: "not_ready" };
  if (loaded.kind === "invalid_document") return { ok: false, code: "not_renderable" };

  // Exactly what the student view refuses to show, the PDF refuses to print.
  const { model, validation } = sheetModel(loaded, "student");
  if (validation.status === "not_renderable") return { ok: false, code: "not_renderable" };

  let result: PdfRenderResult;
  let prepareMs: number;
  let images: number;
  try {
    const print = await renderPrintHtml(model, loaded.pinned);
    prepareMs = performance.now() - started;
    images = print.assets.length;
    result = await deps.engine.render(print.html, { fontFamily: print.fontFamily, fontWeights: print.fontWeights });
  } catch (error) {
    logger.error("pdf_export_failed", { adaptationId, stage: "render", reason: error instanceof PdfEngineError ? error.code : error instanceof Error ? error.name : "unknown" });
    return { ok: false, code: "render_failed" };
  }

  const validateStarted = performance.now();
  const check = await validatePdf(result.pdf, { fontPrefix: PDF_FONT_PREFIX, minImages: images, minPages: model.pages.length });
  const validateMs = performance.now() - validateStarted;
  if (!check.ok) {
    logger.error("pdf_export_failed", { adaptationId, stage: "validation", reason: check.issues.join(",") });
    return { ok: false, code: "render_failed" };
  }

  const { filename, header } = pdfContentDisposition(model.title);
  logger.info("pdf_exported", { adaptationId, version: loaded.version.version, pages: check.pageCount, bytes: check.byteSize, totalMs: Math.round(performance.now() - started) });
  return { ok: true, pdf: result.pdf, filename, contentDisposition: header, pageCount: check.pageCount, timings: { ...result.timings, prepareMs, validateMs } };
}
