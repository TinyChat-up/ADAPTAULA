import type { VisualSpec } from "@/lib/visuals/spec";

/**
 * What the renderer knows about the original visuals of a sheet: for each `vis_N`, either an authorised image source (or a
 * verified reconstruction) or the reason there is none. Who located the visual (a person, or the validated automatic locator)
 * only decides WHICH ready form is used (`VisualResolution`). Production and storage live in `src/lib/materials/visuals/`.
 */

export const VISUAL_ASSET_FAILURES = [
  "source_missing",
  "page_missing",
  "geometry_missing",
  "invalid_bounds",
  "extraction_failed",
  "unsupported_source",
  "asset_missing",
  "asset_corrupt",
] as const;
export type VisualAssetFailure = (typeof VISUAL_ASSET_FAILURES)[number];

/** Teacher-facing, safe, short: an asset problem, never a pedagogical one. */
export const FAILURE_COPY: Record<VisualAssetFailure, string> = {
  source_missing: "no se encuentra el archivo original o ha cambiado",
  page_missing: "la página no existe en el original",
  geometry_missing: "todavía no se ha señalado dónde está en el original",
  invalid_bounds: "la zona señalada ya no corresponde a la página",
  extraction_failed: "no se pudo recortar la imagen; se puede reintentar",
  unsupported_source: "este tipo de archivo no permite recortar imágenes",
  asset_missing: "el recorte no está disponible",
  asset_corrupt: "el recorte guardado está dañado",
};

/** State of one visual for the teacher view. `located_processing`: located, recorte not produced yet (or being produced). */
export type VisualStatus = "missing_locator" | "located_processing" | "ready" | "extraction_failed";

/**
 * How a visual reaches the sheet, decided explicitly and auditable (docs/VISUAL_RESOURCES.md § Elección automática):
 *   A · the original as a PERSON located it (their crop, untouched);
 *   B · the original as the automatic locator found it (original pixels, tight crop, printed at its physical size);
 *   C · a verified reconstruction (VisualSpec) of an automatically located mathematical figure, drawn by our renderer;
 *   D · unavailable (not located, or its crop failed): an essential one stops the sheet honestly.
 */
export type VisualResolution = "A" | "B" | "C" | "D";

export interface VisualState {
  visualId: string;
  status: VisualStatus;
  failure?: VisualAssetFailure;
  /** Minimal provenance for the teacher: which page and revision, located how. Never storage paths or signed URLs. */
  provenance?: { page: number; revision: number; method: "human" | "auto"; confidence?: number };
  resolution?: VisualResolution;
  /** Choice C: the verified spec (checked against its stored sha-256). */
  spec?: VisualSpec;
  /** Physical width of the crop in the original, in mm (recipe density), for printing it at its own size. */
  widthMm?: number;
  /** Its physical height, in mm: what it really takes on the page when the sheet is paginated. */
  heightMm?: number;
}

export function failureOfState(state: VisualState): VisualAssetFailure | undefined {
  if (state.status === "ready") return undefined;
  if (state.status === "missing_locator") return "geometry_missing";
  if (state.status === "located_processing") return "asset_missing";
  return state.failure ?? "extraction_failed";
}
