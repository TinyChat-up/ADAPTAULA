import { FAILURE_COPY, type VisualAssetFailure } from "@/lib/render/visual-assets";

/** The service's result, structurally (this module is imported by the browser and must not reach server code). */
type VisualResult =
  | { ok: true; status: "ready"; revision: number }
  | { ok: true; status: "extraction_failed"; failure: VisualAssetFailure; revision: number }
  | { ok: false; code: string };

/** What the selection tool is told. Short Spanish copy; never a storage path, a stack or a provider. */
export type VisualActionResult =
  | { ok: true; status: "ready"; revision: number }
  | { ok: true; status: "extraction_failed"; message: string; revision: number }
  | { ok: false; message: string };

export const VISUAL_MESSAGES = {
  forbidden: "No tienes permiso para cambiar este material.",
  not_found: "No hemos encontrado ese recurso.",
  invalid: "La zona seleccionada no es válida. Selecciona un rectángulo dentro de la página.",
} as const;

export function toPublicVisualResult(result: VisualResult): VisualActionResult {
  if (result.ok) return result.status === "ready" ? result : { ok: true, status: "extraction_failed", message: `No se pudo preparar el recorte: ${FAILURE_COPY[result.failure]}.`, revision: result.revision };
  const message = result.code in VISUAL_MESSAGES ? VISUAL_MESSAGES[result.code as keyof typeof VISUAL_MESSAGES] : `No se pudo localizar: ${FAILURE_COPY[result.code as keyof typeof FAILURE_COPY]}.`;
  return { ok: false, message };
}
