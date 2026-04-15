import { supabase } from "@/lib/supabaseClient";
import type { VisualSupportLevel } from "@/lib/arasaac";

export type DocumentTemplate = {
  id: string;
  userId: string;
  name: string;
  description: string;
  outputFormat: string;
  visualSupportLevel: VisualSupportLevel;
  templateHtml: string;
  templateSchema: Record<string, unknown> | null;
  sourceAdaptationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateDocumentTemplateInput = {
  userId: string;
  name: string;
  description?: string;
  outputFormat: string;
  visualSupportLevel?: VisualSupportLevel;
  templateHtml: string;
  templateSchema?: Record<string, unknown> | null;
  sourceAdaptationId?: string | null;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeVisualSupportLevel(value: unknown): VisualSupportLevel {
  const raw = asString(value);
  if (raw === "alto" || raw === "bajo") return raw;
  return "medio";
}

function normalizeTemplate(row: Record<string, unknown>): DocumentTemplate {
  return {
    id: asString(row.id),
    userId: asString(row.user_id),
    name: asString(row.name) || "Plantilla",
    description: asString(row.description),
    outputFormat: asString(row.output_format) || "Ficha de trabajo",
    visualSupportLevel: normalizeVisualSupportLevel(row.visual_support_level),
    templateHtml: asString(row.template_html),
    templateSchema:
      row.template_schema && typeof row.template_schema === "object"
        ? (row.template_schema as Record<string, unknown>)
        : null,
    sourceAdaptationId: asString(row.source_adaptation_id) || null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at) || asString(row.created_at),
  };
}

export function inferTemplateSchema(templateHtml: string) {
  const html = templateHtml || "";
  const headings = (html.match(/<h[1-3]\b/gi) || []).length;
  const lists = (html.match(/<(ol|ul)\b/gi) || []).length;
  const questions = (html.match(/data-aa-role="question"/gi) || []).length;
  const responseLines = (html.match(/data-aa-role="response-lines"/gi) || []).length;
  const responseBoxes = (html.match(/data-aa-role="response-box"/gi) || []).length;
  const hasInstructions = /data-aa-role="instructions"/i.test(html);
  const formatMatch = html.match(/data-aa-format="([^"]+)"/i);

  return {
    headingCount: headings,
    listCount: lists,
    questionCount: questions,
    responseLinesCount: responseLines,
    responseBoxesCount: responseBoxes,
    hasInstructions,
    semanticFormat: formatMatch?.[1] || "",
  };
}

export function buildTemplateContextBlock(template: DocumentTemplate) {
  const schema = template.templateSchema || inferTemplateSchema(template.templateHtml);
  const compactHtml = template.templateHtml
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);

  return [
    `Plantilla seleccionada: ${template.name}`,
    `Descripción: ${template.description || "Sin descripción."}`,
    `Formato esperado: ${template.outputFormat}`,
    `Intensidad visual de referencia: ${template.visualSupportLevel}`,
    `Esquema de plantilla (JSON): ${JSON.stringify(schema)}`,
    "HTML base de plantilla (referencia estructural, no copiar literal):",
    compactHtml,
  ].join("\n");
}

export async function getUserDocumentTemplates(userId: string) {
  const { data, error } = await supabase
    .from("document_templates")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data || []).map((row) => normalizeTemplate(row as Record<string, unknown>));
}

export async function createDocumentTemplate(input: CreateDocumentTemplateInput) {
  const payload: Record<string, unknown> = {
    user_id: input.userId,
    name: input.name.trim(),
    description: input.description?.trim() || "",
    output_format: input.outputFormat,
    visual_support_level: input.visualSupportLevel || "medio",
    template_html: input.templateHtml,
    template_schema: input.templateSchema || inferTemplateSchema(input.templateHtml),
    source_adaptation_id: input.sourceAdaptationId || null,
  };

  let query = supabase.from("document_templates").insert([payload]).select("*").single();
  let { data, error } = await query;

  if (error && /(template_schema|visual_support_level|source_adaptation_id)/i.test(error.message || "")) {
    const fallback = { ...payload };
    delete fallback.template_schema;
    delete fallback.visual_support_level;
    delete fallback.source_adaptation_id;
    query = supabase.from("document_templates").insert([fallback]).select("*").single();
    ({ data, error } = await query);
  }

  if (error) throw error;
  return normalizeTemplate(data as Record<string, unknown>);
}

