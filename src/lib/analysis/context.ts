import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";

/** Below this, a detected value is shown to the teacher as a suggestion at most; it is never applied silently. */
export const CONTEXT_CONFIDENCE_THRESHOLD = 0.6;

export type ContextField = "title" | "stage" | "grade" | "subject" | "topic";
export const CONTEXT_FIELDS: readonly ContextField[] = ["title", "stage", "grade", "subject", "topic"];

export interface MaterialContextRow {
  title: string;
  stage_slug: string | null;
  grade_slug: string | null;
  subject_slug: string | null;
  topic: string | null;
  confirmed_fields: readonly string[];
}

export interface ResolvedField {
  value: string | null;
  /** teacher = confirmed or corrected by a person; ai = detected; none = unknown. Teacher always prevails. */
  source: "teacher" | "ai" | "none";
  confidence: number | null;
}

export type ResolvedContext = Record<ContextField, ResolvedField>;

/** Stage a grade slug belongs to: "5-primaria" → "primaria". */
export function stageOfGrade(gradeSlug: string): string {
  return gradeSlug.slice(gradeSlug.indexOf("-") + 1);
}

function confidenceOf(analysis: MaterialAnalysis | null, field: ContextField): number | null {
  if (!analysis || field === "title") return null; // the title is read literally from the sheet: it carries no confidence
  const { identification: i } = analysis;
  return { stage: i.stage, grade: i.grade, subject: i.subject, topic: i.topic }[field].confidence;
}

/**
 * Effective context of a material. A field the teacher confirmed always wins; otherwise the stored
 * value (filled from the analysis when it was confident enough) is reported as AI-detected.
 */
export function resolveContext(row: MaterialContextRow, analysis: MaterialAnalysis | null): ResolvedContext {
  const values: Record<ContextField, string | null> = {
    title: row.title,
    stage: row.stage_slug,
    grade: row.grade_slug,
    subject: row.subject_slug,
    topic: row.topic,
  };
  const out = {} as ResolvedContext;
  for (const field of CONTEXT_FIELDS) {
    const confirmed = row.confirmed_fields.includes(field);
    const value = values[field];
    out[field] = {
      value,
      source: confirmed ? "teacher" : value !== null && analysis !== null && field !== "title" ? "ai" : "none",
      confidence: confirmed ? null : confidenceOf(analysis, field),
    };
  }
  // The title always has a value (file name at first); it counts as AI-detected only once the analysis supplied it.
  if (!row.confirmed_fields.includes("title")) {
    const detected = analysis?.identification.title;
    out.title.source = detected && detected === row.title ? "ai" : "none";
  }
  return out;
}

export interface CatalogForContext {
  stages: ReadonlySet<string>;
  grades: ReadonlySet<string>;
  subjects: ReadonlySet<string>;
}

/**
 * What to write into the material columns when an analysis completes: only fields the teacher has NOT
 * confirmed, only when the model was confident, and only values that exist in the catalog.
 */
export function detectedContextUpdate(
  analysis: MaterialAnalysis,
  confirmedFields: readonly string[],
  catalog: CatalogForContext,
): Partial<Record<ContextField, string>> {
  const { identification: i } = analysis;
  const ok = (confidence: number) => confidence >= CONTEXT_CONFIDENCE_THRESHOLD;
  const open = (field: ContextField) => !confirmedFields.includes(field);
  const out: Partial<Record<ContextField, string>> = {};

  if (open("title") && i.title) out.title = i.title;

  const stage = i.stage.value && ok(i.stage.confidence) && catalog.stages.has(i.stage.value) ? i.stage.value : null;
  if (open("stage") && stage) out.stage = stage;

  const grade = i.grade.value && ok(i.grade.confidence) && catalog.grades.has(i.grade.value) ? i.grade.value : null;
  const gradeStage = grade ? stageOfGrade(grade) : null;
  // A grade is applied only if it agrees with the stage that will end up on the material.
  const effectiveStage = confirmedFields.includes("stage") ? null : (out.stage ?? null);
  if (open("grade") && grade && (effectiveStage === null || gradeStage === effectiveStage)) out.grade = grade;

  if (open("subject") && i.subject.slug && ok(i.subject.confidence) && catalog.subjects.has(i.subject.slug)) out.subject = i.subject.slug;
  if (open("topic") && i.topic.value && ok(i.topic.confidence)) out.topic = i.topic.value;
  return out;
}
