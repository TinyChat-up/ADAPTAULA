import {
  ADAPTATION_CONTEXT_VERSION,
  AdaptationContextSchema,
  DEFAULT_CONTEXT_POLICY,
  type ContextPolicy,
  type AdaptationContext,
  type ContextNeed,
  type Presentation,
} from "@/lib/schemas/adaptation-context";
import type { Intensity } from "@/lib/schemas/adaptation-plan";
import type { AdaptationType } from "@/lib/schemas/adaptation-type";
import { DIMENSION_KEYS, activeSupports, type DimensionKey, type FunctionalProfile, type SupportLevel } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { detectConflicts } from "./conflicts";
import { ambiguousTargets, evaluatesWriting, isLiteralSourceText, isMathMaterial } from "./facts";
import { fingerprint } from "./fingerprint";
import { STAGE_RULES, ageBand } from "./stage-rules";
import { AUDIO_DIMENSIONS, DIMENSION_STRATEGIES, PRESENTATION_DIMENSIONS } from "./strategies";
import { wordCount } from "./text";

/**
 * Builds the AdaptationContext from data the server already trusts. Pure and deterministic: the same profile, education
 * context, analysis and request always give the same context (and fingerprint). Input is narrowed on purpose: the
 * learner's alias, ids, timestamps or anything not needed for this sheet cannot get in.
 */
export interface ContextInput {
  /** Snapshot of the functional profile (supports, limits, allowances). Nothing else of the learner profile. */
  profile: FunctionalProfile;
  education: { stage: string | null; grade: string | null; subject: string | null };
  analysis: MaterialAnalysis;
  adaptationType: AdaptationType;
  teacherRequest?: string | null;
  /** Builder policy. Defaults to the historical one (1) so a context is reproducible; opt in to a later one explicitly. */
  policy?: ContextPolicy;
}

export interface OmittedNeed {
  dimension: DimensionKey;
  reason: "presentation_only" | "not_applicable" | "resolved_by_presentation";
}

type ActiveLevel = Exclude<SupportLevel, "none">;

/** The intensity of the change a support level calls for. A default the planner may lower, never raise above `substantial`. */
export const INTENSITY_FOR_LEVEL: Record<ActiveLevel, Intensity> = { low: "light", medium: "moderate", high: "substantial" };
const LEVEL_RANK: Record<ActiveLevel, number> = { high: 0, medium: 1, low: 2 };
const STAGES = ["primaria", "eso", "bachillerato"] as const;

function resolveStage(value: string | null): AdaptationContext["education"]["stage"] {
  return (STAGES as readonly string[]).includes(value ?? "") ? (value as (typeof STAGES)[number]) : "unknown";
}

/** Whether a dimension can do anything on this material (an uploaded sheet has no audio; no visuals, no image dependency…). */
function applicable(dimension: DimensionKey, analysis: MaterialAnalysis, math: boolean): boolean {
  if ((AUDIO_DIMENSIONS as readonly DimensionKey[]).includes(dimension)) return false;
  const activities = analysis.activities.length;
  const responses = analysis.activities.filter((a) => a.response_format !== "none").length;
  switch (dimension) {
    case "number_sense_support":
    case "operation_steps":
    case "visual_math_support":
      return math;
    case "writing_amount":
    case "fine_motor_demand":
    case "selection_based_response":
    case "alternative_response":
    case "reduced_copying":
      return responses > 0;
    case "number_of_visible_tasks":
    case "transition_support":
    case "transition_signals":
    case "visual_schedule":
      return activities >= 2;
    case "text_length":
    case "reading_chunk_size":
      return analysis.texts.some((t) => t.kind === "reading_text") || analysis.activities.some((a) => wordCount(a.instruction) > 35);
    default:
      return true;
  }
}

function presentationFor(profile: FunctionalProfile, stage: AdaptationContext["education"]["stage"]): Presentation {
  const s = profile.supports;
  const level = (key: DimensionKey) => s[key] ?? "none";
  const any = (key: DimensionKey) => level(key) !== "none";
  const atLeastMedium = (key: DimensionKey) => level(key) === "medium" || level(key) === "high";

  const FONT: Record<SupportLevel, Presentation["font_scale"]> = { none: 1, low: 1.15, medium: 1.3, high: 1.5 };
  const LARGE: Record<SupportLevel, Presentation["font_scale"]> = { none: 1, low: 1.3, medium: 1.5, high: 1.5 };
  const font_scale = Math.max(FONT[level("font_size")], LARGE[level("large_print")]) as Presentation["font_scale"];

  const loadLevels = (["unnecessary_decoration", "visual_density", "visual_distraction_reduction", "sensory_triggers"] as const).map(level);
  const decoration: Presentation["decoration"] = loadLevels.some((l) => l === "medium" || l === "high")
    ? "none"
    : loadLevels.includes("low")
      ? "reduced"
      : STAGE_RULES[stage].default_decoration;

  const VISIBLE: Record<SupportLevel, number | null> = { none: null, low: 4, medium: 3, high: 2 };

  return {
    font_scale,
    line_spacing: atLeastMedium("line_spacing") ? "loose" : any("line_spacing") || level("decoding_support") === "high" ? "relaxed" : "normal",
    spacing: any("spacing") || atLeastMedium("visual_density") ? "wide" : "normal",
    contrast: any("high_contrast") || atLeastMedium("contrast") ? "high" : "normal",
    decoration,
    max_tasks_per_page: profile.limits.max_visible_tasks ?? VISIBLE[level("number_of_visible_tasks")],
    color_independent: any("color_dependency") || any("high_contrast"),
    text_alternatives_for_visuals: any("alt_text") || any("image_dependency") || any("screen_reader_compatibility"),
  };
}

/**
 * Needs that a presentation setting resolves COMPLETELY (policy 2): nothing is left for a planner to decide, so it must not
 * come back as a decision (the planner duplicated `max_tasks_per_page` in both real experiments). Only needs whose whole
 * effect is deterministic belong here.
 */
const RESOLVED_BY_PRESENTATION: Partial<Record<DimensionKey, (p: Presentation) => boolean>> = {
  /** The assembler paginates with `max_tasks_per_page`. */
  number_of_visible_tasks: (p) => p.max_tasks_per_page !== null,
  /** With decoration "none" the assembler drops every decorative visual. */
  unnecessary_decoration: (p) => p.decoration === "none",
};

/** Whether a presentation setting already carries out everything a need of this dimension asks for (policy 2 relies on the same table). */
export const isResolvedByPresentation = (dimension: DimensionKey, presentation: Presentation): boolean => RESOLVED_BY_PRESENTATION[dimension]?.(presentation) ?? false;

function sanitizeRequest(value: string | null | undefined): string | null {
  const clean = (value ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  return clean.length > 0 ? clean : null;
}

export function buildAdaptationContext(input: ContextInput): { context: AdaptationContext; omitted: OmittedNeed[] } {
  const { profile, analysis } = input;
  const stage = resolveStage(input.education.stage ?? analysis.identification.stage.value);
  const grade = input.education.grade ?? analysis.identification.grade.value;
  const math = isMathMaterial(analysis);
  const rule = STAGE_RULES[stage];

  const policy = input.policy ?? DEFAULT_CONTEXT_POLICY;
  const presentation = presentationFor(profile, stage);
  const omitted: OmittedNeed[] = [];
  const needs: ContextNeed[] = [];
  for (const [dimension, level] of activeSupports(profile)) {
    if ((PRESENTATION_DIMENSIONS as readonly DimensionKey[]).includes(dimension)) omitted.push({ dimension, reason: "presentation_only" });
    else if (!applicable(dimension, analysis, math)) omitted.push({ dimension, reason: "not_applicable" });
    else if (policy >= 2 && RESOLVED_BY_PRESENTATION[dimension]?.(presentation)) omitted.push({ dimension, reason: "resolved_by_presentation" });
    else needs.push({ dimension, level, intensity: INTENSITY_FOR_LEVEL[level], strategies: DIMENSION_STRATEGIES[dimension].slice(0, 3) });
  }
  const order = (d: DimensionKey) => DIMENSION_KEYS.indexOf(d);
  needs.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || order(a.dimension) - order(b.dimension));
  omitted.sort((a, b) => order(a.dimension) - order(b.dimension));

  const literalTexts = analysis.texts.filter((t) => isLiteralSourceText(analysis, t)).map((t) => t.id);
  const writingActivities = analysis.activities.filter((a) => evaluatesWriting(analysis, a)).map((a) => a.id);

  const context: AdaptationContext = {
    context_version: ADAPTATION_CONTEXT_VERSION,
    ...(policy >= 2 ? { policy_version: 2 as const } : {}),
    adaptation_type: input.adaptationType,
    education: {
      stage,
      grade,
      subject: input.education.subject ?? analysis.identification.subject.value,
      language: analysis.identification.language ?? "es",
    },
    audience: { age_band: ageBand(stage, grade), register: rule.register, infantilization_guard: rule.infantilization_guard },
    needs,
    presentation,
    limits: {
      max_instruction_words: profile.limits.max_instruction_words ?? null,
      max_visible_tasks: profile.limits.max_visible_tasks ?? null,
      max_task_minutes: profile.limits.max_task_minutes ?? null,
    },
    allowances: {
      calculator: profile.allowances.calculator ?? false,
      keyboard: profile.allowances.keyboard ?? false,
      bilingual_support_language: profile.allowances.bilingual_support_language ?? null,
    },
    material: {
      activity_count: analysis.activities.length,
      has_math: math,
      literal_source_texts: literalTexts,
      writing_evaluated_activities: writingActivities,
      required_visuals: analysis.visuals.filter((v) => v.role === "required").map((v) => v.id),
      decorative_visuals: analysis.visuals.filter((v) => v.role === "decorative").map((v) => v.id),
      ambiguous_targets: ambiguousTargets(analysis),
    },
    conflicts: detectConflicts(new Set(needs.map((n) => n.dimension)), analysis, { literalTexts, writingActivities }),
    teacher_request: sanitizeRequest(input.teacherRequest),
  };
  return { context: AdaptationContextSchema.parse(context), omitted };
}

export function contextFingerprint(context: AdaptationContext): string {
  return fingerprint(context);
}
