// lib/ai/documentAnalysis.ts
// Sprint 3: Primera llamada de análisis del documento antes de la adaptación.
//
// ARQUITECTURA DOS LLAMADAS:
//   Llamada 1 (análisis)  → temperatura 0.1, thinkingBudget bajo, respuesta JSON pequeña
//   Llamada 2 (adaptación) → temperatura 0.3, usa el análisis para contexto adicional
//
// El análisis enriquece el user prompt de la adaptación con:
//   - Tipo de documento detectado (ficha, examen, texto expositivo...)
//   - Complejidad lingüística estimada
//   - Conceptos curriculares clave encontrados
//   - Advertencias pedagógicas (ej: nivel muy superior al del alumno)
//
// Este módulo es OPCIONAL y degrada gracefully:
//   Si falla por timeout, error de API o cualquier razón → la adaptación
//   continúa sin el análisis. Nunca bloquea el flujo principal.

import { GEMINI_MODEL } from "@/lib/ai/model";

export interface DocumentAnalysis {
  tipo_documento: "ficha" | "examen" | "texto_expositivo" | "problema" | "otro";
  nivel_estimado: "infantil" | "primaria_baja" | "primaria_alta" | "secundaria" | "bachillerato";
  complejidad: "baja" | "media" | "alta" | "muy_alta";
  conceptos_clave: string[];       // máx 8 conceptos
  vocabulario_complejo: string[];  // palabras que necesitarán glosario
  estructura_detectada: string;    // descripción breve de la estructura
  advertencias: string[];          // ej: "Nivel estimado muy superior al alumno"
  num_actividades: number;         // actividades/ejercicios en el original
}

const ANALYSIS_SYSTEM_PROMPT = `Eres un analizador pedagógico especializado.
Tu única tarea es analizar documentos educativos y devolver un JSON estructurado.
Responde EXCLUSIVAMENTE con JSON válido, sin texto antes ni después.

Analiza el documento y detecta:
- tipo_documento: qué tipo de material es
- nivel_estimado: nivel educativo aproximado del material original
- complejidad: dificultad lingüística y cognitiva general
- conceptos_clave: los 5-8 conceptos curriculares principales (no más de 8)
- vocabulario_complejo: palabras que necesitarán explicación o glosario (no más de 10)
- estructura_detectada: descripción en 1-2 frases de cómo está organizado
- advertencias: problemas pedagógicos que el adaptador debe tener en cuenta
- num_actividades: número de ejercicios/actividades detectados (0 si es solo texto)

Responde SOLO con este JSON:
{
  "tipo_documento": "ficha|examen|texto_expositivo|problema|otro",
  "nivel_estimado": "infantil|primaria_baja|primaria_alta|secundaria|bachillerato",
  "complejidad": "baja|media|alta|muy_alta",
  "conceptos_clave": ["concepto1", "concepto2"],
  "vocabulario_complejo": ["palabra1", "palabra2"],
  "estructura_detectada": "descripción breve",
  "advertencias": ["advertencia1"],
  "num_actividades": 0
}`;

export async function analyzeDocument(
  sourceText: string,
  expectedLevel: "primaria" | "secundaria",
): Promise<DocumentAnalysis | null> {
  // No analizar textos muy cortos (< 100 chars) — no aportaría valor
  if (!sourceText || sourceText.trim().length < 100) return null;

  const userPrompt = `NIVEL EDUCATIVO ESPERADO: ${expectedLevel}

DOCUMENTO A ANALIZAR:
${sourceText.slice(0, 6000)}`; // limitar a 6000 chars para análisis rápido

  try {
    const controller = new AbortController();
    // Timeout agresivo: 12 segundos. Si falla, continuamos sin análisis.
    const timeout = setTimeout(() => controller.abort(), 12_000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: ANALYSIS_SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
            maxOutputTokens: 1024, // análisis pequeño, respuesta rápida
          },
        }),
      },
    );

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json() as Record<string, unknown>;
    const candidates = data?.candidates as Array<{
      content?: { parts?: Array<{ text?: string }> }
    }> | undefined;

    const rawText = candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim() || "";

    if (!rawText) return null;

    // Limpiar posibles markdown fences
    const clean = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as DocumentAnalysis;

    // Validación mínima
    if (!parsed.tipo_documento || !parsed.complejidad) return null;

    return parsed;
  } catch {
    // Cualquier error (timeout, parse, red) → null, continúa sin análisis
    return null;
  }
}

// Convierte el análisis en un bloque de texto para el user prompt de adaptación
export function buildAnalysisContextBlock(analysis: DocumentAnalysis): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════",
    "ANÁLISIS PREVIO DEL DOCUMENTO (usa como contexto)",
    "═══════════════════════════════════════════════",
    "",
    `Tipo: ${analysis.tipo_documento} | Nivel original: ${analysis.nivel_estimado} | Complejidad: ${analysis.complejidad}`,
    `Actividades detectadas: ${analysis.num_actividades}`,
    `Estructura: ${analysis.estructura_detectada}`,
  ];

  if (analysis.conceptos_clave.length > 0) {
    lines.push(`Conceptos clave: ${analysis.conceptos_clave.join(", ")}`);
  }

  if (analysis.vocabulario_complejo.length > 0) {
    lines.push(`Vocabulario que necesitará glosario: ${analysis.vocabulario_complejo.join(", ")}`);
  }

  if (analysis.advertencias.length > 0) {
    lines.push("");
    lines.push("⚠️ ADVERTENCIAS PEDAGÓGICAS:");
    analysis.advertencias.forEach((w) => lines.push(`  · ${w}`));
  }

  lines.push("");
  lines.push("Usa este análisis para:");
  lines.push("  1. Priorizar los conceptos clave en la adaptación.");
  lines.push("  2. Preparar glosario para el vocabulario complejo.");
  lines.push("  3. Tener en cuenta las advertencias al adaptar.");

  return lines.join("\n");
}
