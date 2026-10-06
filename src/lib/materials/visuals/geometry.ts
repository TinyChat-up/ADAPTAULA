import { z } from "zod";

/**
 * The one coordinate system of visual locators, shared by the selection tool (browser) and the crop producer (server), so both
 * read a rectangle the same way:
 *
 *   · The reference surface is the page AS SHOWN: for a PDF, its visible box (CropBox, falling back to MediaBox) with the page's
 *     /Rotate already applied; for an uploaded image, the image itself (one logical page).
 *   · Origin top-left, x to the right, y DOWN (screen convention, not PDF user space), all four values normalised to 0–1 of
 *     that surface's width and height.
 *
 * The browser never computes this from PDF internals: it draws on a server-rendered image of exactly that surface (the same
 * rasteriser and viewport as the crop, only at a lower density), so a rectangle over the preview at any zoom or screen size is
 * the same rectangle on the 200 ppp page the producer crops. Rotation and CropBox are resolved once, by the rasteriser.
 */

/** Smallest side a selection may have (2 % of the page side): smaller is a mis-click, not a figure. */
export const MIN_SIDE = 0.02;
const EPS = 1e-6;

const unit = z.number().finite().min(0).max(1);
export const NormalizedBoundsSchema = z
  .object({ x: unit, y: unit, w: unit, h: unit })
  .refine((b) => b.w >= MIN_SIDE && b.h >= MIN_SIDE, { message: "La selección es demasiado pequeña" })
  .refine((b) => b.x + b.w <= 1 + EPS && b.y + b.h <= 1 + EPS, { message: "La selección se sale de la página" });
export type NormalizedBounds = z.infer<typeof NormalizedBoundsSchema>;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Two corners of a drag (any direction, possibly outside the page) → a normalised, clamped rectangle. */
export function boundsFromCorners(a: { x: number; y: number }, b: { x: number; y: number }): NormalizedBounds {
  const x0 = clamp01(Math.min(a.x, b.x));
  const y0 = clamp01(Math.min(a.y, b.y));
  const x1 = clamp01(Math.max(a.x, b.x));
  const y1 = clamp01(Math.max(a.y, b.y));
  return { x: round6(x0), y: round6(y0), w: round6(x1 - x0), h: round6(y1 - y0) };
}

/** A pointer position over a displayed page (any zoom) → normalised coordinates of the page. */
export const toNormalized = (clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) => ({
  x: rect.width > 0 ? (clientX - rect.left) / rect.width : 0,
  y: rect.height > 0 ? (clientY - rect.top) / rect.height : 0,
});

/**
 * The technical margin around a crop so a stroke on the edge is not cut: a fixed fraction of the page's SHORTER side (the same
 * physical distance on both axes), clamped to the page. Never negative, never beyond the page, never more than that fraction.
 */
export function withMargin(b: NormalizedBounds, page: { width: number; height: number }, margin: number): NormalizedBounds {
  const m = margin * Math.min(page.width, page.height);
  const mx = m / page.width;
  const my = m / page.height;
  const x0 = clamp01(b.x - mx);
  const y0 = clamp01(b.y - my);
  const x1 = clamp01(b.x + b.w + mx);
  const y1 = clamp01(b.y + b.h + my);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Normalised rectangle → whole pixels of a raster: outward rounding (nothing selected is lost), clamped to the raster. */
export function pixelRect(b: NormalizedBounds, width: number, height: number) {
  const left = Math.max(0, Math.floor(b.x * width));
  const top = Math.max(0, Math.floor(b.y * height));
  const right = Math.min(width, Math.ceil((b.x + b.w) * width));
  const bottom = Math.min(height, Math.ceil((b.y + b.h) * height));
  return { left, top, width: right - left, height: bottom - top };
}
