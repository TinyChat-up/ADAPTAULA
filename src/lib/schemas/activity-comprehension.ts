import { z } from "zod";
import { MaterialAnalysisDraftSchema, RESPONSE_FORMATS } from "./material-analysis";

export const ACTIVITY_COMPREHENSION_VERSION = 1;

const OPERATIONS = [
  "recall", "identify", "locate_evidence", "infer", "compare", "classify", "sequence",
  "interpret_visual", "choose_procedure", "calculate", "justify", "evaluate", "compose", "represent",
] as const;
const DECISIONS = [
  "select_data", "choose_procedure", "order_steps", "infer_conclusion", "choose_criterion",
  "classify_items", "interpret_relation", "select_evidence", "formulate_argument", "compose_text",
] as const;
const EVALUATION = [
  "accuracy", "conceptual_understanding", "procedure", "reasoning", "argumentation",
  "written_production", "reading_comprehension", "interpretation", "response_format",
] as const;
const CONDITIONS = [
  "required_data", "units", "method", "reasoning", "response_length",
  "response_format", "required_terms", "representation", "other",
] as const;
const FIELDS = [
  "objectives", "operations", "student_decisions", "information", "essential_resources",
  "response_format_role", "evaluation", "conditions",
] as const;
const REASONS = [
  "ambiguous", "unreadable", "not_stated", "unverified_evidence", "unavailable_resource_data",
] as const;

const LocalId = z.string().trim().min(1).max(12);
const ActivityId = z.string().regex(/^act_[0-9]{1,4}$/);
const ResourceId = z.string().regex(/^(ctt|vis)_[0-9]{1,4}$/);
const ObjectiveId = z.string().regex(/^obj_[0-9]{1,4}$/);
const UncertaintyId = z.string().regex(/^unc_[0-9]{1,4}$/);
const Quote = z.string().trim().min(1).max(240);
const FormatRole = z.enum(["access", "assessed"]);
const Uncertainty = z.object({ field: z.enum(FIELDS), reason: z.enum(REASONS) }).strict();

const DraftEvidence = z.object({
  source_ref: LocalId,
  quote: Quote.nullable(),
}).strict();

const StoredEvidence = z.object({
  source_ref: z.union([ActivityId, ResourceId]),
  page: z.number().int().min(1).max(500),
  quote: Quote.nullable(),
}).strict();

const Claims = <E extends typeof DraftEvidence | typeof StoredEvidence>(evidence: E) => ({
  operations: z.array(z.object({ kind: z.enum(OPERATIONS), evidence }).strict()).max(8),
  student_decisions: z.array(z.object({ kind: z.enum(DECISIONS), evidence }).strict()).max(8),
  information: z.array(evidence).max(8),
  evaluation: z.array(z.object({ kind: z.enum(EVALUATION), evidence }).strict()).max(8),
  conditions: z.array(z.object({ kind: z.enum(CONDITIONS), evidence }).strict()).max(8),
});
const DraftComprehension = z.object({
  objectives: z.array(z.object({ objective_ref: LocalId, basis: z.enum(["explicit", "interpreted"]), evidence: DraftEvidence }).strict()).max(6),
  ...Claims(DraftEvidence),
  essential_resources: z.array(z.object({ resource_ref: LocalId, evidence: DraftEvidence }).strict()).max(8),
  response_format_role: z.object({ kind: FormatRole, evidence: DraftEvidence }).strict().nullable(),
  uncertainties: z.array(Uncertainty).max(16),
}).strict();

// The published V3 schema is untouched. The new analyzer cannot return a solution.
const V4DraftActivity = MaterialAnalysisDraftSchema.shape.activities.element.omit({ answer: true }).extend({
  comprehension: DraftComprehension,
}).strict();
export const MaterialAnalysisV4DraftSchema = MaterialAnalysisDraftSchema.extend({
  activities: z.array(V4DraftActivity).max(150),
});
export type MaterialAnalysisV4Draft = z.infer<typeof MaterialAnalysisV4DraftSchema>;

export const ActivityComprehensionSchema = z.object({
  activity_id: ActivityId,
  objectives: z.array(z.object({ objective_ref: ObjectiveId, basis: z.enum(["explicit", "interpreted"]), evidence: StoredEvidence }).strict()).max(6),
  ...Claims(StoredEvidence),
  essential_resources: z.array(z.object({ resource_ref: ResourceId, evidence: StoredEvidence }).strict()).max(8),
  response: z.object({
    format: z.enum(RESPONSE_FORMATS),
    format_role: z.object({ kind: FormatRole, evidence: StoredEvidence }).strict().nullable(),
  }).strict(),
  uncertainties: z.array(Uncertainty).max(FIELDS.length * REASONS.length),
  original_uncertainty_ids: z.array(UncertaintyId).max(30),
}).strict();
export const ActivityComprehensionDocumentSchema = z.object({
  version: z.literal(ACTIVITY_COMPREHENSION_VERSION),
  activities: z.array(ActivityComprehensionSchema).max(150),
}).strict();

export type ActivityComprehension = z.infer<typeof ActivityComprehensionSchema>;
export type ActivityComprehensionDocument = z.infer<typeof ActivityComprehensionDocumentSchema>;
export { StoredEvidence as ActivityEvidenceSchema };
export type ActivityEvidence = z.infer<typeof StoredEvidence>;
