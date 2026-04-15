import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GEMINI_MODEL } from "@/lib/ai/model";

type AnalysisResponse = {
  simplificationLevel: string;
  pictogramUsageLevel: string;
  usualStructure: string;
  instructionStyle: string;
  averageLength: string;
  tone: string;
  keyObservations: string | null;
  analysisJson: Record<string, unknown>;
  sourceExcerpt: string | null;
  strengths: string[];
  improvementPoints: string[];
  visualMetrics: Record<string, unknown>;
  summary: string | null;
  showImprovements: boolean;
};

const MIN_TEXT_LENGTH = 80;
const MAX_TEXT_LENGTH = 24000;
const REQUEST_TIMEOUT_MS = 45000;

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) =>
        item
          .replace(/\*\*/g, "")
          .replace(/\*/g, "")
          .trim(),
      )
      .filter(Boolean);
  }

  if (typeof value !== "string") return [];
  const raw = value.trim();
  if (!raw) return [];

  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, "\n")
    .replace(/^\s*[-*•]\s*/gm, "\n")
    .replace(/^\s*\d+[.)]\s*/gm, "\n")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "");

  return normalized
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(
  payload: Record<string, unknown>,
  showImprovements: boolean,
): AnalysisResponse {
  const improvementPoints = showImprovements
    ? normalizeStringArray(payload.improvementPoints)
    : [];

  return {
    simplificationLevel: asString(payload.simplificationLevel, "No determinado"),
    pictogramUsageLevel: asString(payload.pictogramUsageLevel, "No determinado"),
    usualStructure: asString(payload.usualStructure, "No determinada"),
    instructionStyle: asString(payload.instructionStyle, "No determinado"),
    averageLength: asString(payload.averageLength, "No determinada"),
    tone: asString(payload.tone, "No determinado"),
    keyObservations: normalizeNullableString(payload.keyObservations) ??
      "No se pudieron extraer observaciones sólidas.",
    analysisJson: asObject(payload.analysisJson),
    sourceExcerpt: normalizeNullableString(payload.sourceExcerpt),
    strengths: normalizeStringArray(payload.strengths),
    improvementPoints,
    visualMetrics: asObject(payload.visualMetrics),
    summary:
      normalizeNullableString(payload.summary) ??
      "Análisis generado con información limitada.",
    showImprovements,
  };
}

function getPayloadTypeMap(payload: Record<string, unknown>) {
  return {
    style_id: Array.isArray(payload.style_id) ? "array" : typeof payload.style_id,
    user_id: Array.isArray(payload.user_id) ? "array" : typeof payload.user_id,
    simplification_level: typeof payload.simplification_level,
    pictogram_usage_level: typeof payload.pictogram_usage_level,
    usual_structure: typeof payload.usual_structure,
    instruction_style: typeof payload.instruction_style,
    average_length: typeof payload.average_length,
    tone: typeof payload.tone,
    key_observations: payload.key_observations === null ? "null" : typeof payload.key_observations,
    analysis_json:
      payload.analysis_json && typeof payload.analysis_json === "object" ? "object" : typeof payload.analysis_json,
    source_excerpt: payload.source_excerpt === null ? "null" : typeof payload.source_excerpt,
    strengths: Array.isArray(payload.strengths) ? "array" : typeof payload.strengths,
    improvement_points: Array.isArray(payload.improvement_points) ? "array" : typeof payload.improvement_points,
    visual_metrics:
      payload.visual_metrics && typeof payload.visual_metrics === "object" ? "object" : typeof payload.visual_metrics,
    summary: payload.summary === null ? "null" : typeof payload.summary,
    show_improvements: typeof payload.show_improvements,
  };
}

function parseJsonFromModel(rawText: string) {
  try {
    return JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("La IA no devolvió JSON parseable.");
    }
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  }
}

function errorResponse(
  stage: string,
  status: number,
  message: string,
  detail?: unknown,
) {
  console.error("STYLE_ANALYSIS_ERROR", {
    stage,
    status,
    message,
    detail,
  });
  return NextResponse.json(
    {
      error: message,
      stage,
    },
    { status },
  );
}

async function upsertStyleAnalysis(
  supabase: unknown,
  payload: Record<string, unknown>,
  styleId: string,
  userId: string,
) {
  const sb = supabase as unknown as {
    from: (table: string) => {
      upsert: (values: unknown, options?: Record<string, unknown>) => {
        select: (query: string) => {
          single: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
        };
      };
      select: (query: string) => {
        eq: (column: string, value: string) => {
          eq: (column2: string, value2: string) => {
            maybeSingle: () => Promise<{ data?: Record<string, unknown> | null; error?: { message?: string } | null }>;
          };
        };
      };
      update: (values: unknown) => {
        eq: (column: string, value: string) => {
          eq: (column2: string, value2: string) => {
            select: (query: string) => {
              single: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
            };
          };
        };
      };
      insert: (values: unknown) => {
        select: (query: string) => {
          single: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
        };
      };
    };
  };

  const upsertResult = await sb
    .from("style_analyses")
    .upsert([payload], { onConflict: "style_id" })
    .select("*")
    .single();

  if (!upsertResult.error && upsertResult.data) {
    return upsertResult.data as Record<string, unknown>;
  }

  const existing = await sb
    .from("style_analyses")
    .select("id")
    .eq("style_id", styleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  if (existing.data?.id) {
    const updated = await sb
      .from("style_analyses")
      .update(payload)
      .eq("id", String(existing.data.id))
      .eq("user_id", userId)
      .select("*")
      .single();
    if (updated.error || !updated.data) {
      throw updated.error || new Error("No se pudo actualizar style_analyses.");
    }
    return updated.data as Record<string, unknown>;
  }

  const created = await sb
    .from("style_analyses")
    .insert([payload])
    .select("*")
    .single();
  if (created.error || !created.data) {
    throw created.error || new Error("No se pudo crear style_analyses.");
  }
  return created.data as Record<string, unknown>;
}

export async function POST(req: Request) {
  try {

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return errorResponse(
      "auth",
      401,
      "No autenticado para analizar estilos.",
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  );

  const userResult = await supabase.auth.getUser(token);
  if (userResult.error || !userResult.data.user) {
    return errorResponse(
      "auth",
      401,
      "Sesión inválida para análisis de estilo.",
      userResult.error?.message,
    );
  }
  const userId = userResult.data.user.id;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (error) {
    return errorResponse(
      "body_parse",
      400,
      "Body JSON inválido en /api/style-analysis.",
      error instanceof Error ? error.message : error,
    );
  }

  const styleId = asString(body.styleId).trim();
  const styleName = asString(body.styleName);
  const description = asString(body.description);
  const analysisInstructions = asString(body.analysisInstructions);
  const showImprovements = Boolean(body.showImprovements);
  const fullDocumentText = asString(body.documentText).trim();

  if (!styleId) {
    return errorResponse(
      "payload_validation",
      400,
      "Falta styleId para guardar el análisis.",
    );
  }
  if (!fullDocumentText) {
    return errorResponse(
      "payload_validation",
      400,
      "No hay texto del documento para analizar.",
    );
  }
  if (fullDocumentText.length < MIN_TEXT_LENGTH) {
    return errorResponse(
      "payload_validation",
      422,
      "El documento no tiene contenido suficiente para analizar el estilo.",
      { minRequired: MIN_TEXT_LENGTH, received: fullDocumentText.length },
    );
  }

  const styleOwnership = await supabase
    .from("user_styles")
    .select("id")
    .eq("id", styleId)
    .eq("user_id", userId)
    .maybeSingle();
  if (styleOwnership.error) {
    return errorResponse(
      "style_lookup",
      500,
      "No se pudo validar el estilo en Supabase.",
      styleOwnership.error.message,
    );
  }
  if (!styleOwnership.data?.id) {
    return errorResponse(
      "style_lookup",
      403,
      "El estilo no existe o no pertenece al usuario autenticado.",
    );
  }

  const documentText =
    fullDocumentText.length > MAX_TEXT_LENGTH
      ? fullDocumentText.slice(0, MAX_TEXT_LENGTH)
      : fullDocumentText;

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse(
      "ai_config",
      500,
      "Falta GEMINI_API_KEY en variables de entorno.",
    );
  }
  if (!GEMINI_MODEL || !GEMINI_MODEL.trim()) {
    return errorResponse(
      "ai_config",
      500,
      "Modelo de Gemini no configurado.",
    );
  }

  const prompt = `
Actúa como una experta en adaptación de materiales educativos para atención a la diversidad dentro de AdaptAula.

Contexto:
- Este documento es una adaptación pedagógica real creada por un docente.
- Tu objetivo es inferir patrones didácticos y de accesibilidad reutilizables.
- No inventes datos: si el contenido es insuficiente o ambiguo, indícalo con honestidad.

Datos del estilo:
- Nombre del estilo: ${styleName || "Sin nombre"}
- Descripción opcional del docente: ${description || "Sin descripción"}
- Indicaciones del docente para orientar el análisis: ${analysisInstructions || "Sin indicaciones adicionales"}
- Mostrar puntos de mejora: ${showImprovements ? "sí" : "no"}

Analiza como mínimo:
- nivel de simplificación del lenguaje
- nivel de uso de apoyos visuales o pictogramas si se detectan
- estructura habitual del material
- estilo de instrucciones
- longitud media y densidad textual
- tono pedagógico
- observaciones clave
- resumen ejecutivo del estilo
- fortalezas detectadas
- métricas visuales para futuros gráficos

Puntos de mejora:
- Solo inclúyelos si "Mostrar puntos de mejora" es sí.
- Si no, improvementPoints debe ir vacío.

Si el documento es pobre o demasiado corto:
- dilo explícitamente en summary y keyObservations.
- evita conclusiones fuertes no sustentadas.

Devuelve SOLO JSON válido con esta forma exacta:
{
  "simplificationLevel": "...",
  "pictogramUsageLevel": "...",
  "usualStructure": "...",
  "instructionStyle": "...",
  "averageLength": "...",
  "tone": "...",
  "keyObservations": "...",
  "analysisJson": {
    "confidence": "alta|media|baja",
    "documentQuality": "suficiente|limitado",
    "detectedPatterns": ["..."],
    "notes": "..."
  },
  "sourceExcerpt": "...",
  "strengths": "...",
  "improvementPoints": "...",
  "visualMetrics": {
    "simplificationScore": 0,
    "visualSupportScore": 0,
    "structureClarityScore": 0,
    "instructionClarityScore": 0
  },
  "summary": "..."
}

Documento adaptado a analizar:
${documentText}
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
        signal: controller.signal,
      },
    );
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    const isAbort = error instanceof Error && error.name === "AbortError";
    return errorResponse(
      "ai_request",
      isAbort ? 504 : 502,
      isAbort
        ? "Timeout al solicitar análisis a la IA."
        : "Fallo de red al solicitar análisis a la IA.",
      error instanceof Error ? error.message : error,
    );
  }
  clearTimeout(timeoutId);

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return errorResponse(
      "ai_response_parse",
      502,
      "La IA respondió con un formato no JSON.",
      error instanceof Error ? error.message : error,
    );
  }

  if (!response.ok) {
    const message =
      asString((data?.error as Record<string, unknown>)?.message) ||
      "No se pudo analizar el estilo con IA.";
    return errorResponse("ai_response_status", response.status, message, {
      status: response.status,
    });
  }

  const rawText =
    (data?.candidates as Array<Record<string, unknown>> | undefined)?.[0]
      ?.content &&
    Array.isArray(
      ((data?.candidates as Array<Record<string, unknown>>)[0]
        ?.content as Record<string, unknown>)?.parts,
    )
      ? (
          (((data?.candidates as Array<Record<string, unknown>>)[0]
            ?.content as Record<string, unknown>)?.parts as Array<
            Record<string, unknown>
          >)
            .map((part) => asString(part.text))
            .join("")
            .trim()
        )
      : "";

  if (!rawText) {
    return errorResponse(
      "ai_empty",
      502,
      "La IA no devolvió contenido para el análisis.",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonFromModel(rawText);
  } catch (error) {
    return errorResponse(
      "ai_json_parse",
      422,
      "La respuesta de IA no se pudo interpretar como JSON válido.",
      error instanceof Error ? error.message : error,
    );
  }

  const normalized = normalize(parsed, showImprovements);

  const dbPayload = {
    style_id: styleId,
    user_id: userId,
    simplification_level: normalized.simplificationLevel,
    pictogram_usage_level: normalized.pictogramUsageLevel,
    usual_structure: normalized.usualStructure,
    instruction_style: normalized.instructionStyle,
    average_length: normalized.averageLength,
    tone: normalized.tone,
    key_observations: normalized.keyObservations,
    analysis_json:
      normalized.analysisJson &&
      typeof normalized.analysisJson === "object"
        ? normalized.analysisJson
        : {},
    source_excerpt: normalized.sourceExcerpt,
    strengths: normalized.strengths,
    improvement_points: normalized.improvementPoints,
    visual_metrics:
      normalized.visualMetrics &&
      typeof normalized.visualMetrics === "object"
        ? normalized.visualMetrics
        : {},
    summary: normalized.summary,
    show_improvements: normalized.showImprovements,
  };

  let savedAnalysis: Record<string, unknown>;
  try {
    savedAnalysis = await upsertStyleAnalysis(
      supabase,
      dbPayload,
      styleId,
      userId,
    );
  } catch (error) {
    return errorResponse(
      "db_write",
      500,
      "No se pudo guardar el análisis en style_analyses.",
      error instanceof Error ? error.message : error,
    );
  }

    return NextResponse.json({
      ...normalized,
      savedAnalysis,
    });
  } catch (error: unknown) {
    return errorResponse(
      "internal",
      500,
      "Error interno en análisis de estilo.",
      error instanceof Error ? error.message : error,
    );
  }
}
