import { supabase } from "@/lib/supabaseClient";
import type { ArasaacPictogram, VisualSupportLevel } from "@/lib/arasaac";

export type AdaptationItem = {
  id: string;
  userId: string;
  title: string;
  sourceText: string;
  sourceSchema: Record<string, unknown> | null;
  sourceType: string;
  contentType: string;
  workType: string;
  adaptationType: string;
  studentProfile: string;
  withPictograms: boolean;
  visualSupportLevel: VisualSupportLevel;
  styleId: string | null;
  templateId: string | null;
  templateSnapshot: Record<string, unknown> | null;
  pictogramConcepts: string[];
  pictogramData: ArasaacPictogram[];
  status: string;
  adaptedContent: string;
  resultText: string;
  resultHtml: string;
  aiNotes: string;
  promptUsed: string;
  styleSnapshot: Record<string, unknown> | null;
  parentAdaptationId: string | null;
  versionNumber: number;
  refinementPrompt: string;
  isFinal: boolean;
  usedApprovedExamples: boolean;
  approvedExamplesCount: number;
  approvedExampleIds: string[];
  generationVariant: string;
  createdAt: string;
  updatedAt: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizePictogramData(value: unknown): ArasaacPictogram[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const concept = asString(item.concept);
      const id = typeof item.id === "number" ? item.id : Number(item.id || 0);
      const keyword = asString(item.keyword) || concept;
      const imageUrl = asString(item.imageUrl);
      if (!concept || !id || !imageUrl) return null;
      return {
        concept,
        id,
        keyword,
        imageUrl,
      } satisfies ArasaacPictogram;
    })
    .filter((item): item is ArasaacPictogram => Boolean(item));
}

function normalizeAdaptation(row: Record<string, unknown>): AdaptationItem {
  const versionNumber =
    typeof row.version_number === "number"
      ? row.version_number
      : Number(row.version_number || 1) || 1;

  return {
    id: asString(row.id),
    userId: asString(row.user_id),
    title: asString(row.title) || "Sin título",
    sourceText: asString(row.source_text),
    sourceSchema:
      row.source_schema && typeof row.source_schema === "object"
        ? (row.source_schema as Record<string, unknown>)
        : null,
    sourceType: asString(row.source_type) || "text",
    contentType: asString(row.content_type) || "material",
    workType: asString(row.work_type),
    adaptationType: asString(row.adaptation_type),
    studentProfile: asString(row.student_profile),
    withPictograms: Boolean(row.with_pictograms),
    visualSupportLevel:
      asString(row.visual_support_level) === "alto" ||
      asString(row.visual_support_level) === "bajo"
        ? (asString(row.visual_support_level) as VisualSupportLevel)
        : "medio",
    styleId: asString(row.style_id) || null,
    templateId: asString(row.template_id) || null,
    templateSnapshot:
      row.template_snapshot && typeof row.template_snapshot === "object"
        ? (row.template_snapshot as Record<string, unknown>)
        : null,
    pictogramConcepts: Array.isArray(row.pictogram_concepts)
      ? row.pictogram_concepts.filter((item): item is string => typeof item === "string")
      : [],
    pictogramData: normalizePictogramData(row.pictogram_data),
    status: asString(row.status) || "draft",
    adaptedContent: asString(row.adapted_content),
    resultText: asString(row.result_text),
    resultHtml: asString(row.result_html),
    aiNotes: asString(row.ai_notes),
    promptUsed: asString(row.prompt_used),
    styleSnapshot:
      row.style_snapshot && typeof row.style_snapshot === "object"
        ? (row.style_snapshot as Record<string, unknown>)
        : null,
    parentAdaptationId: asString(row.parent_adaptation_id) || null,
    versionNumber,
    refinementPrompt: asString(row.refinement_prompt),
    isFinal: Boolean(row.is_final),
    usedApprovedExamples: Boolean(row.used_approved_examples),
    approvedExamplesCount:
      typeof row.approved_examples_count === "number"
        ? row.approved_examples_count
        : Number(row.approved_examples_count || 0) || 0,
    approvedExampleIds: Array.isArray(row.approved_example_ids)
      ? row.approved_example_ids.filter((item): item is string => typeof item === "string")
      : [],
    generationVariant: asString(row.generation_variant) || "base",
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at) || asString(row.created_at),
  };
}

export async function getUserAdaptations(userId: string) {
  const { data, error } = await supabase
    .from("adaptations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map((row) => normalizeAdaptation(row as Record<string, unknown>));
}

