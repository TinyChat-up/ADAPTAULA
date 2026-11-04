/**
 * Huellas de contenido privado (ADR-044). Compartido por el generador local de huellas y por el comprobador que corre en
 * pre-commit, en `pnpm test` y en CI. Sin dependencias: debe funcionar antes de `pnpm install`.
 *
 * El repositorio solo guarda huellas truncadas de frases normalizadas y de archivos completos, nunca su texto. Una huella
 * no permite reconstruir la frase; solo reconocer una copia literal (o con cambios de mayúsculas, tildes, signos y espacios).
 */
import { createHash } from "node:crypto";

/** Minimum size of a unit: short phrases are common Spanish and would only produce false positives. */
export const MIN_CHARS = 40;
export const MIN_WORDS = 6;
/** 64 bits per unit: enough to make an accidental collision negligible at this size. */
const UNIT_HEX = 16;

export function normalize(text) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Lines and sentences of a text, normalized, that are long enough to identify their source. */
export function units(text) {
  const out = new Set();
  const consider = (raw) => {
    const n = normalize(raw);
    if (n.length >= MIN_CHARS && n.split(" ").length >= MIN_WORDS) out.add(n);
  };
  for (const line of text.split(/\r?\n/)) {
    consider(line);
    for (const sentence of line.split(/(?<=[.!?;:])\s+/)) consider(sentence);
  }
  // Sentences that a hard wrap split across lines: the paragraph is read as one text too.
  for (const paragraph of text.split(/\r?\n\s*\r?\n/)) {
    for (const sentence of paragraph.replace(/\s*\r?\n\s*/g, " ").split(/(?<=[.!?;:])\s+/)) consider(sentence);
  }
  return out;
}

export const unitHash = (normalized) => createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, UNIT_HEX);
export const fileHash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A buffer is treated as text when it has no NUL byte in its first 8 KB. */
export const isText = (bytes) => !bytes.subarray(0, 8192).includes(0);

/**
 * Paths that never belong in the public repository, whatever their content. `materiales/` only at the root: the app has a
 * route with that name under src/app.
 */
export const FORBIDDEN_PATHS = [
  { re: /^materiales\//, why: "carpeta local de materiales reales" },
  { re: /(^|\/)materiales_locales/i, why: "paquete de materiales reales" },
  { re: /\.bundle$/i, why: "bundle de Git (historial de otro repositorio)" },
  { re: /\.zip$/i, why: "archivo comprimido" },
  { re: /agente_pedagogico/i, why: "paquete de reglas del agente (privado)" },
  { re: /adaptaula-lab/i, why: "laboratorio privado" },
  { re: /(^|\/)06_biblioteca(\/|$)/i, why: "biblioteca de precedentes (privada)" },
  { re: /(^|\/)D\d{3}-[AEPR]\d{2}\.md$/i, why: "caso de la biblioteca de precedentes (privado)" },
  { re: /MAT-\d{3}/i, why: "material real de prueba" },
  { re: /salida_agente/i, why: "salida interna del agente" },
  { re: /registro_gasto\//i, why: "registro de gasto del laboratorio" },
];

export function forbiddenPath(path) {
  const hit = FORBIDDEN_PATHS.find((rule) => rule.re.test(path));
  return hit ? hit.why : null;
}
