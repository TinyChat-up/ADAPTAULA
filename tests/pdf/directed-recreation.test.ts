import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { runDirectedRecreation } from "@/lib/recreation/directed-pilot";
import { printDirectedRecreation } from "@/lib/recreation/directed-print";
import { candidateFor, completeOriginal, directorFixture, echoPlan, replacementPlan, shortOriginal } from "../support/directed-recreation";
import { pedagogicalOriginalPdf } from "../support/pedagogical-original";
import { analyzePdf, placedText } from "./analyze";
import { engine, OUT_DIR } from "./harness";

describe("director pedagógico a PDF A4 con el renderizador existente", () => {
  it("imprime la consigna, la lectura, el gráfico y la argumentación y conserva un recurso fijado", async () => {
    const source = completeOriginal();
    const picture = createCanvas(300, 110);
    const ctx = picture.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 300, 110);
    ctx.fillStyle = "#ce1919";
    ctx.fillRect(20, 20, 65, 65);
    ctx.fillStyle = "#171717";
    ctx.font = "26px sans-serif";
    ctx.fillText("Muestra A", 108, 64);
    const bytes = picture.toBuffer("image/png");
    source.visuals.push({ id: "sample", kind: "image", page: 1, role: "required", title: "Muestra del material", description: "Muestra A." });
    const task = source.activities[3]!;
    task.instruction += " Observa la muestra.";
    task.resources.push("sample");
    task.comprehension.essential_resources.push({ resource_ref: "sample", evidence: { source_ref: "a4", quote: "Observa la muestra" } });
    const pdf = await PDFDocument.load(await pedagogicalOriginalPdf(source));
    const image = await pdf.embedPng(bytes);
    pdf.getPages()[0]!.drawImage(image, { x: 35, y: 285, width: 150, height: 55 });
    const { input, original } = await directorFixture({ draft: source, originalFile: await pdf.save() });
    const candidate = { version: 1, activities: [candidateFor(input, "act_3"), candidateFor(input, "act_5")] };
    const options = { original, plannerFixture: echoPlan, candidate };
    const missing = await runDirectedRecreation(input, options);
    expect(missing).toMatchObject({ status: "blocked", issues: [{ code: "original_asset_unavailable", original_id: "act_4", ref: "vis_2" }] });
    const draft = await runDirectedRecreation(input, { ...options, originalAssets: [{
      original_sha256: input.originalSha256, visual_ref: "vis_2", widthMm: 65,
      pin: { assetId: "02c5bf29-b221-4d8b-a65d-c5b10c18934a", mime: "image/png", bytes, sha256: createHash("sha256").update(bytes).digest("hex") },
    }] });
    if (draft.status === "blocked") throw new Error(JSON.stringify(draft.issues));
    const printed = await printDirectedRecreation(draft, engine);
    if (printed.status === "blocked") throw new Error(JSON.stringify(printed.issues));
    expect(printed.checks).toMatchObject({ pdf: "passed", semantic: "pending" });
    expect(printed.validation).toMatchObject({ ok: true, imageCount: 1 });
    const pages = await analyzePdf(printed.pdf);
    const text = pages.map((page) => page.body).join(" ");
    for (const token of ["qué operaciones necesitas y en qué orden", "75 por la mañana y 32 por la tarde",
      "recogió su mapa", "con dos argumentos", "Visitas a la biblioteca", "Marzo", "Abril", "Muestra del material"]) {
      expect(text).toContain(token);
    }
    expect(text).not.toMatch(/Solución|Clave de respuestas/iu);
    expect(text).not.toMatch(/Orientación|Localiza la consigna/iu);
    const graphic = pages.find((page) => page.body.includes("Visitas a la biblioteca"))!;
    expect(graphic.body).toMatch(/12/u);
    expect(graphic.body).toMatch(/20/u);
    expect(graphic.contentInk).toBeGreaterThan(0.01);
    const printedPicture = pages.find((page) => page.body.includes("Muestra del material"))!;
    expect(printedPicture.red?.count ?? 0).toBeGreaterThan(100);
    const glyphs = (await placedText(printed.pdf)).flat();
    const label = glyphs.find(({ str }) => str === "Marzo");
    expect(label?.height ?? 0).toBeGreaterThan(6);
  });

  it("Fase 4.1 · imprime condiciones resaltadas, la comprobación final y espacio para argumentar, sin páginas vacías", async () => {
    const { input, original } = await directorFixture();
    const draft = await runDirectedRecreation(input, { original, plannerFixture: echoPlan });
    if (draft.status === "blocked") throw new Error(JSON.stringify(draft.issues));
    const printed = await printDirectedRecreation(draft, engine);
    if (printed.status === "blocked") throw new Error(JSON.stringify(printed.issues));
    const pages = await analyzePdf(printed.pdf);
    const dir = path.join(OUT_DIR, "directed-fase-4-1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "sheet.pdf"), printed.pdf);
    for (const page of pages) writeFileSync(path.join(dir, `page-${page.number}.png`), page.png);
    const text = pages.map(({ body }) => body).join(" ");
    expect(text).toMatch(/Antes de entregar, comprueba/iu);
    expect(text).toContain("Con dos argumentos");
    expect(text).toContain("Hay 150 plazas. Se han reservado 75 por la mañana y 32 por la tarde");
    expect(text).not.toMatch(/Orientación|Localiza la consigna/iu);
    // Every page carries an activity: the extra space and the checklist never leave a page with only a header.
    for (const page of pages) expect(page.body, `página ${page.number}`).toMatch(/Decide qué operaciones|Escribe un texto|Usa el gráfico/u);
  });

  it("imprime la sustitución abierta con su condición, sin publicar los criterios internos ni aprobar su equivalencia", async () => {
    const { input, original } = await directorFixture({ draft: shortOriginal() });
    const draft = await runDirectedRecreation(input, { original, plannerFixture: replacementPlan,
      candidate: { version: 1, activities: [candidateFor(input, "act_2", true)] } });
    if (draft.status === "blocked") throw new Error(JSON.stringify(draft.issues));
    const printed = await printDirectedRecreation(draft, engine);
    if (printed.status === "blocked") throw new Error(JSON.stringify(printed.issues));
    const text = (await analyzePdf(printed.pdf)).map(({ body }) => body).join(" ");
    expect(text).toContain("Tu compañero busca a la exploradora");
    expect(text).toContain("Menciona el nombre del lugar");
    expect(text.match(/Menciona el nombre del lugar/gu)).toHaveLength(1);
    expect(text).not.toContain("Identifica el lugar al que volvió");
    expect(printed.checks).toMatchObject({ legacy_replacement: "passed", pdf: "passed", semantic: "pending" });
  });
});
