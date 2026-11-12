import { z } from "zod";

/**
 * Informe de preparación del análisis (shadow mode, v1). Lo calcula el servidor al terminar un análisis, SOLO a partir del
 * análisis y del propio archivo (nunca de un perfil ni de un alumno), y viaja en `materials.analysis_meta.readiness`.
 *
 * Privado y pequeño por construcción: códigos, identificadores técnicos del análisis (`act_3`, `vis_2`…), estados y recuentos.
 * Ningún texto del material ni dato personal tiene sitio en este esquema: no hay campos de texto libre, todo es un vocabulario
 * cerrado. En modo sombra solo se registra: nada lo lee para bloquear ni para cambiar el comportamiento.
 */

export const READINESS_VERSION = 1;
export const READINESS_ENGINE = "analysis_readiness@v1";

export const READINESS_UNAVAILABLE_REASONS = ["not_pdf", "pdf_unreadable", "timeout", "extraction_failed"] as const;
export const TEXT_LAYER_STATES = ["present", "partial", "absent", "not_applicable"] as const;
export const FIDELITY_STATES = ["ok", "review", "not_applicable"] as const;
export const FIDELITY_NA_REASONS = ["no_text_layer", "image_source", "unavailable", "nothing_to_check"] as const;

export const FINDING_CODES = [
  "source_no_text_layer",
  "source_partial_text_layer",
  "text_not_in_source",
  "activity_not_in_source",
  "table_cell_not_in_source",
  "visual_label_not_in_source",
  "number_not_in_source",
  "picture_reference_without_resource",
  "required_visual_unused",
  "answer_area_unknown",
  "inferred_answer",
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

/** `info`: a fact worth knowing; `review`: something a person or a later step should look at. Neither blocks anything. */
export const FindingSchema = z.object({
  code: z.enum(FINDING_CODES),
  severity: z.enum(["info", "review"]),
  /** Technical id of the analysis (`act_3`, `vis_2`, `ctt_1`), when the finding is about one element. */
  target: z.string().regex(/^(act|ctt|vis|prt|obj|sec|unc)_[0-9]{1,4}$/).optional(),
  /** How many elements (when the finding groups several, e.g. numbers not found in one activity). */
  count: z.number().int().min(1).max(999).optional(),
}).strict();

/**
 * What the analysis ALONE tells about how to get a visual back (a hint, never a promise and never a verdict of viability):
 * the data is already in the analysis (table or chart), a chain of labelled boxes is claimed (needs the original to confirm it),
 * a simple mathematical figure is claimed, it is decorative, or it still needs the original's pixels (the locator decides later).
 */
export const VISUAL_HINTS = ["data_in_analysis", "flow_claim", "structured_claim", "not_needed", "needs_original"] as const;
export const VisualHintSchema = z.object({ id: z.string().regex(/^vis_[0-9]{1,4}$/), hint: z.enum(VISUAL_HINTS), required: z.boolean() }).strict();

const Count = z.number().int().min(0).max(9999);

export const AnalysisReadinessSchema = z.object({
  version: z.literal(READINESS_VERSION),
  engine: z.string().max(40),
  status: z.enum(["computed", "unavailable"]),
  reason: z.enum(READINESS_UNAVAILABLE_REASONS).optional(),
  source: z.object({
    kind: z.enum(["pdf", "image"]),
    pages: Count,
    pages_read: Count,
    text_layer: z.enum(TEXT_LAYER_STATES),
    pages_without_text: Count,
  }).strict(),
  fidelity: z.object({
    status: z.enum(FIDELITY_STATES),
    reason: z.enum(FIDELITY_NA_REASONS).optional(),
    checked: z.object({ texts: Count, activities: Count, cells: Count, labels: Count, numbers: Count }).strict(),
    missing: z.object({ texts: Count, activities: Count, cells: Count, labels: Count, numbers: Count }).strict(),
    skipped_math: Count,
  }).strict(),
  references: z.object({
    activities: Count,
    activities_with_resources: Count,
    picture_references_without_resource: Count,
    required_visuals_unused: Count,
    answer_area_unknown: Count,
    inferred_answers: Count,
  }).strict(),
  visuals: z.array(VisualHintSchema).max(40),
  findings: z.array(FindingSchema).max(30),
}).strict();
export type AnalysisReadiness = z.infer<typeof AnalysisReadinessSchema>;
export type ReadinessFinding = z.infer<typeof FindingSchema>;
