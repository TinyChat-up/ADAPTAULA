import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { renderPrintHtml } from "@/lib/render/print/html";
import { buildRenderModel } from "@/lib/render/model";
import { documentOf, sheet } from "../support/real-run-v3-synthetic";
import { localChromium, printPdf } from "./harness";

/**
 * The structural defects of the real run v3 on REAL paper (Chromium → PDF → pdf.js text): the synthetic equivalents of sheets 02,
 * 04, 05 and 08 (tests/support/real-run-v3-synthetic.ts). Not «the PDF is valid»: each defect has its own assertion.
 */

const print = async (id: string) => {
  const { model, validation } = buildRenderModel(documentOf(sheet(id)), { mode: "student", design: "claro", deferred: [] });
  expect(validation.status).not.toBe("not_renderable");
  const printed = await printPdf(`real-run-v3-${id}`, model);
  expect(printed.validation.issues).toEqual([]);
  return { printed, text: printed.pages.map((p) => p.text).join("\n"), base: model.tokens };
};

/** Runs `probe` on the print HTML laid out by a real Chromium at A4 print width (the page's CSP forbids scripts: `page.evaluate` only). */
async function measure<T>(id: string, probe: () => T): Promise<T> {
  const { model } = buildRenderModel(documentOf(sheet(id)), { mode: "student", design: "claro", deferred: [] });
  const { html } = await renderPrintHtml(model, []);
  const browser = await chromium.launch({ executablePath: localChromium(), args: ["--no-sandbox"], headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    await page.emulateMedia({ media: "print" });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(probe);
  } finally {
    await browser.close();
  }
}

describe("prueba real v3 · defectos estructurales sobre papel (sintéticos)", () => {
  it("02 · «Operaciones y unidades» y «Respuesta» impresos en cada problema", async () => {
    const { text } = await print("02-problemas");
    expect(text.match(/Operaciones y unidades/g)).toHaveLength(2);
    expect(text.match(/Respuesta/g)).toHaveLength(2);
  });

  it("04 · el diálogo y los cuatro elementos de ordenación se imprimen enteros; «01» ocupa una sola línea en Chromium", async () => {
    const { text } = await print("04-lectura");
    for (const item of ["Comieron junto al puente.", "Subieron al autobús.", "Vieron una garza en la orilla.", "Volvieron cantando al colegio."]) expect(text.replace(/\s+/g, " ")).toContain(item);
    expect(text).toContain("¿Veremos peces? —preguntó Hugo.");
    const layout = await measure("04-lectura", () => {
      const lineCount = (el: Element) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
      };
      const nums = [...document.querySelectorAll(".ms-num")];
      const items = [...document.querySelectorAll(".ms-sequence > li")];
      return { nums: nums.map((n) => ({ text: n.textContent, lines: lineCount(n) })), items: items.length, boxes: document.querySelectorAll(".ms-sequence .ms-box-write").length };
    });
    expect(layout.nums.map((n) => n.text)).toEqual(["01", "02"]);
    expect(layout.nums.every((n) => n.lines === 1)).toBe(true);
    expect([layout.items, layout.boxes]).toEqual([4, 4]);
  });

  it("05 · las tres oraciones en líneas propias (también en Chromium) y los campos Sujeto/Predicado", async () => {
    const { text } = await print("05-oraciones");
    expect(text).toMatch(/1\. Los niños juegan en el parque\. 2\. Mi abuela/);
    expect(text).toMatch(/Sujeto :? ?.*Predicado/);
    const tops = await measure("05-oraciones", () => [...document.querySelectorAll(".ms-prompt span")].filter((s) => /^\d\. /.test(s.textContent ?? "")).map((s) => Math.round(s.getBoundingClientRect().top)));
    expect(tops).toHaveLength(3);
    expect(new Set(tops).size).toBe(3);
  });

  it("08 · un campo por lugar (Escuela, Hospital, Mercado) y la consigna sin los campos pegados", async () => {
    const { text } = await print("08-plano");
    for (const l of ["Escuela", "Hospital", "Mercado"]) expect(text).toContain(l);
    expect(text).toContain("Busca cada lugar en el plano y escribe sus coordenadas.");
  });
});
