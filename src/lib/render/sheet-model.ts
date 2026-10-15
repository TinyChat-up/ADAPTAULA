import type { MaterialDocument } from "@/lib/schemas/material-document";
import { buildRenderModel, type BuildRenderOptions, type RenderMode } from "./model";

export type SheetInput = {
  document: MaterialDocument;
  subjectName: string | null;
} & Pick<BuildRenderOptions, "requiredVisuals" | "assets" | "figures" | "assetFailures" | "resources" | "generated" | "deferred">;

export const PRODUCT_DESIGN = "claro" as const;

/** One pure projection for the viewer, the editor and PDF. It never includes the answer key. */
export function sheetModel(loaded: SheetInput, mode: RenderMode) {
  return buildRenderModel(loaded.document, { mode, design: PRODUCT_DESIGN, requiredVisuals: loaded.requiredVisuals, assets: loaded.assets, figures: loaded.figures, assetFailures: loaded.assetFailures, resources: loaded.resources, generated: loaded.generated, deferred: loaded.deferred, subjectLabel: loaded.subjectName });
}
