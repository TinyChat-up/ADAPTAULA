import type { ACTIVITY_TYPES, PROTECTED_TYPES, UNCERTAINTY_KINDS } from "@/lib/schemas/material-analysis";
import type { PageSpec } from "./fixtures";

type ActivityType = (typeof ACTIVITY_TYPES)[number];
type ProtectedType = (typeof PROTECTED_TYPES)[number];
type UncertaintyKind = (typeof UNCERTAINTY_KINDS)[number];

/**
 * What a good analysis must (hard) or should (soft) contain. Nothing here asks for exact wording:
 * checks are structural (counts, types, flags) or semantic through groups of synonyms.
 */
export interface Expectations {
  /** Accepted stages (any of). Omitted: not checked. */
  stage?: Array<"primaria" | "eso" | "bachillerato">;
  /** Groups of acceptable names; the detected subject must match one name of EVERY group. */
  subject: string[][];
  activities: { min: number; max: number };
  /** Every group needs at least one activity whose type is in the group. */
  activityTypes?: ActivityType[][];
  /** Every group needs at least one synonym somewhere in the analysis' pedagogical text. */
  concepts?: string[][];
  /** Every group needs at least one protected element of one of its types. */
  protectedTypes?: ProtectedType[][];
  /** Minimum counts of non-decorative visuals, decorative ones and visuals whose role is "required" to solve. */
  visuals?: { informative?: number; decorative?: number; required?: number };
  structure?: { tables?: number; formulas?: number; readingTexts?: number; minSections?: number };
  /**
   * Every group needs a protected element whose `value` mentions one of its synonyms (accents and case ignored). Used for the
   * explicit conditions and constraints of a task: dropping any of them would change the problem being evaluated.
   */
  protectedMentions?: string[][];
  /** Charts must carry no metadata the sheet does not show: series names, axis labels and units are empty or one of these printed texts. */
  chartMetadata?: { printed: string[] };
  /** The listed activities (matched by a regex on their content) must NOT carry an invented answer. */
  noInventedAnswer?: RegExp[];
  uncertainties?: { min: number; kinds?: UncertaintyKind[] };
  /** Strings that must not appear in the interpretation fields (title, subject, purpose, objectives…). */
  forbiddenInInterpretation?: string[];
  /** Soft: reported but they do not fail the case. */
  soft?: { uncertaintyKinds?: UncertaintyKind[]; lowConfidenceActivity?: boolean; readingTexts?: number };
}

export interface EvalCase {
  id: string;
  title: string;
  stage: "primaria" | "eso" | "bachillerato";
  tags: string[];
  pages: PageSpec[];
  expect: Expectations;
}
