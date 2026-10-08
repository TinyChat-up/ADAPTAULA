import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { buildRenderModel, type RenderDesign } from "@/lib/render/model";
import { renderPrintHtml } from "@/lib/render/print/html";
import { validatePdf } from "@/lib/render/print/validation";
import { analyzePdf } from "../pdf/analyze";
import { engine } from "../pdf/harness";
import { PILOTS } from "./pilots";

/**
 * Sistema CLARO pilots: each one rendered by the product's renderer twice — `design: "claro"` (the proposal) and the current
 * design (the comparison) — and printed by the production engine. Output: docs/qa/phase8/claro-pilots (or `QA_OUT`).
 */
const OUT = path.resolve(process.env.QA_OUT ?? "docs/qa/phase8/claro-pilots");

async function greyscale(png: Buffer): Promise<Buffer> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  for (let i = 0; i < data.data.length; i += 4) data.data[i] = data.data[i + 1] = data.data[i + 2] = Math.round(0.299 * data.data[i]! + 0.587 * data.data[i + 1]! + 0.114 * data.data[i + 2]!);
  ctx.putImageData(data, 0, 0);
  return canvas.encode("png");
}

async function print(name: string, design: RenderDesign) {
  const { model, validation } = buildRenderModel((PILOTS.find((p) => p.name === name) ?? PILOTS[0]).doc(), { mode: "student", deferred: [], design });
  expect(validation.status).toBe("renderable");
  const out = await renderPrintHtml(model, []);
  const result = await engine.render(out.html, { fontFamily: out.fontFamily, fontWeights: out.fontWeights });
  expect((await validatePdf(result.pdf, { fontPrefix: "Inter", minImages: 0, minPages: 1 })).issues).toEqual([]);
  return { pdf: result.pdf, pages: await analyzePdf(result.pdf), html: out.html };
}

describe("Sistema CLARO · pilots", () => {
  mkdirSync(OUT, { recursive: true });
  for (const pilot of PILOTS) {
    it(`${pilot.name}: same renderer, readable in greyscale`, async () => {
      const claro = await print(pilot.name, "claro");
      writeFileSync(path.join(OUT, `${pilot.name}.pdf`), claro.pdf);
      writeFileSync(path.join(OUT, `${pilot.name}.png`), claro.pages[0]!.png);
      writeFileSync(path.join(OUT, `${pilot.name}-grises.png`), await greyscale(claro.pages[0]!.png));
      expect(claro.html).toContain('data-design="claro"');
      // Content decides the length: the pilots are not squeezed into one page any more.
      expect(claro.pages.length).toBeLessThanOrEqual(2);
      for (const page of claro.pages.slice(1)) writeFileSync(path.join(OUT, `${pilot.name}-${page.number}.png`), page.png);
      for (const page of claro.pages.slice(1)) writeFileSync(path.join(OUT, `${pilot.name}-${page.number}-grises.png`), await greyscale(page.png));
      // The same content in the current design, for the side-by-side comparison.
      const before = await print(pilot.name, "standard");
      before.pages.forEach((page) => writeFileSync(path.join(OUT, `${pilot.name}-anterior${before.pages.length > 1 ? `-${page.number}` : ""}.png`), page.png));
      writeFileSync(path.join(OUT, `${pilot.name}-anterior.pdf`), before.pdf);
    });
  }
});
