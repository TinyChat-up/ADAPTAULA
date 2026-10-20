import { mkdirSync, writeFileSync } from "node:fs";
import { checkReference } from "../../evals/claro-quality/check";
import { plantAsset } from "../../evals/claro-quality/plant";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { buildRenderModel } from "@/lib/render/model";
import { renderPrintHtml } from "@/lib/render/print/html";
import { qualityCorpus } from "../../evals/claro-quality/corpus";
import { printPdf } from "./harness";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"], headless: true }); });
afterAll(async () => { await browser?.close(); });

describe("CLARO: papel real y legibilidad", () => {
  for (const c of qualityCorpus.filter(c => process.env.CLARO_INCLUDE_RESERVE === "1" || c.split === "development")) {
    it(`${c.id}: contenido íntegro y figura junto a consigna`, async () => {
      const original = createHash("sha256").update(JSON.stringify(c.document)).digest("hex");
      const plant = c.id === "06-planta" ? await plantAsset() : null;
      const { model, validation } = buildRenderModel(c.document, { mode: "student", design: "claro", deferred: [], ...(plant ? { assets: { vis_1: plant.source }, requiredVisuals: ["vis_1"] } : {}) });
      expect(validation.status).not.toBe("not_renderable");
      const printed = await printPdf(`quality-${process.env.CLARO_SNAPSHOT ?? "after"}-${c.id}`, model, plant ? [plant.pin] : [], plant ? 1 : 0);
      expect(printed.validation.issues).toEqual([]);
      expect(printed.pages.every(p => p.marginInk < 10)).toBe(true);
      const text = printed.pages.map(p => p.text).join(" ");
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
      for (const task of c.reference.tasks) expect(normalize(text)).toContain(normalize(task.instruction));
      for (const b of c.document.pages.flatMap(p => p.blocks)) if (b.type === "reading_text") {
        for (const paragraph of b.paragraphs) expect(normalize(text)).toContain(normalize(paragraph));
      }
      const findings = checkReference(c.document, c.reference);
      expect(findings.filter(f => f.status === "fail")).toEqual([]);
      const dir = `.pdf-smoke/quality-${process.env.CLARO_SNAPSHOT ?? "after"}-${c.id}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/report.json`, JSON.stringify({ id: c.id, split: c.split, course: c.document.meta.grade, objective: c.objective, pages: printed.pages.length, renderMs: printed.result.timings, peakChromiumRssMb: printed.peakRssMb, sourceSha256: original, pdfSha256: createHash("sha256").update(printed.result.pdf).digest("hex"), findings }, null, 2));
      for (const forbidden of c.reference.forbidden) expect(text).not.toContain(forbidden);
      expect(createHash("sha256").update(JSON.stringify(c.document)).digest("hex")).toBe(original);
    });
  }
  it("la figura exclusiva no queda en una hoja distinta de su consigna", async () => {
    const doc = structuredClone(qualityCorpus[0]!.document);
    const blocks = doc.pages[0]!.blocks;
    const image = blocks.find(b => b.type === "image")!;
    if (image.type !== "image") throw Error("fixture");
    image.caption = "Recurso de la primera actividad";
    blocks.splice(2, 0, ...Array.from({ length: 10 }, (_, i) => ({ id: `blk_text${i}`, type: "paragraph" as const, text: "Antes de responder, lee esta información de práctica. Trabaja con calma y explica tus decisiones por escrito.", trace: { origin: "original" as const, source_refs: [], decision_ids: [] } })));
    const { model } = buildRenderModel(doc, { mode: "student", design: "claro", deferred: [] });
    const printed = await printPdf(`quality-${process.env.CLARO_SNAPSHOT ?? "after"}-pagination`, model);
    const figurePage = printed.pages.findIndex(p => p.text.includes("Recurso de la primera actividad"));
    const taskPage = printed.pages.findIndex(p => p.text.includes("Escribe la fracción sombreada"));
    expect(figurePage).toBe(taskPage);
  });
  it("la recta conserva todas sus etiquetas legibles sin colisiones", async () => {
    const c = qualityCorpus.find(c => c.id === "03-rectas")!;
    const { model } = buildRenderModel(c.document, { mode: "student", design: "claro" });
    const html = await renderPrintHtml(model, []);
    const page = await browser.newPage();
    try {
      await page.setContent(html.html);
      await page.evaluate(() => document.fonts.ready);
      const boxes = await page.locator('.ms-spec[data-spec="number_line"] text').evaluateAll(nodes => nodes.map(n => {
        const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
      }));
      expect(boxes).toHaveLength(25);
      const collisions = boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
      expect(collisions).toEqual([]);
      expect(boxes.every(b => b.height >= 14)).toBe(true);
    } finally { await page.close(); }
  });
});
