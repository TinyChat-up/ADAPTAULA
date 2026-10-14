import { z } from "zod";

/**
 * Prototype (Phase 8.2B.7, NOT wired to production): the typed contract of a figure-location PROPOSAL and of the server's
 * verification report. See docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md.
 *
 * A proposal is what a multimodal model would return (during the initial analysis, approach A): where the figure of an activity
 * is and what it must contain. Everything in it is a CLAIM. The report says, claim by claim, whether the server could check it
 * against something the model did not produce (pixels, a text layer, the analysis's own activity text, the original's hash), and
 * the decision follows from rules, never from a score: one mandatory check not verified → blocked.
 */

const Unit = z.number().finite().min(0).max(1);
export const RegionSchema = z.object({ x: Unit, y: Unit, w: Unit, h: Unit });

export const FigureProposalSchema = z.object({
  visual_id: z.string().regex(/^vis_[0-9]{1,4}$/),
  /** The activity that needs it (must exist in the analysis and list this visual). */
  activity_id: z.string().regex(/^act_[0-9]{1,4}$/),
  page: z.number().int().min(1),
  /** Normalised region on the page AS SHOWN (the locator surface of `geometry.ts`). A hypothesis: the server crops its own region. */
  region: RegionSchema,
  /** One sentence that would let a person pick it out ("célula ovalada con núcleo gris y tres líneas numeradas"). Never checked. */
  identity: z.string().min(3).max(300),
  kind: z.enum(["bar", "number_line", "figure"]),
  /** Printed labels that belong to the figure and must survive the crop ("1", "2", "3", "A", "1/4"). */
  labels: z.array(z.string().min(1).max(20)).max(20),
  /** Parts that must be inside (free text, for the reviewer only; not machine-checkable). */
  required_elements: z.array(z.string().min(1).max(80)).max(12),
  /** What the model itself was unsure of. Logged, never used to accept. */
  limitations: z.array(z.string().max(200)).max(6),
});
export type FigureProposal = z.infer<typeof FigureProposalSchema>;

/** Whether a claim could be checked independently of the model. `unverifiable` blocks exactly like `failed`. */
export type CheckStatus = "verified" | "failed" | "unverifiable";

export const CHECKS = [
  /** The proposal refers to this material version (sha-256 of the original) and a page that exists; region inside the page. */
  "provenance",
  /** The page has a text layer (the PDF's, or a local OCR's) to anchor anything. Without it nothing below is checkable. */
  "text_layer",
  /** The activity's own instruction (from the analysis) is found printed on that page: its zone exists. */
  "activity_anchor",
  /** The proposed region lies in that activity's zone, and in no other activity's zone. */
  "placement",
  /** The proposal lands on a drawing the server found by itself (IoU ≥ 0.5); the crop is the SERVER's region, not the box. */
  "snap",
  /** It is the only drawing of comparable size in the zone (no second candidate the model could have meant). */
  "uniqueness",
  /** No stroke crosses the crop border and the drawing does not touch the page edge: nothing is cut off. */
  "integrity",
  /** Every label the proposal claims, and every number/letter the instruction says the figure shows, is printed inside the crop. */
  "labels",
  /** No running text (instruction, another activity, student fields) inside the crop. */
  "foreign_text",
  /** No word of the activity's expected answer is printed inside the crop (the figure would give the solution away). */
  "answer_leak",
  /** Content evidence beyond position: the shape's pixel signature (bar, number line) or the instruction's labels found inside. */
  "identity_evidence",
] as const;
export type CheckName = (typeof CHECKS)[number];

export interface VerificationReport {
  visualId: string;
  decision: "accepted" | "blocked";
  /** The server's crop when accepted (normalised), otherwise null. */
  crop: { x: number; y: number; w: number; h: number } | null;
  checks: Record<CheckName, { status: CheckStatus; detail: string }>;
  /** Version of these rules: part of any cache key, with the proposal's prompt version, analysis fingerprint and source sha. */
  verifier: string;
}
