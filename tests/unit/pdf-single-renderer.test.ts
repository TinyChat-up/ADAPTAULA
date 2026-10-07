import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One renderer: the screen and the PDF are the same `MaterialDocument → buildRenderModel → MaterialSheet + material.css`. These
 * guards fail as soon as someone adds a second path (a PDF library, a parallel builder, Chromium driven from elsewhere).
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : /\.(ts|tsx)$/.test(n) ? [path.join(dir, n)] : []));
const files = walk(SRC).filter((f) => !f.endsWith(".test.ts"));
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const importing = (re: RegExp) => files.filter((f) => re.test(readFileSync(f, "utf8"))).map(rel).sort();

describe("single renderer for screen and PDF", () => {
  it("buildRenderModel is called only by the shared loader (sheetModel); the viewer and the export both use it", () => {
    expect(importing(/\bbuildRenderModel\(/)).toEqual(["lib/render/load.ts", "lib/render/model.ts"]);
    expect(read("app/app/(shell)/adaptaciones/[id]/vista/page.tsx")).toMatch(/sheetModel\(loaded, /);
    const exporter = read("lib/render/pdf-export.ts");
    expect(exporter).toMatch(/sheetModel\(loaded, "student"\)/);
    expect(exporter).toMatch(/renderPrintHtml\(model, loaded\.pinned\)/);
    expect(exporter).toMatch(/deps\.engine\.render\(print\.html, /);
  });

  it("the print HTML is the app's MaterialSheet with the app's material.css", () => {
    const html = read("lib/render/print/html.ts");
    expect(html).toMatch(/import \{ MaterialSheet \} from "@\/components\/material\/sheet"/);
    expect(html).toMatch(/createElement\(MaterialSheet, \{ model \}\)/);
    expect(read("lib/render/print/sheet-assets.ts")).toMatch(/SHEET_DIR = "src\/components\/material"/);
  });

  it("only the engine drives Chromium and only the engine makes PDFs; no PDF-drawing library is used in the app", () => {
    expect(importing(/from "(playwright-core|@sparticuz\/chromium|playwright)"/)).toEqual(["lib/render/print/engine.ts"]);
    expect(importing(/\.pdf\(\{/)).toEqual(["lib/render/print/engine.ts"]);
    expect(importing(/from "(@react-pdf\/[a-z-]+|pdfkit|jspdf|pdfmake|puppeteer[a-z-]*)"/)).toEqual([]);
    // pdf-lib only reads: the production validation, and the rasteriser's page geometry.
    for (const f of importing(/from "pdf-lib"/)) expect(readFileSync(path.join(SRC, f), "utf8")).not.toMatch(/PDFDocument\.create\(|\.drawText\(|\.addPage\(/);
  });

  it("the export route goes through the export service, never through the engine or the HTML directly", () => {
    const route = read("app/api/adaptations/[id]/pdf/route.ts");
    expect(route).toMatch(/exportAdaptationPdf\(/);
    expect(route).not.toMatch(/renderPrintHtml|buildRenderModel|createChromiumPdfEngine|MaterialSheet/);
    expect(route).not.toMatch(/\bafter\(|setTimeout|void exportAdaptationPdf/);
  });
});
