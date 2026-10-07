/**
 * PDF smoke (part of `pnpm check`): real PDFs, generated locally with the production engine and renderer, then checked in depth.
 *
 *   1. Runs `tests/pdf/` (vitest.pdf.config.mts): `MaterialDocument` → `RenderModel` → `renderPrintHtml` → `@sparticuz/chromium`
 *      via `playwright-core` → PDF → `validatePdf` → pdf.js text + 100 ppp PNG per page. Artefacts in `.pdf-smoke/`.
 *   2. Prints what a future export Function must carry (`outputFileTracingIncludes`), with sizes measured on disk.
 * Limits (stated, not hidden): it runs on this machine (the serverless Chromium needs Linux, like Vercel). No route exports
 * yet (Phase 5.2B), so there is no `.nft.json` to read: the list below is what that route's trace must contain.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const fail = (message) => {
  console.error(`smoke:pdf · FALLO · ${message}`);
  process.exit(1);
};
if (process.platform !== "linux") fail(`el Chromium serverless solo corre en Linux (esta máquina: ${process.platform}-${process.arch})`);

try {
  execFileSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.pdf.config.mts"], { stdio: "inherit" });
} catch {
  fail("la suite de PDF real no pasa (ver arriba)");
}

const size = (p) => {
  const s = statSync(p);
  return s.isDirectory() ? readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0) : s.size;
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const pkgDir = (name) => {
  let dir = path.dirname(realpathSync(require.resolve(name)));
  while (!existsSync(path.join(dir, "package.json")) || JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name !== name) dir = path.dirname(dir);
  return dir;
};
const chromiumDir = pkgDir("@sparticuz/chromium");
const playwrightDir = pkgDir("playwright-core");
const bin = path.join(chromiumDir, "bin");
const rows = [
  ["@sparticuz/chromium/bin (comprimido, se extrae a /tmp)", size(bin)],
  ["@sparticuz/chromium/build", size(path.join(chromiumDir, "build"))],
  ["playwright-core (paquete completo)", size(playwrightDir)],
  ["src/components/material/material.css", size(path.join(root, "src/components/material/material.css"))],
  ["src/components/material/fonts", size(path.join(root, "src/components/material/fonts"))],
];
console.log("\nsmoke:pdf · lo que debe trazar la Function de exportación (5.2B):");
for (const [name, bytes] of rows) console.log(`  · ${name.padEnd(56)} ${mb(bytes)}`);
for (const f of readdirSync(bin)) console.log(`      bin/${f.padEnd(24)} ${mb(statSync(path.join(bin, f)).size)}`);
console.log(`  · total aproximado                                         ${mb(rows.reduce((n, [, b]) => n + b, 0))}`);
console.log("smoke:pdf · OK (validación en runtime de Vercel: DEFERRED)");
