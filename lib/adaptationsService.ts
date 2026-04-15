import { supabase } from "@/lib/supabaseClient";
import type { ArasaacPictogram, VisualSupportLevel } from "@/lib/arasaac";

export type CreateAdaptationInput = {
  userId: string;
  title: string;
  sourceText: string;
  sourceSchema?: Record<string, unknown> | null;
  sourceType: string;
  contentType: string;
  workType: string;
  adaptationType: string;
  studentProfile?: string;
  withPictograms: boolean;
  visualSupportLevel?: VisualSupportLevel | null;
  styleId?: string | null;
  templateId?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
  pictogramConcepts?: string[] | null;
  pictogramData?: ArasaacPictogram[] | null;
  status: string;
  adaptedContent?: string;
  resultText?: string;
  resultHtml?: string;
  aiNotes?: string;
  promptUsed?: string;
  styleSnapshot?: Record<string, unknown> | null;
  parentAdaptationId?: string | null;
  versionNumber?: number | null;
  refinementPrompt?: string | null;
  isFinal?: boolean | null;
  usedApprovedExamples?: boolean;
  approvedExamplesCount?: number;
  approvedExampleIds?: string[] | null;
  generationVariant?: "base" | "approved_examples_context" | string;
};

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

export async function createAdaptation(input: CreateAdaptationInput) {
  const payload: Record<string, unknown> = {
    user_id: input.userId,
    title: input.title,
    source_text: input.sourceText,
    source_schema: input.sourceSchema || null,
    source_type: input.sourceType,
    content_type: input.contentType,
    work_type: input.workType,
    adaptation_type: input.adaptationType,
    student_profile: input.studentProfile || "",
    with_pictograms: input.withPictograms,
    visual_support_level: input.visualSupportLevel || "medio",
    style_id: input.styleId || null,
    template_id: input.templateId || null,
    template_snapshot: input.templateSnapshot || null,
    pictogram_concepts: input.pictogramConcepts || [],
    pictogram_data: input.pictogramData || [],
    status: input.status,
    adapted_content: input.adaptedContent || "",
    result_text: input.resultText || "",
    result_html: input.resultHtml || "",
    ai_notes: input.aiNotes || "",
    prompt_used: input.promptUsed || "",
    style_snapshot: input.styleSnapshot || null,
    parent_adaptation_id: input.parentAdaptationId || null,
    version_number: input.versionNumber || 1,
    refinement_prompt: input.refinementPrompt || "",
    is_final: Boolean(input.isFinal),
    used_approved_examples: Boolean(input.usedApprovedExamples),
    approved_examples_count:
      typeof input.approvedExamplesCount === "number" ? input.approvedExamplesCount : 0,
    approved_example_ids: input.approvedExampleIds || [],
    generation_variant: input.generationVariant || "base",
  };

  let insertQuery = supabase.from("adaptations").insert([payload]).select("*").single();
  let { data, error } = await insertQuery;

  if (
    error &&
    /(pictogram_data|visual_support_level|template_id|template_snapshot|source_schema|used_approved_examples|approved_examples_count|approved_example_ids|generation_variant)/i.test(
      error.message || "",
    )
  ) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.pictogram_data;
    delete fallbackPayload.visual_support_level;
    delete fallbackPayload.template_id;
    delete fallbackPayload.template_snapshot;
    delete fallbackPayload.source_schema;
    delete fallbackPayload.used_approved_examples;
    delete fallbackPayload.approved_examples_count;
    delete fallbackPayload.approved_example_ids;
    delete fallbackPayload.generation_variant;
    insertQuery = supabase.from("adaptations").insert([fallbackPayload]).select("*").single();
    ({ data, error } = await insertQuery);
  }

  if (error) throw error;
  return normalizeAdaptation(data as Record<string, unknown>);
}

export async function getAdaptationById(adaptationId: string, userId: string) {
  const { data, error } = await supabase
    .from("adaptations")
    .select("*")
    .eq("id", adaptationId)
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return normalizeAdaptation(data as Record<string, unknown>);
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

export async function getNextVersionNumber(
  userId: string,
  baseAdaptationId: string,
  fallbackCurrentVersion = 1,
) {
  const { data: parentData, error: parentError } = await supabase
    .from("adaptations")
    .select("id, user_id, version_number")
    .eq("id", baseAdaptationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (parentError) throw parentError;
  if (!parentData?.id) {
    throw new Error("No se encontró la adaptación base para versionar.");
  }

  const parentVersion =
    typeof parentData.version_number === "number"
      ? parentData.version_number
      : Number(parentData.version_number || fallbackCurrentVersion) ||
        fallbackCurrentVersion;

  return parentVersion + 1;
}

export async function getAdaptationChain(userId: string, adaptationId: string) {
  const all = await getUserAdaptations(userId);
  const byId = new Map(all.map((item) => [item.id, item]));
  const current = byId.get(adaptationId);
  if (!current) {
    throw new Error("No se encontró la adaptación actual.");
  }

  let rootId = current.id;
  let cursor: AdaptationItem | undefined = current;
  while (cursor?.parentAdaptationId) {
    const parent = byId.get(cursor.parentAdaptationId);
    if (!parent) break;
    rootId = parent.id;
    cursor = parent;
  }

  const childrenByParent = new Map<string, AdaptationItem[]>();
  for (const item of all) {
    const parentId = item.parentAdaptationId || "";
    if (!childrenByParent.has(parentId)) {
      childrenByParent.set(parentId, []);
    }
    childrenByParent.get(parentId)?.push(item);
  }

  const chainIds = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const nextId = queue.shift()!;
    if (chainIds.has(nextId)) continue;
    chainIds.add(nextId);
    const children = childrenByParent.get(nextId) || [];
    for (const child of children) {
      queue.push(child.id);
    }
  }

  const chain = all
    .filter((item) => chainIds.has(item.id))
    .sort((a, b) => {
      if (a.versionNumber !== b.versionNumber) {
        return a.versionNumber - b.versionNumber;
      }
      return (
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });

  return {
    rootId,
    current,
    chain,
  };
}

export async function markAdaptationAsFinal(
  userId: string,
  adaptationId: string,
) {
  const unsetResult = await supabase
    .from("adaptations")
    .update({ is_final: false })
    .eq("user_id", userId);

  if (unsetResult.error) throw unsetResult.error;

  const result = await supabase
    .from("adaptations")
    .update({ is_final: true })
    .eq("id", adaptationId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (result.error || !result.data) {
    throw new Error("No se pudo marcar esta adaptación como versión final.");
  }

  return normalizeAdaptation(result.data as Record<string, unknown>);
}
