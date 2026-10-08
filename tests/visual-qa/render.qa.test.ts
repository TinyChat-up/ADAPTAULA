import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Sparticuz from "@sparticuz/chromium";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { buildRenderModel } from "@/lib/render/model";
import { renderPrintHtml } from "@/lib/render/print/html";
import { assetRef } from "@/lib/render/print/pinned-assets";
import { validatePdf } from "@/lib/render/print/validation";
import { analyzePdf } from "../pdf/analyze";
import { engine } from "../pdf/harness";
import { FIXTURES, climographPng, pinOf } from "./fixtures";

/**
 * Renders every QA sheet exactly as the product does (`buildRenderModel` → `renderPrintHtml` → production Chromium engine → PDF)
 * and writes what a person needs to judge it: the PDF, every page as PNG in colour and in greyscale (as a school printer would
 * print it) and a screenshot of the same HTML on screen. Output: `QA_OUT` (default docs/qa/phase8/after).
 */
const OUT = path.resolve(process.env.QA_OUT ?? "docs/qa/phase8/after");
const summary: Array<{ name: string; label: string; pages: number; kb: number }> = [];

async function greyscale(png: Buffer): Promise<Buffer> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const y = Math.round(0.299 * data.data[i]! + 0.587 * data.data[i + 1]! + 0.114 * data.data[i + 2]!);
    data.data[i] = data.data[i + 1] = data.data[i + 2] = y;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.encode("png");
}

async function screenshot(html: string): Promise<Buffer> {
  Sparticuz.setGraphicsMode = false;
  const browser = await chromium.launch({ executablePath: await Sparticuz.executablePath(), args: Sparticuz.args, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
    // The same document the PDF prints, seen on screen: the sheets inside the viewer's grey stage, as the app shows them.
    await page.setContent(html.replace('<div class="ms-root"', '<div class="ms-stage"><div class="ms-root"').replace(/<\/body>/, "</div></body>"), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ fullPage: true });
  } finally {
    await browser.close();
  }
}

describe("Phase 8 · visual QA sheets", () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      const doc = fixture.doc();
      const pin = pinOf("5c0ffee0-1c2d-4e5f-8a9b-0c1d2e3f4a5b", await climographPng());
      const visual = doc.pages.flatMap((p) => p.blocks).some((bl) => bl.type === "image");
      const { model, validation } = buildRenderModel(doc, { mode: "student", deferred: [], ...(visual ? { assets: { vis_1: { src: assetRef(pin) } }, requiredVisuals: ["vis_1"] } : {}) });
      expect(validation.status).not.toBe("not_renderable");
      const print = await renderPrintHtml(model, visual ? [pin] : []);
      const result = await engine.render(print.html, { fontFamily: print.fontFamily, fontWeights: print.fontWeights });
      const check = await validatePdf(result.pdf, { fontPrefix: "Inter", minImages: visual ? 1 : 0, minPages: model.pages.length });
      expect(check.issues).toEqual([]);
      const pages = await analyzePdf(result.pdf);
      const dir = path.join(OUT, fixture.name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "ficha.pdf"), result.pdf);
      for (const page of pages) {
        writeFileSync(path.join(dir, `pagina-${page.number}.png`), page.png);
        writeFileSync(path.join(dir, `pagina-${page.number}-grises.png`), await greyscale(page.png));
      }
      writeFileSync(path.join(dir, "pantalla.png"), await screenshot(print.html));
      summary.push({ name: fixture.name, label: fixture.label, pages: pages.length, kb: Math.round(result.pdf.length / 1024) });
    });
  }

  afterAll(() => {
    writeFileSync(path.join(OUT, "resumen.json"), `${JSON.stringify(summary, null, 2)}\n`);
  });
});
