import { describe, expect, it } from "vitest";
import { generatedWidthMm } from "@/lib/render/generated";
import { buildRenderModel } from "@/lib/render/model";
import { assetRef } from "@/lib/render/print/pinned-assets";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { runMockRecreation } from "../support/recreation-mocks";
import { printPdf } from "./harness";
import { measureLayout } from "./layout-measurements";
import { twoEvidenceFields } from "@/lib/adaptation/evidence-space";

/**
 * The recreation route printed by the product's renderer and engine (docs/qa/recreacion-pedagogica): simulated Claude and simulated
 * OpenAI, every document and every page. Output in `.pdf-smoke/recreation-*`. The illustration is the local mock drawing: what is
 * tested is the route and the sheet, not a model.
 */
const authorized = runMockRecreation({ imagesAuthorized: true });
const withoutImages = runMockRecreation({ imagesAuthorized: false });

async function print(name: string, doc: MaterialDocument, run: Awaited<typeof authorized>) {
  const generated: Record<string, { src: string; widthMm: number }> = {};
  const pins = [];
  for (const [assetId, a] of run.assets) {
    generated[assetId] = { src: assetRef({ assetId, sha256: a.sha256 }), widthMm: generatedWidthMm(a.width, a.height) };
    pins.push({ assetId, sha256: a.sha256, mime: "image/png" as const, bytes: a.bytes });
  }
  const { model, validation } = buildRenderModel(doc, { mode: "student", deferred: [], generated });
  // Every stored picture the document points to (a generated image block or a card's picture) is pinned: nothing is fetched.
  const json = JSON.stringify(doc);
  const used = pins.filter((p) => json.includes(p.assetId));
  return { validation, pdf: await printPdf(name, model, used, used.length ? 1 : 0) };
}

const ready = async (run: Promise<Awaited<typeof authorized>>) => {
  const r = await run;
  if (r.outcome.status !== "ready") throw new Error(r.outcome.status);
  return { run: r, compiled: r.outcome.compiled };
};
const body = (pages: { body: string }[]) => pages.map((p) => p.body).join("\n");

describe("recreación del estanque · PDF del recorrido completo simulado", () => {
  it("ficha del alumno: ilustración en la página de la actividad 1, sin páginas casi vacías, sin la clave", async () => {
    const { run, compiled } = await ready(authorized);
    const { validation, pdf } = await print("recreation-student", compiled.student, run);
    expect(validation.status).not.toBe("not_renderable");
    // The generated picture is reported as semantically unverified by the renderer: it says so, it does not hide it.
    expect(validation.issues.some((i) => i.code === "visual_semantics_unverified")).toBe(true);
    expect(pdf.validation.issues).toEqual([]);
    expect(pdf.result.blockedRequests).toEqual([]);
    for (const page of pdf.pages.slice(0, -1)) expect(page.ink).toBeGreaterThan(0.03);
    const first = pdf.pages.findIndex((p) => p.text.includes("ser vivo o un elemento no vivo"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(pdf.pages[first]!.png.byteLength).toBeGreaterThan(10_000);
    const text = body(pdf.pages);
    for (const label of ["Algas", "Larvas de insectos", "Ranas", "Garzas"]) expect(text).toContain(label);
    expect(text).not.toMatch(/Criterios|Guía docente|SIN COMPROBAR|Solución|Clave/);
    expect(text).not.toMatch(/\b12 cm\b/);
  });

  it("materiales para recortar: tarjetas grandes con línea de corte y el tablero de clasificación, con sus instrucciones", async () => {
    const { run, compiled } = await ready(authorized);
    const { validation, pdf } = await print("recreation-materials", compiled.materials!, run);
    expect(validation.status).toBe("renderable");
    expect(pdf.validation.issues).toEqual([]);
    expect(pdf.pages.length).toBeLessThanOrEqual(2);
    const text = body(pdf.pages);
    expect(text).toContain("Recorta las tarjetas");
    expect(text).toContain("Coloca cada tarjeta en su columna");
    for (const card of ["Algas", "Agua", "Larvas de insectos", "Luz solar", "Garzas", "Temperatura", "Ser vivo", "Elemento no vivo"]) expect(text).toContain(card);
    expect(pdf.print.html).toContain('class="ms-cutcards" data-illustrated="true"');
    expect(pdf.result.blockedRequests).toEqual([]);
    // Each card carries its own picture, and its name is printed by the renderer (not drawn by the image model).
    expect((pdf.print.html.match(/class="ms-cutcard-picture"/g) ?? []).length).toBe(6);
    expect(pdf.print.html).toContain('class="ms-sortboard"');
  });

  it("postura y dos evidencias tienen espacio medible en el PDF al forzar salto junto a una ilustración", async () => {
    const { run, compiled } = await ready(authorized);
    const doc = structuredClone(compiled.student);
    const blocks = doc.pages[0]!.blocks;
    const item = blocks.find((b) => b.type === "activity" && b.label === "6");
    if (item?.type !== "activity") throw new Error("open question missing");
    item.prompt = "Defiende tu postura con dos evidencias del texto.";
    item.response = twoEvidenceFields(item.prompt)!;
    const sit = blocks.find((b) => b.type === "image" && b.source.kind === "generated");
    if (sit?.type !== "image") throw new Error("context image missing");
    // The pupil receives the actual generated-asset slot immediately before this activity.
    item.resource_block_ids = [sit.id];
    blocks.splice(blocks.indexOf(sit), 1);
    blocks.splice(blocks.indexOf(item), 0, sit);
    const { pdf } = await print("recreation-writing-space", doc, run);
    const measure = await measureLayout(pdf.print.html);
    expect(measure.fields.filter((f) => f.label?.includes("Evidencia")).map((f) => f.lines)).toEqual([3, 3]);
    const printed = pdf.pages.find((p) => p.text.includes("Defiende tu postura"));
    expect(printed?.text).toContain("Mi postura");
    expect(printed?.text).toContain("Evidencia 1");
    expect(printed?.text).toContain("Evidencia 2");
    expect(pdf.result.blockedRequests).toEqual([]);
    expect(pdf.validation.issues).toEqual([]);
  });

  it("no se produce ninguna clave ni informe para imprimir: solo la ficha y los materiales", async () => {
    const { compiled } = await ready(authorized);
    expect(Object.keys(compiled).sort()).toEqual(["materials", "student", "trace", "unresolved"]);
  });

  it("sin imágenes autorizadas: la ficha se imprime sin la ilustración y la guía dice por qué", async () => {
    const { run, compiled } = await ready(withoutImages);
    const student = await print("recreation-student-sin-imagenes", compiled.student, run);
    expect(student.validation.status).toBe("renderable");
    for (const page of student.pdf.pages) {
      expect(page.body.trim().length).toBeGreaterThan(45);
      expect(page.ink).toBeGreaterThan(0.02);
    }
    const operations = student.pdf.pages.find((p) => /Operaciones\s*:/.test(p.text));
    expect(operations?.text ?? "").toMatch(/Resultado\s*:/);
    expect(operations?.text ?? "").toMatch(/Unidad\s*:/);
    expect(student.pdf.pages.find((p) => p.body.includes("vivo o un elemento no vivo"))?.body).toContain("del documento");
    const layout = await measureLayout(student.pdf.print.html);
    expect(layout.grids.some((g) => g.heightMm >= 34 && g.widthMm > 110)).toBe(true);
    expect(run.outcome.status === "ready" && run.outcome.visuals[0]!.attempts.join(" ")).toContain("generación no disponible");
  });
});
