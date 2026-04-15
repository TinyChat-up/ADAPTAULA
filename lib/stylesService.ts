import { supabase } from "@/lib/supabaseClient";

const STYLE_TABLE_CANDIDATES = [
  "user_styles",
  "styles",
  "teacher_styles",
  "adaptation_styles",
];

const HISTORY_TABLE_CANDIDATES = [
  "style_history",
  "styles_history",
  "adaptation_history",
  "history",
];

type UserColumn = "user_id" | "owner_id" | "teacher_id";

export type StyleEntity = {
  id: string;
  userId: string;
  title: string;
  description: string;
  content: string;
  analysisText: string;
  sourceFileName: string;
  sourceFileUrl: string;
  sourceDocumentId: string;
  structure: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StyleHistoryEntity = {
  id: string;
  styleId: string | null;
  title: string;
  detail: string;
  createdAt: string;
};

export type StyleInput = {
  title: string;
  description: string;
  content: string;
};

export type CreateStyleFromDocumentInput = {
  name: string;
  description?: string;
  sourceFileName: string;
  sourceFileUrl?: string | null;
  sourceDocumentId?: string | null;
  structure?: string | null;
};

export type StyleAnalysisEntity = {
  id: string;
  styleId: string;
  userId: string;
  simplificationLevel: string;
  pictogramUsageLevel: string;
  usualStructure: string;
  instructionStyle: string;
  averageLength: string;
  tone: string;
  keyObservations: string;
  analysisJson: Record<string, unknown> | null;
  sourceExcerpt: string;
  strengths: string;
  improvementPoints: string;
  visualMetrics: Record<string, unknown> | null;
  summary: string;
  showImprovements: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SaveStyleAnalysisInput = {
  styleId: string;
  userId: string;
  simplificationLevel: string;
  pictogramUsageLevel: string;
  usualStructure: string;
  instructionStyle: string;
  averageLength: string;
  tone: string;
  keyObservations: string;
  analysisJson: Record<string, unknown> | null;
  sourceExcerpt: string;
  strengths: string;
  improvementPoints: string;
  visualMetrics: Record<string, unknown> | null;
  summary: string;
  showImprovements: boolean;
};

let cachedStyleTable: string | null = null;
let cachedStyleUserColumn: UserColumn | null = null;
let cachedHistoryTable: string | null = null;
let cachedHistoryUserColumn: UserColumn | null = null;

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function detectUserId(row: Record<string, unknown>) {
  return (
    asString(row.user_id) || asString(row.owner_id) || asString(row.teacher_id)
  );
}

function normalizeStyle(row: Record<string, unknown>): StyleEntity {
  return {
    id: asString(row.id),
    userId: detectUserId(row),
    title: asString(row.title) || asString(row.name) || "Sin título",
    description: asString(row.description),
    content:
      asString(row.content) ||
      asString(row.configuration) ||
      asString(row.config) ||
      asString(row.template),
    analysisText:
      asString(row.analysis) ||
      asString(row.ai_analysis) ||
      asString(row.analysis_text) ||
      asString(row.style_analysis),
    sourceFileName: asString(row.source_file_name),
    sourceFileUrl: asString(row.source_file_url),
    sourceDocumentId: asString(row.source_document_id),
    structure: asString(row.structure),
    isActive:
      Boolean(row.is_active) ||
      Boolean(row.active) ||
      Boolean(row.selected) ||
      false,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at) || asString(row.created_at),
  };
}

function normalizeStyleAnalysis(
  row: Record<string, unknown>,
): StyleAnalysisEntity {
  return {
    id: asString(row.id),
    styleId: asString(row.style_id),
    userId: asString(row.user_id),
    simplificationLevel: asString(row.simplification_level),
    pictogramUsageLevel: asString(row.pictogram_usage_level),
    usualStructure: asString(row.usual_structure),
    instructionStyle: asString(row.instruction_style),
    averageLength: asString(row.average_length),
    tone: asString(row.tone),
    keyObservations: asString(row.key_observations),
    analysisJson:
      row.analysis_json && typeof row.analysis_json === "object"
        ? (row.analysis_json as Record<string, unknown>)
        : null,
    sourceExcerpt: asString(row.source_excerpt),
    strengths: asString(row.strengths),
    improvementPoints: asString(row.improvement_points),
    visualMetrics:
      row.visual_metrics && typeof row.visual_metrics === "object"
        ? (row.visual_metrics as Record<string, unknown>)
        : null,
    summary: asString(row.summary),
    showImprovements: Boolean(row.show_improvements),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at) || asString(row.created_at),
  };
}

function normalizeHistory(row: Record<string, unknown>): StyleHistoryEntity {
  return {
    id: asString(row.id),
    styleId: asString(row.style_id) || null,
    title:
      asString(row.title) ||
      asString(row.action) ||
      asString(row.event) ||
      "Actividad",
    detail:
      asString(row.detail) ||
      asString(row.description) ||
      asString(row.notes) ||
      "",
    createdAt: asString(row.created_at),
  };
}

async function resolveStyleTable(userId: string) {
  if (cachedStyleTable && cachedStyleUserColumn) {
    return { table: cachedStyleTable, userColumn: cachedStyleUserColumn };
  }

  const userColumns: UserColumn[] = ["user_id", "owner_id", "teacher_id"];

  for (const table of STYLE_TABLE_CANDIDATES) {
    for (const userColumn of userColumns) {
      const { error } = await supabase
        .from(table)
        .select("*")
        .eq(userColumn, userId)
        .limit(1);

      if (!error) {
        cachedStyleTable = table;
        cachedStyleUserColumn = userColumn;
        return { table, userColumn };
      }
    }
  }

  throw new Error("No se encontró la tabla de estilos configurada.");
}

async function resolveHistoryTable(userId: string) {
  if (cachedHistoryTable && cachedHistoryUserColumn) {
    return { table: cachedHistoryTable, userColumn: cachedHistoryUserColumn };
  }

  const userColumns: UserColumn[] = ["user_id", "owner_id", "teacher_id"];

  for (const table of HISTORY_TABLE_CANDIDATES) {
    for (const userColumn of userColumns) {
      const { error } = await supabase
        .from(table)
        .select("*")
        .eq(userColumn, userId)
        .limit(1);

      if (!error) {
        cachedHistoryTable = table;
        cachedHistoryUserColumn = userColumn;
        return { table, userColumn };
      }
    }
  }

  return null;
}

export async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

export async function getUserStyles(userId: string) {
  const { table, userColumn } = await resolveStyleTable(userId);
  const orderedQuery = supabase
    .from(table)
    .select("*")
    .eq(userColumn, userId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  const { data: orderedData, error: orderedError } = await orderedQuery;
  if (!orderedError) {
    return (orderedData || []).map((row) =>
      normalizeStyle(row as Record<string, unknown>),
    );
  }

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(userColumn, userId);

  if (error) throw error;
  return (data || [])
    .map((row) => normalizeStyle(row as Record<string, unknown>))
    .sort(
      (a, b) =>
        (new Date(b.updatedAt).getTime() || 0) -
        (new Date(a.updatedAt).getTime() || 0),
    );
}

function stylePayloadVariants(userColumn: UserColumn, userId: string, input: StyleInput) {
  return [
    { [userColumn]: userId, title: input.title, description: input.description, content: input.content },
    { [userColumn]: userId, name: input.title, description: input.description, content: input.content },
    { [userColumn]: userId, title: input.title, description: input.description, configuration: input.content },
    { [userColumn]: userId, name: input.title, description: input.description, configuration: input.content },
  ];
}

export async function createStyle(userId: string, input: StyleInput) {
  const { table, userColumn } = await resolveStyleTable(userId);
  const variants = stylePayloadVariants(userColumn, userId, input);

  for (const payload of variants) {
    const { data, error } = await supabase
      .from(table)
      .insert([payload])
      .select("*")
      .single();
    if (!error && data) return normalizeStyle(data as Record<string, unknown>);
  }

  throw new Error("No se pudo crear el estilo con el schema actual.");
}

export async function createStyleFromDocument(
  userId: string,
  input: CreateStyleFromDocumentInput,
) {
  const payload = {
    user_id: userId,
    name: input.name,
    description: input.description || "",
    source_file_name: input.sourceFileName,
    source_file_url: input.sourceFileUrl || null,
    source_document_id: input.sourceDocumentId || null,
    structure: input.structure || null,
    is_active: false,
  };

  const { data, error } = await supabase
    .from("user_styles")
    .insert([payload])
    .select("*")
    .single();

  if (error) throw error;
  return normalizeStyle(data as Record<string, unknown>);
}

export async function updateStyle(styleId: string, userId: string, input: StyleInput) {
  const { table, userColumn } = await resolveStyleTable(userId);
  const variants = stylePayloadVariants(userColumn, userId, input);

  for (const payload of variants) {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq("id", styleId)
      .eq(userColumn, userId)
      .select("*")
      .single();
    if (!error && data) return normalizeStyle(data as Record<string, unknown>);
  }

  throw new Error("No se pudo actualizar el estilo.");
}

export async function deleteStyle(styleId: string, userId: string) {
  const { table, userColumn } = await resolveStyleTable(userId);
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("id", styleId)
    .eq(userColumn, userId);
  if (error) throw error;
}

export async function duplicateStyle(style: StyleEntity, userId: string) {
  return createStyle(userId, {
    title: `${style.title} Copia`,
    description: style.description,
    content: style.content,
  });
}

export async function setActiveStyle(styleId: string, userId: string) {
  const { table, userColumn } = await resolveStyleTable(userId);

  const activeColumns = ["is_active", "active", "selected"] as const;

  for (const column of activeColumns) {
    const resetResult = await supabase
      .from(table)
      .update({ [column]: false })
      .eq(userColumn, userId);

    if (resetResult.error) {
      continue;
    }

    const setResult = await supabase
      .from(table)
      .update({ [column]: true })
      .eq("id", styleId)
      .eq(userColumn, userId);

    if (!setResult.error) return;
  }

  throw new Error("No se pudo establecer el estilo activo en este schema.");
}

export async function getStyleHistory(userId: string, styleId?: string) {
  const resolved = await resolveHistoryTable(userId);
  if (!resolved) return [];

  const { table, userColumn } = resolved;
  let query = supabase
    .from(table)
    .select("*")
    .eq(userColumn, userId)
    .order("created_at", { ascending: false });

  if (styleId) {
    query = query.eq("style_id", styleId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) =>
    normalizeHistory(row as Record<string, unknown>),
  );
}

export async function getStyleAnalysesByUser(userId: string) {
  const { data, error } = await supabase
    .from("style_analyses")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const analyses = (data || []).map((row) =>
    normalizeStyleAnalysis(row as Record<string, unknown>),
  );

  const byStyleId: Record<string, StyleAnalysisEntity> = {};
  for (const item of analyses) {
    if (!byStyleId[item.styleId]) {
      byStyleId[item.styleId] = item;
    }
  }
  return byStyleId;
}

async function saveStyleAnalysis(input: SaveStyleAnalysisInput) {
  const payload = {
    style_id: input.styleId,
    user_id: input.userId,
    simplification_level: input.simplificationLevel,
    pictogram_usage_level: input.pictogramUsageLevel,
    usual_structure: input.usualStructure,
    instruction_style: input.instructionStyle,
    average_length: input.averageLength,
    tone: input.tone,
    key_observations: input.keyObservations,
    analysis_json: input.analysisJson,
    source_excerpt: input.sourceExcerpt,
    strengths: input.strengths,
    improvement_points: input.improvementPoints,
    visual_metrics: input.visualMetrics,
    summary: input.summary,
    show_improvements: input.showImprovements,
  };

  const upsertResult = await supabase
    .from("style_analyses")
    .upsert([payload], { onConflict: "style_id" })
    .select("*")
    .single();

  if (!upsertResult.error && upsertResult.data) {
    return normalizeStyleAnalysis(upsertResult.data as Record<string, unknown>);
  }

  const existing = await supabase
    .from("style_analyses")
    .select("id")
    .eq("style_id", input.styleId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (existing.data?.id) {
    const updated = await supabase
      .from("style_analyses")
      .update(payload)
      .eq("id", existing.data.id)
      .eq("user_id", input.userId)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    return normalizeStyleAnalysis(updated.data as Record<string, unknown>);
  }

  const created = await supabase
    .from("style_analyses")
    .insert([payload])
    .select("*")
    .single();

  if (created.error) throw created.error;
  return normalizeStyleAnalysis(created.data as Record<string, unknown>);
}
