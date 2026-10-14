import { z } from "zod";

/**
 * Prototype (Phase 8.2B.7, NOT wired to production): the typed contract of a figure-location PROPOSAL and of the server's
 * verification report. See docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md.
 *
 * A proposal is what a multimodal model would return (during the initial analysis, approach A): where the figure of an activity
 * is and what it must contain. Everything in it is a CLAIM. The report says, claim by claim, whether the server could check it
 * against pixels or text. These sources can share errors and do not establish semantic identity. A geometric candidate is
 * diagnostic only; no crop is accepted without independent evidence for the complete figure and answer safety.
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

/** Status of a limited check; `verified` is scoped to the check's detail, not semantic correctness. */
export type CheckStatus = "verified" | "failed" | "unverifiable";

export const CANDIDATE_CHECKS = [
  /** Caller-supplied hashes agree; this prototype does not hash stored bytes itself. */
  "provenance",
  /** The page has a text layer (the PDF's, or a local OCR's) to anchor anything. Without it nothing below is checkable. */
  "text_layer",
  /** The analyzed instruction matches OCR text on that page: an inferred zone exists. */
  "activity_anchor",
  /** The proposed region lies in the zone inferred from the OCR anchors found. Missing anchors may enlarge a zone. */
  "placement",
  /** The proposal lands on a server-detected region (IoU ≥ 0.5); a candidate uses that region, not the model's box. */
  "snap",
  /** It is the only drawing of comparable size in the zone (no second candidate the model could have meant). */
  "uniqueness",
  /** No detected stroke crosses the crop border; unlabelled missing parts cannot be detected. */
  "integrity",
  /** OCR boxes for claimed/instruction labels lie inside the candidate; the ink itself is not corroborated. */
  "labels",
  /** OCR did not find running text inside the candidate. */
  "foreign_text",
  /** Lexical screen against the analysis's expected answer; does not detect drawn or numeric answers. */
  "answer_leak",
  /** Shape or label evidence only; does not establish that the depicted content is correct. */
  "identity_evidence",
] as const;
export const SAFETY_CHECKS = ["semantic_identity", "complete_content", "visual_answer_safety"] as const;
export const CHECKS = [...CANDIDATE_CHECKS, ...SAFETY_CHECKS] as const;
export type CheckName = (typeof CHECKS)[number];

export interface VerificationReport {
  visualId: string;
  decision: "accepted" | "blocked";
  /** The server's crop when accepted (normalised), otherwise null. */
  crop: { x: number; y: number; w: number; h: number } | null;
  /** Geometric prefilter output only. Never serve this region as an approved crop. */
  candidate: { x: number; y: number; w: number; h: number } | null;
  checks: Record<CheckName, { status: CheckStatus; detail: string }>;
  /** Version of these rules: part of any cache key, with the proposal's prompt version, analysis fingerprint and source sha. */
  verifier: string;
}
