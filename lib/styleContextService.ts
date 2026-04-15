import { supabase } from "@/lib/supabaseClient";

export type StyleSnapshot = {
  style_id: string;
  name: string;
  description: string;
  summary: string;
  usual_structure: string;
  instruction_style: string;
  tone: string;
  simplification_level: string;
  pictogram_usage_level: string;
  strengths: string;
  key_observations: string;
};

export type StyleContext = {
  styleId: string;
  promptBlock: string;
  snapshot: StyleSnapshot;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function resolveStyleContext(userId: string, styleId: string) {
  const styleResult = await supabase
    .from("user_styles")
    .select("id, name, title, description, structure")
    .eq("id", styleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (styleResult.error) {
    throw styleResult.error;
  }

  if (!styleResult.data) {
    return null;
  }

  const analysisResult = await supabase
    .from("style_analyses")
    .select(
      "summary, usual_structure, instruction_style, tone, simplification_level, pictogram_usage_level, strengths, key_observations",
    )
    .eq("style_id", styleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (analysisResult.error) {
    throw analysisResult.error;
  }

  const styleRow = styleResult.data as Record<string, unknown>;
  const analysisRow =
    (analysisResult.data as Record<string, unknown> | null) || {};

  const name =
    asString(styleRow.name) || asString(styleRow.title) || "Estilo sin nombre";
  const description = asString(styleRow.description);
  const structure = asString(styleRow.structure);

  const snapshot: StyleSnapshot = {
    style_id: styleId,
    name,
    description,
    summary: asString(analysisRow.summary),
    usual_structure:
      asString(analysisRow.usual_structure) || structure || "No determinada",
    instruction_style:
      asString(analysisRow.instruction_style) || "No determinado",
    tone: asString(analysisRow.tone) || "No determinado",
    simplification_level:
      asString(analysisRow.simplification_level) || "No determinado",
    pictogram_usage_level:
      asString(analysisRow.pictogram_usage_level) || "No determinado",
    strengths: asString(analysisRow.strengths),
    key_observations: asString(analysisRow.key_observations),
  };

  const promptBlock = [
    `Nombre del estilo: ${snapshot.name}`,
    `Descripción del estilo: ${snapshot.description || "Sin descripción"}`,
    `Resumen pedagógico: ${snapshot.summary || "Sin resumen"}`,
    `Estructura habitual: ${snapshot.usual_structure}`,
    `Estilo de instrucciones: ${snapshot.instruction_style}`,
    `Tono pedagógico: ${snapshot.tone}`,
    `Nivel de simplificación: ${snapshot.simplification_level}`,
    `Uso de pictogramas detectado: ${snapshot.pictogram_usage_level}`,
    `Fortalezas detectadas: ${snapshot.strengths || "No especificadas"}`,
    `Observaciones clave: ${snapshot.key_observations || "No especificadas"}`,
    "Regla clave: respeta estos patrones de estilo sin copiar literalmente documentos previos.",
  ].join("\n");

  return {
    styleId,
    promptBlock,
    snapshot,
  } satisfies StyleContext;
}
