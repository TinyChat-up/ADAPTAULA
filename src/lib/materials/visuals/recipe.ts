import { z } from "zod";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { NormalizedBoundsSchema } from "./geometry";

/**
 * VisualLocator v1 (where a visual is in the original) and the crop recipe (how the server turns it into an image).
 *
 * Recipe `visual_crop@v1` — audited values:
 *   · 200 ppp: A4 at 1654×2339 px; a figure of a quarter of the page printed at its original size keeps ~200 ppp, enough for
 *     school laser/inkjet printing of lines and small labels. 300 ppp would double the bytes with no visible gain at that size.
 *   · margin 1 % of the page's shorter side (~2 mm on A4) on each side, clamped to the page: covers anti-aliased strokes on the
 *     edge of a careful selection without dragging in neighbouring text.
 *   · max 4096 px on the long side of the rendered page (an A3 page at 200 ppp is 3307 px): a bound, never an upscale.
 *   · PNG always: lossless for lines and text inside diagrams; JPEG would blur them.
 * Changing any value is a new recipe version: old assets stay as they were, new ones get another identity.
 */
export const VISUAL_CROP_RECIPE = { version: "visual_crop@v1", dpi: 200, margin: 0.01, max_px: 4096, format: "image/png" } as const;
export const recipeFingerprint = (recipe = VISUAL_CROP_RECIPE) => fingerprint(recipe);

export const LOCATOR_VERSION = 1;
export const LOCATOR_METHODS = ["human"] as const;

const Hex64 = z.string().regex(/^[a-f0-9]{64}$/);

export const VisualLocatorSchema = z.object({
  locator_version: z.literal(LOCATOR_VERSION),
  material_id: z.uuid(),
  analysis_fingerprint: Hex64,
  visual_id: z.string().regex(/^vis_[0-9]{1,4}$/),
  source_sha256: Hex64,
  revision: z.number().int().positive(),
  method: z.enum(LOCATOR_METHODS),
  page: z.number().int().min(1).max(500),
  bounds: NormalizedBoundsSchema,
});
export type VisualLocator = z.infer<typeof VisualLocatorSchema>;

/**
 * The asset's logical identity: every input of the crop (material, source file, analysis, visual, locator revision, page,
 * coordinates) plus the recipe. Same inputs → same identity (idempotent production); a correction, another analysis or another
 * source file → another identity. No adaptation id: one crop serves every adaptation of that material and analysis.
 */
export function assetIdentity(locator: VisualLocator, recipe = VISUAL_CROP_RECIPE): string {
  return fingerprint({
    locator: {
      v: locator.locator_version,
      material: locator.material_id,
      source: locator.source_sha256,
      analysis: locator.analysis_fingerprint,
      visual: locator.visual_id,
      revision: locator.revision,
      page: locator.page,
      bounds: locator.bounds,
    },
    recipe: recipeFingerprint(recipe),
  });
}

/** Deterministic object path: workspace first (the storage policy reads it), no names, no human-readable data. */
export const assetPath = (workspaceId: string, materialId: string, identity: string) => `${workspaceId}/${materialId}/visuals/${identity}.png`;
