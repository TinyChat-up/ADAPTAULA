import { z } from "zod";
import type { LocateReport } from "../visual-location/locate-v2";

/**
 * Phase III human-review contract for a figure candidate (experimental, NOT wired to Hacer magia nor to any UI).
 *
 * The locator (`figure_geometry@v2`) only proposes a region and always blocks. A teacher may then confirm, correct or reject it,
 * and that decision is bound to exactly what the teacher saw: the material version (sha-256 of the source file), the page, the
 * normalised region and the sha-256 of the rendered crop. If any of them changes the confirmation stops being valid. A confirm
 * needs the three checks ticked explicitly; pressing «Aceptar» without the crop having been shown is not a confirmation.
 */

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const unit = z.number().min(0).max(1);
export const RegionSchema = z.object({ x: unit, y: unit, w: unit.positive(), h: unit.positive() }).refine((r) => r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, "la región se sale de la página");
export type Region = z.infer<typeof RegionSchema>;

export const FigureReviewRequestSchema = z.object({
  materialSha256: sha256,
  page: z.number().int().min(1),
  activityId: z.string().min(1),
  visualId: z.string().min(1),
  region: RegionSchema,
  /** sha-256 of the crop rendered from `region` and shown to the teacher. */
  cropSha256: sha256,
  locatorVersion: z.string().min(1),
  shownAt: z.string().datetime({ offset: true }),
});
export type FigureReviewRequest = z.infer<typeof FigureReviewRequestSchema>;

/** The three things the teacher states about what they see; each must be ticked, never defaulted. */
const ConfirmedChecks = z.object({ belongsToActivity: z.literal(true), complete: z.literal(true), noAnswers: z.literal(true) }).strict();

export const FigureReviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("confirm"), checks: ConfirmedChecks }),
  /** A corrected region is a NEW candidate: it must be rendered, shown and confirmed in a review of its own. */
  z.object({ decision: z.literal("correct"), correctedRegion: RegionSchema }),
  z.object({ decision: z.literal("reject"), reason: z.enum(["no_es_de_la_actividad", "incompleta", "contiene_respuestas", "no_es_una_figura", "otra"]) }),
]);

export const FigureReviewSchema = z.object({
  request: FigureReviewRequestSchema,
  /** sha-256 of the crop the client actually displayed when the decision was taken (reported by the viewer, checked here). */
  viewedCropSha256: sha256,
  decidedAt: z.string().datetime({ offset: true }),
  reviewer: z.literal("docente"),
  outcome: FigureReviewDecisionSchema,
});
export type FigureReview = z.infer<typeof FigureReviewSchema>;

/** What exists now for that material: the confirmation is only valid against exactly this. */
export interface CurrentFigureState {
  materialSha256: string;
  page: number;
  activityId: string;
  visualId: string;
  region: Region;
  cropSha256: string;
}

export type ReviewValidity =
  | { valid: true }
  | { valid: false; reasons: string[] };

const sameRegion = (a: Region, b: Region, tol = 1e-6) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;

/** Whether a stored review still confirms the figure as it exists now. Anything but a fully valid confirm is not valid. */
export function isConfirmationValid(raw: unknown, current: CurrentFigureState): ReviewValidity {
  const parsed = FigureReviewSchema.safeParse(raw);
  if (!parsed.success) return { valid: false, reasons: ["revisión incompleta o mal formada: " + parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")] };
  const r = parsed.data;
  const reasons: string[] = [];
  if (r.outcome.decision === "correct") reasons.push("la región fue corregida: la nueva región necesita su propia revisión");
  if (r.outcome.decision === "reject") reasons.push(`la figura fue rechazada (${r.outcome.reason})`);
  if (r.viewedCropSha256 !== r.request.cropSha256) reasons.push("lo que se mostró no es el recorte que se aprueba");
  if (Date.parse(r.decidedAt) < Date.parse(r.request.shownAt)) reasons.push("decisión anterior a mostrar el recorte");
  if (r.request.materialSha256 !== current.materialSha256) reasons.push("el documento ha cambiado");
  if (r.request.page !== current.page) reasons.push("la página ha cambiado");
  if (r.request.activityId !== current.activityId || r.request.visualId !== current.visualId) reasons.push("la figura ya no corresponde a la misma actividad");
  if (!sameRegion(r.request.region, current.region)) reasons.push("la región ha cambiado");
  if (r.request.cropSha256 !== current.cropSha256) reasons.push("el recorte ha cambiado");
  return reasons.length ? { valid: false, reasons } : { valid: true };
}

/**
 * Builds the request to show a teacher from a Phase II locator report. The report's `candidate` is only a proposal (decision
 * is always `blocked`, `crop` always null); without a candidate there is nothing to review.
 */
export function reviewRequestFromLocator(
  report: Pick<LocateReport, "visualId" | "candidate" | "verifier" | "decision" | "crop">,
  context: { materialSha256: string; page: number; activityId: string; cropSha256: string; shownAt: string },
): FigureReviewRequest | null {
  if (!report.candidate) return null;
  return FigureReviewRequestSchema.parse({ ...context, visualId: report.visualId, region: report.candidate, locatorVersion: report.verifier });
}
