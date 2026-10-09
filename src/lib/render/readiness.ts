import "server-only";
import { blockingNeeds, visualNeedsOf } from "@/lib/adaptation/presentation/visual-needs";
import { sheetModel, type RenderLoad } from "./load";

/**
 * Whether a delivered sheet can be printed, decided ONCE and used everywhere (the adaptation screen, the sheet view, the lists and
 * the PDF export): exactly what the student view and the PDF accept. A sheet waiting for an essential visual is «casi lista»,
 * never «lista», and its PDF is refused as `resource_pending` (a known, fixable cause), never as a technical failure.
 */
export interface SheetReadiness {
  printable: boolean;
  /** Essential visuals still to locate or to provide. */
  pendingResources: number;
  /** Why it cannot be printed: a resource the teacher can complete, or something in the stored document itself. */
  reason: "resource_pending" | "document" | null;
}

export function readinessOf(loaded: Extract<RenderLoad, { kind: "ok" }>): SheetReadiness {
  const pending = blockingNeeds(visualNeedsOf(loaded)).length;
  const { validation } = sheetModel(loaded, "student");
  if (validation.status !== "not_renderable" && pending === 0) return { printable: true, pendingResources: 0, reason: null };
  return { printable: false, pendingResources: pending, reason: pending > 0 ? "resource_pending" : "document" };
}
