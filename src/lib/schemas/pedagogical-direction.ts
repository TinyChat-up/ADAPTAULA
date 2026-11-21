import { z } from "zod";
import { ActivityComprehensionSchema, ActivityEvidenceSchema } from "./activity-comprehension";
import { REGISTERS } from "./adaptation-context";
import { DimensionKeySchema } from "./functional-profile";
import { ABILITY_AUTONOMY } from "./pedagogical-profile";
import type { Executor } from "@/lib/recreation/contract";

const version = z.literal(1);
export const DirectorFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ActivityId = z.string().regex(/^act_[0-9]{1,4}$/);
const ObjectiveId = z.string().regex(/^obj_[0-9]{1,4}$/);
const ObligationRef = z.string().regex(/^(objective|resource|protected|operation|student_decision|information|evaluation|condition|response)_\d{1,4}$/);
const DECISIONS = ["keep", "facilitate", "transform", "substitute"] as const;

// Checked subset of the existing executors. The director hands off requirements, never an exercise or its answer.
const SUPPORTED_REPLACEMENTS = ["short_answer"] as const satisfies readonly Executor["kind"][];
const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["segment_instruction", "blank_workspace", "visual_navigation", "change_presentation", "new_illustration"]),
    need: DimensionKeySchema,
  }).strict(),
  z.object({ kind: z.literal("oral_response"), need: DimensionKeySchema }).strict(),
  z.object({
    kind: z.literal("replacement"),
    need: DimensionKeySchema,
    executor: z.enum([...SUPPORTED_REPLACEMENTS, "unavailable"]),
  }).strict(),
]);
export type DirectorChange = z.infer<typeof ChangeSchema>;

const ProposalActivitySchema = z.object({
  activity_id: ActivityId,
  decision: z.enum(DECISIONS),
  changes: z.array(ChangeSchema).max(5),
  retains: z.array(ObligationRef).max(350),
}).strict();
export type DirectorActivityProposal = z.infer<typeof ProposalActivitySchema>;

export const DirectorProposalSchema = z.object({
  version,
  activities: z.array(ProposalActivitySchema).max(150),
}).strict();

const ObligationSchema = z.object({
  ref: ObligationRef,
  kind: z.enum(["objective", "resource", "protected", "operation", "student_decision", "information", "evaluation", "condition", "response"]),
  value: z.string().max(60).nullable(),
  evidence: ActivityEvidenceSchema.nullable(),
}).strict();
export type DirectorObligation = z.infer<typeof ObligationSchema>;

const IssueSchema = z.object({
  code: z.enum(["source_uncertain", "profile_support_unresolved", "scope_forbids_change", "wrong_change_for_decision",
    "need_not_supported", "retention_missing", "retention_unknown", "response_protected",
    "fabrication_unavailable", "executor_incompatible"]),
  ref: z.string().max(80).nullable(),
}).strict();
export type DirectorIssue = z.infer<typeof IssueSchema>;

const OutputActivitySchema = ProposalActivitySchema.extend({
  page: z.number().int().min(1).max(500),
  original_response_format: ActivityComprehensionSchema.shape.response.shape.format,
  status: z.enum(["unchanged", "design_candidate", "needs_evidence", "rejected"]),
  equivalence: z.enum(["unchanged_source", "pending", "not_assessed"]),
  obligations: z.array(ObligationSchema).max(350),
  prohibition: z.array(z.enum(["change_objectives", "remove_evaluated_demand", "solve_for_student",
    "alter_source_resources", "infantilize", "change_response_format"])),
  learning: z.object({
    autonomy: z.array(z.object({
      objective_id: ObjectiveId,
      observation_index: z.number().int().min(0).max(9),
      autonomy: z.enum(ABILITY_AUTONOMY),
    }).strict()).max(1500),
    reinforcement_objectives: z.array(ObjectiveId).max(150),
  }).strict(),
  uncertainties: ActivityComprehensionSchema.shape.uncertainties,
  original_uncertainty_ids: ActivityComprehensionSchema.shape.original_uncertainty_ids,
  needs: z.array(z.object({
    dimension: DimensionKeySchema,
    level: z.enum(["low", "medium", "high"]),
  }).strict()).max(5),
  issues: z.array(IssueSchema),
  fabrication: z.object({
    requirements: z.array(z.enum(["preserve_source", "split_instruction_verbatim", "unlabelled_workspace",
      "navigation_without_clues", "age_appropriate_layout", "oral_response_space", "recreation_executor",
      "original_resources", "check_rendered_output", "semantic_review", "check_fit_to_declared_learning"])),
  }).strict(),
});
export type DirectorActivity = z.infer<typeof OutputActivitySchema>;

export const PedagogicalDirectionSchema = z.object({
  version,
  original_sha256: DirectorFingerprintSchema,
  analysis_fingerprint: DirectorFingerprintSchema,
  context_fingerprint: DirectorFingerprintSchema,
  profile_fingerprint: DirectorFingerprintSchema,
  scope: z.enum(["accessibility", "methodological"]),
  audience_register: z.enum(REGISTERS),
  verified_subject: z.string().max(80).nullable(),
  activities: z.array(OutputActivitySchema).max(150),
}).strict();
