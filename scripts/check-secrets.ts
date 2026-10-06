/**
 * Quality gate after `next build`: no server secret may appear in what the browser receives (static bundles), in the
 * pages rendered at build time, or in files that are kept around (eval results, snapshots).
 * It prints file paths and what kind of secret, never the secret.
 *
 *   pnpm check:secrets      (runs at the end of `pnpm check`; loads .env.local so real values are searched too)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { findSecrets, secretEnvValues } from "../src/lib/security/secret-scan";

const values = secretEnvValues(process.env);
const MAX_BYTES = 8 * 1024 * 1024;

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && statSync(full).size <= MAX_BYTES) yield full;
  }
}

const TARGETS: Array<{ dir: string; names: boolean; filter?: RegExp; why: string }> = [
  { dir: ".next/static", names: true, why: "bundle del navegador" },
  { dir: ".next/server/app", names: false, filter: /\.(html|rsc|body|meta)$/, why: "página renderizada en el build" },
  { dir: ".next/server/pages", names: false, filter: /\.(html|json)$/, why: "página renderizada en el build" },
  { dir: "evals/results", names: false, why: "resultado de evals" },
  { dir: "tests", names: false, filter: /__snapshots__|\.snap$/, why: "snapshot" },
];

let scanned = 0;
const problems: string[] = [];
for (const target of TARGETS) {
  for (const file of walk(target.dir)) {
    if (target.filter && !target.filter.test(file)) continue;
    scanned += 1;
    const hits = findSecrets(readFileSync(file, "utf8"), { values, names: target.names });
    for (const hit of hits) problems.push(`${file} (${target.why}): ${hit}`);
  }
}

console.log(`check:secrets · ${scanned} archivos revisados · ${values.length} secreto(s) real(es) buscados por valor (${values.map((v) => v.name).join(", ") || "ninguno cargado"})`);
if (!existsSync(".next/static")) console.log("  (no hay build: los bundles no se han podido revisar)");
if (problems.length > 0) {
  console.error("✗ Secretos donde no deben estar:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("✓ Ningún secreto en bundles, páginas renderizadas, resultados ni snapshots.");
