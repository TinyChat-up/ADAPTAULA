/**
 * Control de privacidad del repositorio público (ADR-044). Falla si un archivo:
 *   - tiene una ruta reservada al material privado (materiales reales, reglas V2.2, biblioteca, laboratorio, bundles, ZIP);
 *   - es una copia exacta de un archivo privado conocido (huella SHA-256 del archivo);
 *   - contiene una frase de un documento privado (huella de la frase normalizada).
 * Informa de la ruta y del tipo de coincidencia, nunca del texto.
 *
 *   node scripts/privacy/check-private-content.mjs              archivos versionados (árbol de trabajo)
 *   node scripts/privacy/check-private-content.mjs --staged     lo que se va a confirmar (pre-commit)
 *   node scripts/privacy/check-private-content.mjs --range A..B cada archivo añadido o cambiado en cada commit (CI)
 *
 * Límite: el texto de un PDF del repositorio no se extrae (sí su huella completa); una paráfrasis no se reconoce.
 * Por eso esto complementa, no sustituye, la revisión humana de la PR.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileHash, forbiddenPath, isText, unitHash, units } from "./fingerprint-lib.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const git = (args, opts = {}) => execFileSync("git", args, { maxBuffer: 256 * 1024 * 1024, ...opts });

export function loadFingerprints(file = path.join(HERE, "private-fingerprints.json")) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  return { files: new Set(data.files_sha256), units: new Set(data.units_sha256_64) };
}

/** Problems of one file: forbidden path, private file copy, or private sentences. Never returns the matched text. */
export function inspect(relPath, bytes, fp) {
  const problems = [];
  // The fingerprint list itself and this checker are the only places allowed to hold hashes and path rules.
  if (relPath.startsWith("scripts/privacy/")) return problems;
  const why = forbiddenPath(relPath);
  if (why) problems.push(`ruta reservada (${why})`);
  if (bytes) {
    if (fp.files.has(fileHash(bytes))) problems.push("copia exacta de un archivo privado");
    if (bytes.length <= MAX_TEXT_BYTES && isText(bytes)) {
      let hits = 0;
      for (const u of units(bytes.toString("utf8"))) if (fp.units.has(unitHash(u))) hits += 1;
      if (hits > 0) problems.push(`${hits} frase(s) de un documento privado`);
    }
  }
  return problems;
}

function tracked() {
  return git(["ls-files", "-z"]).toString().split("\0").filter(Boolean).map((p) => ({ where: p, path: p, read: () => (existsSync(p) ? readFileSync(p) : null) }));
}

function staged() {
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).toString().split("\0").filter(Boolean);
  return out.map((p) => ({ where: `${p} (preparado)`, path: p, read: () => git(["show", `:${p}`]) }));
}

function range(spec) {
  const commits = git(["rev-list", "--reverse", spec]).toString().split("\n").filter(Boolean);
  const items = [];
  for (const c of commits) {
    const changed = git(["diff-tree", "-r", "--root", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-z", c]).toString().split("\0").filter(Boolean);
    for (const p of changed) items.push({ where: `${p} (commit ${c.slice(0, 9)})`, path: p, read: () => git(["show", `${c}:${p}`]) });
  }
  return { items, commits: commits.length };
}

function main() {
  const args = process.argv.slice(2);
  const fp = loadFingerprints();
  let items;
  let label;
  if (args[0] === "--staged") {
    items = staged();
    label = "archivos preparados";
  } else if (args[0] === "--range") {
    if (!args[1]) throw new Error("Falta el rango: --range base..HEAD");
    const r = range(args[1]);
    items = r.items;
    label = `cambios en ${r.commits} commit(s) de ${args[1]}`;
  } else {
    items = tracked();
    label = "archivos versionados";
  }
  const problems = [];
  for (const item of items) for (const p of inspect(item.path, item.read(), fp)) problems.push(`${item.where}: ${p}`);
  console.log(`privacidad · ${items.length} ${label} · ${fp.files.size} huellas de archivo y ${fp.units.size} de frase`);
  if (problems.length > 0) {
    console.error("✗ Material privado en el repositorio público (ADR-044). No confirmes ni subas estos archivos:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("✓ Sin material privado.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
