/**
 * PDF smoke (part of `pnpm check`): real PDFs, generated locally with the production engine and renderer, then checked in depth.
 *
 *   1. Runs `tests/pdf/` (vitest.pdf.config.mts): `MaterialDocument` → `RenderModel` → `renderPrintHtml` → `@sparticuz/chromium`
 *      via `playwright-core` → PDF → `validatePdf` → pdf.js text + 100 ppp PNG per page. Artefacts in `.pdf-smoke/`.
 *      `tests/pdf/export.test.ts` drives the product route `GET /api/adaptations/[id]/pdf` end to end (PGlite, real crops).
 *   2. Reads that route's server trace (`.nft.json`, so run after `next build`) and checks it carries what the engine reads by
 *      path at run time: the compressed Chromium, `playwright-core` (and its `browsers.json`), `material.css` and the sheet fonts,
 *      all by physical path.
 *   3. Copies ONLY the traced files to a scratch directory (what the Function gets) and loads there, in a separate Node process,
 *      the external packages the route imports. A file the tracer missed makes the route's module fail to load: every PDF a 500.
 * Limits (stated, not hidden): it runs on this machine (the serverless Chromium needs Linux, like Vercel). It does not execute the
 * Function in Vercel's runtime: that validation is DEFERRED (docs/ADAPTATION.md § Exportación PDF).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
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

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// 2. The export route's server trace must carry what the engine reads BY PATH at run time (next.config.ts, PDF_FILES).
const dist = process.env.NEXT_DIST_DIR || ".next";
const traceFile = path.join(root, dist, "server/app/api/adaptations/[id]/pdf/route.js.nft.json");
if (!existsSync(traceFile)) fail("no existe la traza de /api/adaptations/[id]/pdf (¿se ejecutó next build?)");
const traced = JSON.parse(readFileSync(traceFile, "utf8")).files.map((f) => path.resolve(path.dirname(traceFile), f));
const posix = traced.map((f) => f.split(path.sep).join("/"));
const checks = {
  "Chromium serverless comprimido (@sparticuz/chromium/bin/chromium.br)": /@sparticuz\/chromium\/bin\/chromium\.br$/,
  "@sparticuz/chromium (código)": /@sparticuz\/chromium\/build\/.+\.js$/,
  "playwright-core": /playwright-core\/lib\/.+\.js$/,
  "playwright-core/browsers.json (lo exige al cargarse)": /playwright-core\/browsers\.json$/,
  "material.css": /src\/components\/material\/material\.css$/,
  "Inter-Regular.woff2": /src\/components\/material\/fonts\/Inter-Regular\.woff2$/,
  "Inter-SemiBold.woff2": /src\/components\/material\/fonts\/Inter-SemiBold\.woff2$/,
  "Inter-Bold.woff2": /src\/components\/material\/fonts\/Inter-Bold\.woff2$/,
};
for (const [name, re] of Object.entries(checks)) {
  const hit = traced.find((_, i) => re.test(posix[i]));
  if (!hit) fail(`la traza de la exportación no incluye ${name}`);
  // pnpm: by its physical path, never through a node_modules/<pkg> symlink (what made Vercel reject the package; next.tracing.ts).
  if (realpathSync(hit) !== hit) fail(`la traza incluye ${name} a través de un symlink: ${path.relative(root, hit)}`);
}
const logical = posix.filter((f) => f.startsWith(`${root.split(path.sep).join("/")}/node_modules/@sparticuz/`));
if (logical.length > 0) fail(`la traza incluye ${logical.length} rutas lógicas de @sparticuz/chromium (symlink de pnpm)`);
const tracedBytes = traced.filter((f) => existsSync(f) && statSync(f).isFile()).reduce((n, f) => n + statSync(f).size, 0);
console.log(`\nsmoke:pdf · traza de /api/adaptations/[id]/pdf: ${traced.length} ficheros, ${mb(tracedBytes)} (Chromium comprimido incluido)`);

// 3. The route's externals (`<dist>/node_modules/<pkg>-<hash>`, Turbopack) loaded from the traced files alone.
const stage = mkdtempSync(path.join(tmpdir(), "adaptaula-function-"));
for (const file of traced) {
  if (!file.startsWith(root + path.sep)) continue;
  const target = path.join(stage, path.relative(root, file));
  mkdirSync(path.dirname(target), { recursive: true });
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) symlinkSync(readlinkSync(file), target);
  // The compressed binaries are only read when Chromium is unpacked, never to load the package.
  else if (stat.isFile() && !file.endsWith(".br")) copyFileSync(file, target);
}
const externalsDir = path.join(stage, dist, "node_modules");
const externals = [...new Set(traced.map((f) => path.relative(path.join(root, dist, "node_modules"), f)).filter((r) => !r.startsWith("..")).map((r) => r.split(path.sep).slice(0, r.startsWith("@") ? 2 : 1).join("/")))];
for (const name of ["@sparticuz/chromium", "playwright-core"]) {
  const external = externals.find((e) => e.startsWith(`${name}-`));
  if (!external) fail(`la traza de la exportación no incluye el módulo externo ${name}`);
  const loader = `import { createRequire } from "node:module"; import { pathToFileURL } from "node:url"; await import(pathToFileURL(createRequire(process.argv[1] + "/").resolve(process.argv[2])).href);`;
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", loader, externalsDir, external], { cwd: stage, stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    fail(`${name} no carga con solo los ficheros trazados (la ruta daría 500): ${String(error.stderr ?? error.message).split("\n").find((l) => /^\s*\w*Error:/.test(l))?.trim() ?? "error"}`);
  }
}
rmSync(stage, { recursive: true, force: true });
console.log(`smoke:pdf · la ruta carga con solo su traza: ${["@sparticuz/chromium", "playwright-core"].join(", ")}`);

const report = path.join(root, ".pdf-smoke/export-report.json");
if (existsSync(report)) {
  console.log("smoke:pdf · exportación de producto (ruta real, local), petición completa:");
  for (const r of JSON.parse(readFileSync(report, "utf8"))) console.log(`  · ${String(r.case).padEnd(16)} ${String(r.pages).padStart(3)} pág.  ${String(r.kb).padStart(4)} KB  ${String(r.requestMs).padStart(5)} ms`);
}
console.log("smoke:pdf · OK (validación en runtime de Vercel: DEFERRED)");
