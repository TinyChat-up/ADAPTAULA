import "server-only";
import { z } from "zod";
import { buildAdaptationContext, contextFingerprint, type ContextInput } from "@/lib/adaptation/context";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { checkPedagogicalScope } from "@/lib/adaptation/pedagogical-scope";
import { PRESENTATION_DIMENSIONS } from "@/lib/adaptation/strategies";
import { MaterialAnalysisV4Schema } from "@/lib/analysis/activity-comprehension";
import { profileForSubject } from "@/lib/profiles/subject-profile";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import {
  DirectorFingerprintSchema, DirectorProposalSchema, PedagogicalDirectionSchema, type DirectorActivity, type DirectorChange,
} from "@/lib/schemas/pedagogical-direction";
import { learningEvidence, sourceObligations } from "./director-evidence";
import { defaultProposal, verifyDirection } from "./director-policy";

export interface DirectorInput {
  /** Use the persisted analysis tied to this original by the server. Historical rows are not reinterpreted. */
  analysis: unknown;
  originalSha256: string;
  profile: FunctionalProfile;
  /** A verified catalog match from the caller, never a subject inferred by the analysis model. */
  verifiedSubject: string | null;
  education: Omit<ContextInput["education"], "subject">;
  /** The teacher's trusted per-sheet choice. Preferences in the learner profile do not authorize changes. */
  authorization: unknown;
}

type Directed = { ok: true; direction: z.infer<typeof PedagogicalDirectionSchema> };
type Blocked = { ok: false; code: "invalid_source_identity" | "v4_required" | "no_activities" |
  "invalid_authorization" | "scope_unavailable" | "invalid_proposal" };

type Requirements = DirectorActivity["fabrication"]["requirements"];

const FABRICATION: Partial<Record<DirectorChange["kind"], Requirements[number]>> = {
  segment_instruction: "split_instruction_verbatim",
  blank_workspace: "unlabelled_workspace",
  visual_navigation: "navigation_without_clues",
  change_presentation: "age_appropriate_layout",
  oral_response: "oral_response_space",
  replacement: "recreation_executor",
};

/** Builds a decision for every activity. Optional candidates suggest individual decisions; they never set evidence or rules. */
export function directPedagogy(input: DirectorInput, candidate?: unknown): Directed | Blocked {
  if (!DirectorFingerprintSchema.safeParse(input.originalSha256).success) return { ok: false, code: "invalid_source_identity" };
  const parsed = MaterialAnalysisV4Schema.safeParse(input.analysis);
  if (!parsed.success) return { ok: false, code: "v4_required" };
  const { base: analysis, comprehension } = parsed.data;
  if (analysis.activities.length === 0) return { ok: false, code: "no_activities" };
  const authorization = checkPedagogicalScope(input.authorization, analysis);
  if (!authorization.ok) return { ok: false, code: "invalid_authorization" };
  const scope = authorization.choice.type;
  if (scope === "curricular") return { ok: false, code: "scope_unavailable" };

  const verifiedSubject = input.verifiedSubject;
  const profile = profileForSubject(input.profile, verifiedSubject);
  const { context } = buildAdaptationContext({
    profile: input.profile, analysis, education: { ...input.education, subject: verifiedSubject },
    adaptationType: scope, sheet: { scope, subjectSlug: verifiedSubject },
  });
  const subjectStage = analysis.identification.stage.value;
  const audienceRegister = context.audience.register === "young_adult" || subjectStage === "bachillerato" ? "young_adult" :
    context.audience.register === "adolescent" || subjectStage === "eso" ? "adolescent" : "child";
  const needs = new Map(context.needs.map(({ dimension, level }) => [dimension, level]));
  for (const dimension of PRESENTATION_DIMENSIONS) {
    const level = profile.supports[dimension];
    if (level && level !== "none") needs.set(dimension, level);
  }

  const draft = DirectorProposalSchema.safeParse(candidate === undefined ? { version: 1, activities: [] } : candidate);
  if (!draft.success) return { ok: false, code: "invalid_proposal" };
  const proposed = new Map(draft.data.activities.map((row) => [row.activity_id, row]));
  const known = new Set(analysis.activities.map(({ id }) => id));
  if (proposed.size !== draft.data.activities.length || [...proposed.keys()].some((id) => !known.has(id))) {
    return { ok: false, code: "invalid_proposal" };
  }

  const activities = analysis.activities.map((activity, index): DirectorActivity => {
    const understood = comprehension.activities[index]!;
    const obligations = sourceObligations(analysis, activity, understood);
    const learning = learningEvidence(profile, analysis, understood);
    const policy = { activity, understood, context, analysis, obligations, scope, needs };
    const proposal = proposed.get(activity.id) ?? defaultProposal(policy);
    const issues = verifyDirection(proposal, policy, learning);
    const rejected = issues.some(({ code }) => code !== "source_uncertain" && code !== "profile_support_unresolved");
    const status = rejected ? "rejected" : issues.length > 0 ? "needs_evidence" :
      proposal.decision === "keep" ? "unchanged" : "design_candidate";
    const canChangeResponse = status === "design_candidate" && proposal.decision === "transform";

    const prohibition: DirectorActivity["prohibition"] = ["change_objectives", "remove_evaluated_demand", "solve_for_student", "alter_source_resources"];
    if (audienceRegister !== "child") prohibition.push("infantilize");
    if (!canChangeResponse) prohibition.push("change_response_format");

    const requirements = new Set<Requirements[number]>(["preserve_source"]);
    if (obligations.some(({ kind }) => kind === "resource")) requirements.add("original_resources");
    if (audienceRegister !== "child") requirements.add("age_appropriate_layout");
    if (status === "design_candidate") {
      for (const { kind } of proposal.changes) if (FABRICATION[kind]) requirements.add(FABRICATION[kind]!);
      requirements.add("check_rendered_output");
      requirements.add("semantic_review");
      if (learning.autonomy.length > 0 || learning.reinforcement_objectives.length > 0) requirements.add("check_fit_to_declared_learning");
    }

    return {
      ...proposal, page: activity.page, original_response_format: activity.response_format, obligations, learning, prohibition, status,
      equivalence: status === "unchanged" ? "unchanged_source" : status === "design_candidate" ? "pending" : "not_assessed",
      uncertainties: understood.uncertainties, original_uncertainty_ids: understood.original_uncertainty_ids, issues,
      needs: proposal.changes.flatMap(({ need }) => {
        const level = needs.get(need);
        return level ? [{ dimension: need, level }] : [];
      }),
      fabrication: { requirements: [...requirements] },
    };
  });

  return { ok: true, direction: PedagogicalDirectionSchema.parse({
    version: 1, original_sha256: input.originalSha256, analysis_fingerprint: fingerprint(parsed.data),
    context_fingerprint: contextFingerprint(context), profile_fingerprint: fingerprint(profile),
    scope, audience_register: audienceRegister, verified_subject: verifiedSubject, activities,
  }) };
}
