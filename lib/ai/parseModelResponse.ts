// lib/ai/parseModelResponse.ts
//
// Parser robusto para respuestas JSON de modelos de lenguaje.
//
// Estrategia por capas (sin dependencias externas):
//   1. JSON.parse directo                   → happy path, sin overhead
//   2. Quitar fences markdown + trim        → ```json...```
//   3. Extraer primer {...} con regex       → texto antes/después
//   4. Limpiar caracteres de control        → newlines literales en strings
//   5. Reparar JSON truncado               → strings/arrays/objetos sin cerrar
//   6. Error descriptivo con contexto      → nunca error genérico

/** Resultado del parser: objeto parseado + metadata de diagnóstico */
export interface ParseResult {
  data: Record<string, unknown>;
  /** Cuántas capas de recuperación se necesitaron (0 = parse limpio) */
  recoveryLevel: number;
  /** Descripción de la recuperación aplicada, si alguna */
  recoveryNote: string;
}

/**
 * Intenta cerrar un JSON truncado añadiendo los caracteres de cierre
 * que faltan (comillas, corchetes, llaves).
 *
 * Solo viable para truncaciones al final del stream. Si el JSON tiene
 * corrupción interna esta función no lo resolverá.
 */
function repairTruncatedJson(s: string): string {
  let inString = false;
  let escaped = false;
  let openBraces = 0;
  let openBrackets = 0;

  for (const ch of s) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === "{") openBraces++;
      else if (ch === "}") openBraces = Math.max(0, openBraces - 1);
      else if (ch === "[") openBrackets++;
      else if (ch === "]") openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  let repaired = s;
  // Si la última propiedad tiene valor truncado, cerrar la string primero
  if (inString) repaired += '"';
  // Cerrar arrays y objetos abiertos
  repaired += "]".repeat(openBrackets);
  repaired += "}".repeat(openBraces);
  return repaired;
}

/**
 * Elimina caracteres de control ASCII que ilegalizan un JSON válido
 * cuando aparecen literales dentro de strings.
 * Conserva \t (\x09), \n (\x0A) y \r (\x0D) que sí son válidos en JSON.
 */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Parser principal. Prueba capas de recuperación en orden creciente de agresividad.
 * Si todas fallan lanza un error descriptivo.
 *
 * @param rawText - Texto bruto devuelto por el modelo
 */
export function parseModelJsonResponse(rawText: string): ParseResult {
  // ── Capa 0: parse directo ─────────────────────────────────────────────────
  try {
    return { data: JSON.parse(rawText) as Record<string, unknown>, recoveryLevel: 0, recoveryNote: "" };
  } catch { /* continuar */ }

  // ── Capa 1: quitar fences markdown + trim ─────────────────────────────────
  const stripped = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return { data: JSON.parse(stripped) as Record<string, unknown>, recoveryLevel: 1, recoveryNote: "stripped markdown fences" };
  } catch { /* continuar */ }

  // ── Capa 2: extraer primer {...} ──────────────────────────────────────────
  // Greedy: desde el primer { hasta el último } del texto
  const brace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  const extracted = brace !== -1 && lastBrace > brace
    ? stripped.slice(brace, lastBrace + 1)
    : stripped;

  try {
    return { data: JSON.parse(extracted) as Record<string, unknown>, recoveryLevel: 2, recoveryNote: "extracted {…} block" };
  } catch { /* continuar */ }

  // ── Capa 3: limpiar caracteres de control ─────────────────────────────────
  const cleaned = stripControlChars(extracted);

  try {
    return { data: JSON.parse(cleaned) as Record<string, unknown>, recoveryLevel: 3, recoveryNote: "stripped control chars" };
  } catch { /* continuar */ }

  // ── Capa 4: reparar JSON truncado ─────────────────────────────────────────
  const repaired = repairTruncatedJson(cleaned);

  try {
    return { data: JSON.parse(repaired) as Record<string, unknown>, recoveryLevel: 4, recoveryNote: "repaired truncated json (closed open strings/braces)" };
  } catch (finalErr) {
    throw new Error(
      `JSON irrecuperable tras 4 capas de reparación. ` +
      `rawLength=${rawText.length} extractedLength=${extracted.length} ` +
      `finalError=${finalErr instanceof Error ? finalErr.message : String(finalErr)}`,
    );
  }
}
