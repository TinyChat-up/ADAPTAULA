/**
 * Deployment smoke of the PDF rasteriser (run after `next build`; part of `pnpm check`).
 *
 * `next build` compiling is not evidence that the rasteriser works where it is deployed: pdf.js loads its worker and the standard
 * font data BY PATH at run time, and @napi-rs/canvas loads a native binary from a per-platform package. This script:
 *   1. reads the server trace (`.nft.json`) of every route that rasterises and checks those files are in it;
 *   2. copies ONLY the traced files into an empty directory (what a serverless bundle contains) and renders a synthetic PDF page
 *      there, from that copy, with the vector figure and a rotated page.
 * Limit (stated, not hidden): it runs on this machine's platform. It proves the trace is complete and the code path works from a
 * bundle-like tree; it does not execute the Linux x64 binary Vercel uses (that package is in the lockfile and installed there).
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const dist = process.env.NEXT_DIST_DIR || ".next";
const ROUTES = ["server/app/api/materials/[id]/pages/[page]/route.js.nft.json", "server/app/api/materials/[id]/visuals/[visualId]/route.js.nft.json"];
const fail = (message) => {
  console.error(`smoke:raster · FALLO · ${message}`);
  process.exit(1);
};

const traced = new Set();
for (const route of ROUTES) {
  const file = path.join(root, dist, route);
  if (!existsSync(file)) fail(`no existe la traza ${route} (¿se ejecutó next build?)`);
  const files = JSON.parse(readFileSync(file, "utf8")).files.map((f) => path.resolve(path.dirname(file), f));
  const has = (re) => files.some((f) => re.test(f.split(path.sep).join("/")));
  const checks = {
    "pdf.js (legacy)": /pdfjs-dist\/legacy\/build\/pdf\.mjs$/,
    "package.json de pdf.js (localiza las fuentes)": /pdfjs-dist\/package\.json$/,
    "worker de pdf.js": /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs$/,
    "fuentes estándar": /pdfjs-dist\/standard_fonts\/.+\.(pfb|ttf)$/,
    "@napi-rs/canvas": /@napi-rs\/canvas\/(index|js-binding)\.js$/,
    "binario nativo de la plataforma": /@napi-rs\/canvas-[a-z0-9-]+\/.+\.node$/,
  };
  for (const [name, re] of Object.entries(checks)) if (!has(re)) fail(`la traza de ${route} no incluye ${name}`);
  for (const f of files) if (f.includes(`${path.sep}node_modules${path.sep}`)) traced.add(f);
}

// A bundle-like tree: only the traced node_modules files, at their paths relative to the project root.
const bundle = mkdtempSync(path.join(tmpdir(), "adaptaula-raster-"));
try {
  for (const f of traced) {
    const rel = path.relative(root, f);
    if (rel.startsWith("..")) continue;
    cpSync(f, path.join(bundle, rel), { dereference: false, verbatimSymlinks: true, recursive: true });
  }
  writeFileSync(path.join(bundle, "package.json"), JSON.stringify({ name: "raster-bundle", private: true, type: "module" }));
  const probe = `
    import { PDFDocument, rgb, degrees } from ${JSON.stringify(path.join(root, "node_modules/pdf-lib/cjs/index.js"))};
    import { createRequire } from "node:module";
    import path from "node:path";
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const napi = await import(require.resolve("@napi-rs/canvas"));
    globalThis.Path2D ??= napi.Path2D; globalThis.DOMMatrix ??= napi.DOMMatrix; globalThis.ImageData ??= napi.ImageData;
    const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
    const fonts = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
    const doc = await PDFDocument.create();
    const p = doc.addPage([595.28, 841.89]);
    p.drawRectangle({ x: 40, y: 761.89, width: 40, height: 40, color: rgb(1, 0, 0) });
    p.drawText("1/2", { x: 100, y: 700, size: 14 });
    p.setRotation(degrees(90));
    const task = pdfjs.getDocument({ data: await doc.save(), standardFontDataUrl: fonts, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 200 / 72 });
    const canvas = napi.createCanvas(Math.round(vp.width), Math.round(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const px = ctx.getImageData(Math.round((1 - 60 / 841.89) * canvas.width), Math.round((60 / 595.28) * canvas.height), 1, 1).data;
    await task.destroy();
    if (!(canvas.width > canvas.height && px[0] > 200 && px[1] < 60)) { console.error("render incorrecto", canvas.width, canvas.height, [...px]); process.exit(1); }
    console.log(JSON.stringify({ width: canvas.width, height: canvas.height }));
  `;
  writeFileSync(path.join(bundle, "probe.mjs"), probe);
  const out = execFileSync(process.execPath, ["probe.mjs"], { cwd: bundle, encoding: "utf8" }).trim();
  console.log(`smoke:raster · ${traced.size} ficheros trazados · render desde la copia aislada: ${out} · plataforma ${process.platform}-${process.arch} (no es la de Vercel)`);
} finally {
  rmSync(bundle, { recursive: true, force: true });
}
