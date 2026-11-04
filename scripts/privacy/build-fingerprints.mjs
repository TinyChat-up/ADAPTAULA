/**
 * Regenera `scripts/privacy/private-fingerprints.json` a partir de copias LOCALES del material privado (reglas V2.2, biblioteca
 * de precedentes, laboratorio, materiales reales y sus oráculos). Se ejecuta solo en la máquina de quien tiene ese material;
 * los archivos de origen nunca se leen desde el repositorio ni se copian a él.
 *
 *   node scripts/privacy/build-fingerprints.mjs <archivo-o-carpeta>...
 *
 * Solo se escriben huellas. Las frases que ya están en el repositorio público (por ejemplo, un identificador de dimensión
 * o una frase genérica) se excluyen para no bloquear contenido que ya era público.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileHash, isText, unitHash, units } from "./fingerprint-lib.mjs";

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "private-fingerprints.json");
const sources = process.argv.slice(2);
if (sources.length === 0) {
  console.error("Uso: node scripts/privacy/build-fingerprints.mjs <archivo-o-carpeta>...");
  process.exit(2);
}

function* walk(p) {
  const st = statSync(p);
  if (st.isFile()) yield p;
  else if (st.isDirectory()) for (const e of readdirSync(p)) if (e !== ".git" && e !== ".venv" && e !== "__pycache__") yield* walk(path.join(p, e));
}

function strings(value, out) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

function textOf(file, bytes) {
  if (/\.pdf$/i.test(file)) {
    try {
      return execFileSync("pdftotext", ["-enc", "UTF-8", file, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
    } catch {
      console.warn(`  (sin texto: pdftotext no pudo leer ${path.basename(file)}; solo huella del archivo)`);
      return "";
    }
  }
  if (!isText(bytes)) return "";
  const text = bytes.toString("utf8");
  if (/\.json$/i.test(file)) {
    try {
      return `${text}\n${strings(JSON.parse(text), []).join("\n")}`;
    } catch {
      return text;
    }
  }
  return text;
}

const files = new Set();
const privateUnits = new Set();
let count = 0;
for (const source of sources) {
  if (!existsSync(source)) throw new Error(`No existe: ${source}`);
  for (const file of walk(source)) {
    const bytes = readFileSync(file);
    files.add(fileHash(bytes));
    for (const u of units(textOf(file, bytes))) privateUnits.add(u);
    count += 1;
  }
}

// What is already public cannot be protected by hiding it, and flagging it would only block legitimate work.
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const publicUnits = new Set();
for (const rel of execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot }).toString().split("\0").filter(Boolean)) {
  if (rel.startsWith("scripts/privacy/")) continue;
  const full = path.join(repoRoot, rel);
  if (!existsSync(full) || statSync(full).size > 5 * 1024 * 1024) continue;
  const bytes = readFileSync(full);
  if (isText(bytes)) for (const u of units(bytes.toString("utf8"))) publicUnits.add(u);
}
const kept = [...privateUnits].filter((u) => !publicUnits.has(u));

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      version: 1,
      note: "Huellas de material privado (ADR-044). No contiene texto. Regenerar con scripts/privacy/build-fingerprints.mjs.",
      sources: { files: count, units: privateUnits.size, already_public: privateUnits.size - kept.length },
      files_sha256: [...files].sort(),
      units_sha256_64: kept.map(unitHash).sort(),
    },
    null,
    0,
  )}\n`,
);
console.log(`✓ ${count} archivos, ${files.size} huellas de archivo, ${kept.length} huellas de frase (${privateUnits.size - kept.length} ya públicas, excluidas).`);
