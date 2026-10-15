/**
 * Smoke of the PDF Function AS VERCEL DEPLOYS IT (`pnpm smoke:vercel-pdf`): the deployment artefact of `vercel build`, not the
 * standalone trace that `smoke:pdf` checks. It answers the two questions of the production error
 * («Failed to load external module playwright-core-…: Cannot find module …/playwright-core/browsers.json»):
 *
 *   1. Is `browsers.json` inside the Function, at the physical path `playwright-core` computes from its own location? The Function is
 *      materialised from `.vercel/output/functions/api/adaptations/[id]/pdf.func` exactly as Vercel packs it: its own files plus every
 *      entry of `.vc-config.json › filePathMap`, symlinks kept as symlinks (pnpm's store and Turbopack's
 *      `.next/node_modules/<pkg>-<hash>` aliases), nothing else from this machine.
 *   2. Can the route load its modules? The Function is started with Vercel's own launcher (`___next_launcher.cjs`, the real Next
 *      server) and an anonymous `GET /api/adaptations/<id>/pdf` must reach the authentication check: 401, never a 500.
 *   3. Does the PDF ENGINE work from those files alone? Through the Function's own Turbopack aliases (`playwright-core-<hash>`,
 *      `@sparticuz/chromium-<hash>`), the serverless Chromium is unpacked and a one-line page is printed to a real PDF. This is the
 *      engine's technical success only: no sheet, no learner data, no pedagogical state (a sheet with a pending essential visual
 *      answers 409 by design, docs/VISUAL_RESOURCES.md).
 *
 * A NEGATIVE CONTROL runs the same Function without `browsers.json`: it must fail exactly like production did (500), or this smoke
 * could not tell a broken Function from a good one.
 *
 * Usage: `pnpm smoke:vercel-pdf` (runs `vercel build` first, pinned CLI, offline project settings, dummy public env) or
 * `node scripts/smoke-vercel-pdf.mjs --no-build` on an existing `.vercel/output`. It never deploys and never reads a secret.
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const VERCEL_CLI = "vercel@63.1.2";
const FUNC = path.join(root, ".vercel/output/functions/api/adaptations/[id]/pdf.func");
const ADAPTATION = "336eb273-5818-411d-867c-2d9240aecb0d";
/** Public values only (never a secret): the route needs a syntactically valid Supabase URL and key to reach its auth check. */
const DUMMY_PUBLIC_ENV = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_smoke_only_not_a_real_key",
};

const fail = (message) => {
  console.error(`smoke:vercel-pdf · FALLO · ${message}`);
  process.exit(1);
};
const ok = (message) => console.log(`smoke:vercel-pdf · ok · ${message}`);

if (!process.argv.includes("--no-build")) {
  // Offline project settings for the build (no ids, no API call). An existing linked project is left untouched.
  const projectFile = path.join(root, ".vercel/project.json");
  const created = !existsSync(projectFile);
  if (created) {
    mkdirSync(path.dirname(projectFile), { recursive: true });
    writeFileSync(projectFile, JSON.stringify({ projectId: "smoke", orgId: "smoke", settings: { framework: "nextjs" } }));
  }
  try {
    execFileSync("npx", ["--yes", VERCEL_CLI, "build", "--prod", "--yes"], { stdio: "inherit", env: { ...process.env, ...DUMMY_PUBLIC_ENV } });
  } catch {
    fail("vercel build no termina (ver arriba)");
  } finally {
    if (created) rmSync(projectFile);
  }
}
if (!existsSync(path.join(FUNC, ".vc-config.json"))) fail(`no existe ${path.relative(root, FUNC)} (¿se ejecutó vercel build?)`);

/** The Function as Vercel packs it, in a fresh directory: its own files plus `filePathMap` (destination ← source). */
function materialise({ withoutBrowsersJson }) {
  const dir = mkdtempSync(path.join(tmpdir(), "vercel-pdf-func-"));
  for (const entry of readdirSync(FUNC)) if (entry !== ".vc-config.json") cpSync(path.join(FUNC, entry), path.join(dir, entry), { recursive: true, verbatimSymlinks: true });
  const { filePathMap } = JSON.parse(readFileSync(path.join(FUNC, ".vc-config.json"), "utf8"));
  for (const [dest, src] of Object.entries(filePathMap)) {
    if (withoutBrowsersJson && /playwright-core\/browsers\.json$/.test(dest)) continue;
    const from = path.resolve(root, src);
    const to = path.join(dir, dest);
    mkdirSync(path.dirname(to), { recursive: true });
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) {
      if (!existsSync(to)) symlinkSync(readlinkSync(from), to);
    } else if (stat.isDirectory()) mkdirSync(to, { recursive: true });
    else copyFileSync(from, to);
  }
  return dir;
}

/** Where `playwright-core` will look for `browsers.json` in that Function: next to its package root, after following the Turbopack alias. */
function browsersJsonPath(dir) {
  const aliases = path.join(dir, ".next/node_modules");
  const alias = existsSync(aliases) ? readdirSync(aliases).find((n) => n.startsWith("playwright-core-")) : undefined;
  if (!alias) fail("la Function no tiene el alias externo de Turbopack para playwright-core (.next/node_modules/playwright-core-<hash>)");
  const pkg = realpathSync(path.join(aliases, alias));
  if (!pkg.startsWith(realpathSync(dir) + path.sep)) fail(`el alias de playwright-core sale de la Function: ${pkg}`);
  return { alias, file: path.join(pkg, "browsers.json"), relative: path.relative(realpathSync(dir), path.join(pkg, "browsers.json")) };
}

/** Vercel's launcher, served on a free port; one anonymous GET to the export route. */
async function anonymousGet(dir) {
  const port = 3300 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ["-e", `const h=require("./___next_launcher.cjs");require("node:http").createServer((q,s)=>h(q,s)).listen(${port},()=>console.log("listening"))`], {
    cwd: dir,
    env: { PATH: process.env.PATH, NODE_ENV: "production", VERCEL_REGION: "fra1", ...DUMMY_PUBLIC_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  try {
    for (let i = 0; i < 100 && !log.includes("listening"); i++) await new Promise((r) => setTimeout(r, 100));
    if (!log.includes("listening")) return { status: 0, body: "", log };
    const res = await fetch(`http://127.0.0.1:${port}/api/adaptations/${ADAPTATION}/pdf`);
    const body = await res.text();
    await new Promise((r) => setTimeout(r, 200));
    return { status: res.status, body, log };
  } finally {
    server.kill("SIGKILL");
  }
}

/**
 * The engine's own launch (Sparticuz args minus the unsafe ones, as in src/lib/render/print/engine.ts), from the Function's files:
 * an ES module inside `.next/` imports the Turbopack aliases by bare name, which Node resolves in `.next/node_modules`, the way the
 * route's chunk does (`@sparticuz/chromium` is ESM-only).
 */
function printWithFunctionEngine(dir, playwrightAlias) {
  const sparticuz = readdirSync(path.join(dir, ".next/node_modules/@sparticuz")).find((n) => n.startsWith("chromium-"));
  if (!sparticuz) return { ok: false, error: "falta el alias de @sparticuz/chromium" };
  const entry = path.join(dir, ".next/__engine_smoke.mjs");
  writeFileSync(
    entry,
    `import playwright from "${playwrightAlias}";
import SparticuzModule from "@sparticuz/${sparticuz}";
const Sparticuz = SparticuzModule.default ?? SparticuzModule;
const unsafe = new Set(["--disable-web-security", "--allow-running-insecure-content"]);
try {
  const browser = await playwright.chromium.launch({ executablePath: await Sparticuz.executablePath(), args: Sparticuz.args.filter((a) => !unsafe.has(a)), headless: true, timeout: 60000 });
  const page = await (await browser.newContext({ offline: true })).newPage();
  await page.setContent("<p>Adaptaula · smoke del motor PDF</p>", { waitUntil: "load" });
  const pdf = await page.pdf({ format: "A4" });
  const chromium = browser.version();
  await browser.close().catch(() => {});
  process.stdout.write(JSON.stringify({ bytes: pdf.length, head: pdf.subarray(0, 5).toString("latin1"), chromium }));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: String((e && e.message) || e).split(String.fromCharCode(10))[0] }));
}
`,
  );
  try {
    const out = JSON.parse(execFileSync(process.execPath, [entry], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production" }, timeout: 120_000 }).toString());
    if (out.error) return { ok: false, error: out.error };
    return out.head === "%PDF-" && out.bytes > 500 ? { ok: true, ...out } : { ok: false, error: `la salida no es un PDF (${out.head}, ${out.bytes} bytes)` };
  } catch (error) {
    return { ok: false, error: `${String(error.stderr ?? "").slice(-600)} ${String(error.stdout ?? "").slice(-300)}`.trim() || String(error.message).slice(0, 300) };
  } finally {
    rmSync(entry, { force: true });
  }
}

// 1-3. The Function as deployed.
const good = materialise({ withoutBrowsersJson: false });
try {
  const where = browsersJsonPath(good);
  if (!existsSync(where.file)) fail(`browsers.json no está donde playwright-core lo busca: ${where.relative}`);
  ok(`browsers.json presente en la ruta física que calcula playwright-core: /var/task/${where.relative} (alias ${where.alias})`);
  const res = await anonymousGet(good);
  if (res.status !== 401 || !res.body.includes('"unauthenticated"')) fail(`GET anónimo a la ruta PDF: HTTP ${res.status} (se esperaba 401)\n${res.body.slice(0, 300)}\n${res.log.slice(-1500)}`);
  ok("GET anónimo /api/adaptations/[id]/pdf → 401 unauthenticated: los módulos de la ruta (playwright-core incluido) cargan antes de autenticar");
  const printed = printWithFunctionEngine(good, where.alias);
  if (!printed.ok) fail(`el motor PDF no imprime desde los ficheros de la Function: ${printed.error}`);
  ok(`motor PDF desde la Function: Chromium ${printed.chromium} + playwright-core → PDF de ${printed.bytes} bytes (cabecera %PDF-)`);
} finally {
  rmSync(good, { recursive: true, force: true });
}

// Negative control: the same Function without browsers.json must break the way production did.
const broken = materialise({ withoutBrowsersJson: true });
try {
  const res = await anonymousGet(broken);
  if (res.status !== 500 || !/browsers\.json/.test(res.log)) fail(`control negativo: sin browsers.json se esperaba HTTP 500 con el error de producción y se obtuvo ${res.status}`);
  ok("control negativo: sin browsers.json la misma Function da 500 «Failed to load external module playwright-core-…» (el smoke detecta el fallo)");
} finally {
  rmSync(broken, { recursive: true, force: true });
}
