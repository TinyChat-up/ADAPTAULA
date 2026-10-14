import type { PageModel } from "./page-model";
import type { Located, VisualTarget } from "./locate";

/**
 * PR #30 audit: connectivity, ink, size and uniqueness cannot distinguish a figure from a glyph/logo, associate it with an
 * activity, or certify its labels/completeness. The analysis is the claim, not independent evidence. Until an independently
 * verifiable identity contract exists, a textless page MUST NOT produce an automatic crop. A human locator remains supported.
 * Reject before traversing pixels: the discarded full-resolution component heuristic also had unbounded component/row costs.
 */
export const SCAN_METHOD = "scan_identity_gate@v2";
export type ScanReason = "scan_has_text_layer" | "scan_not_sole_visual" | "scan_identity_unverified";
export interface ScanSignals {
  method: typeof SCAN_METHOD;
  /** An analysis claim only; never a replacement for an activity anchor. */
  sole_visual: boolean;
  identity_verified: false;
}
export interface ScanContext {
  visualsOnPage: number;
  required: boolean;
}

export function locateOnScan(model: PageModel, target: VisualTarget, context: ScanContext): Located {
  const sole = context.visualsOnPage === 1 && context.required;
  return {
    visualId: target.id, bounds: null, confidence: 0, accepted: false,
    evidence: {
      shape: target.shape, signature: false, placement: false, unique: false, clean: false, anchor: null,
      vision: { used: false, agrees: false, confidence: null, iou: null },
      scan: { method: SCAN_METHOD, sole_visual: sole, identity_verified: false },
      reason: model.texts.length > 0 ? "scan_has_text_layer" : !sole ? "scan_not_sole_visual" : "scan_identity_unverified",
    },
  };
}

/** Existing v3 scan crops remain in the audit trail, but cannot be served, retried or used by a PDF pin. */
export function isUnverifiedScanLocator(locator: { method: string; evidence?: unknown } | null | undefined): boolean {
  if (locator?.method !== "auto" || !locator.evidence || typeof locator.evidence !== "object") return false;
  return "scan" in locator.evidence;
}
