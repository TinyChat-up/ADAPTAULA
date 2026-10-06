/**
 * What the renderer knows about the original visuals of a sheet: for each `vis_N`, either an authorised image source or the
 * reason there is none. Who located the visual (a person today, another validated method tomorrow) is not the renderer's
 * business: it only sees `ready` + a source, or a failure. Production and storage live in `src/lib/materials/visuals/`.
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

export interface VisualState {
  visualId: string;
  status: VisualStatus;
  failure?: VisualAssetFailure;
  /** Minimal provenance for the teacher: which page and revision, located how. Never storage paths or signed URLs. */
  provenance?: { page: number; revision: number; method: "human" };
}

export function failureOfState(state: VisualState): VisualAssetFailure | undefined {
  if (state.status === "ready") return undefined;
  if (state.status === "missing_locator") return "geometry_missing";
  if (state.status === "located_processing") return "asset_missing";
  return state.failure ?? "extraction_failed";
}
