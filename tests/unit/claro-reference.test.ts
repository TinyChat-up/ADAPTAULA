import { describe, expect, it } from "vitest";
import { checkReference } from "../../evals/claro-quality/check";
import { qualityCorpus, type QualityCase } from "../../evals/claro-quality/corpus";
import { VisualSpecSchema } from "@/lib/visuals/spec";
import { validateBrief, acceptReview } from "@/lib/visuals/illustration";
import { CELL_ACTIVITY_1, CELL_BRIEF, CELL_REVIEW_APPROVED } from "../support/cell-case";
const failed = (c: QualityCase) => checkReference(c.document, c.reference).filter(r => r.status === "fail");
const bars = () => structuredClone(qualityCorpus[0]!);

describe("Referencias independientes: adversarios acotados, nunca aprobación pedagógica", () => {
  for (const c of qualityCorpus.filter(c => c.split === "development")) it(`${c.id}: datos estructurales frente a su referencia manual`, () => expect(failed(c)).toEqual([]));
  it.each(["parts", "shaded"] as const)("detecta %s cambiado aunque la figura siga siendo internamente válida", field => {
    const c = bars(); const b = c.document.pages[0]!.blocks.find(b => b.type === "image")!;
    if (b.type !== "image" || b.source.kind !== "figure" || b.source.spec.kind !== "fraction_bar") throw Error("fixture");
    if (field === "parts") b.source.spec.parts = 10; else b.source.spec.shaded = [0, 1];
    expect(failed(c).some(f => f.property.endsWith(":reference"))).toBe(true);
  });
  it("falta el marcador 3: no lo reemplaza un alt que lo menciona", () => {
    const c = bars(); const b = c.document.pages[0]!.blocks.find(b => b.type === "image")!;
    if (b.type !== "image") throw Error("fixture");
    b.source = { kind: "figure", provenance: "reconstruction", spec: { spec_version: 1, kind: "number_line", start: { n: 1, d: 1 }, end: { n: 3, d: 1 }, divisions: 2, labels: [{ tick: 0, text: "1" }, { tick: 1, text: "2" }] } };
    b.alt_text = "Los números 1, 2 y 3";
    c.reference.figures = [{ id: b.id, markers: ["1", "2", "3"] }];
    expect(failed(c).some(f => f.property.endsWith(":markers"))).toBe(true);
  });
  it.each([
    { spec_version: 1, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 2, d: 1 }, divisions: 2, labels: [{ tick: 1, text: "1" }, { tick: 1, text: "1" }] },
    { spec_version: 1, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 2, d: 1 }, divisions: 2, labels: [{ tick: 0, text: "1" }] },
    { spec_version: 1, kind: "grid", rows: 2, cols: 2, shaded: [4] },
  ])("rechaza duplicados, valor en marca incorrecta y celda fuera de rango: $kind", spec => expect(VisualSpecSchema.safeParse(spec).success).toBe(false));
  it("detecta una unidad incompatible con los datos verificados", () => {
    const c = structuredClone(qualityCorpus.find(c => c.id === "05-clasificacion")!);
    const b = c.document.pages[0]!.blocks.find(b => b.type === "table")!;
    if (b.type !== "table") throw Error("fixture");
    b.unit = "kg";
    c.reference.tables[0]!.unit = "m";
    expect(failed(c).some(f => f.property.endsWith(":unit"))).toBe(true);
  });
  it("detecta una figura inexistente y una respuesta colocada en el texto", () => {
    const c = bars(); const task = c.document.pages[0]!.blocks.find(b => b.type === "activity")!;
    if (task.type !== "activity") throw Error("fixture");
    task.resource_block_ids = ["blk_missing"];
    expect(failed(c).some(f => f.property === "schema")).toBe(true);
    task.resource_block_ids = ["blk_bar1"];
    task.prompt += " La fracción sombreada es 3/8.";
    expect(failed(c).some(f => f.property.startsWith("hidden:"))).toBe(true);
  });
  it("PNG opaco: metadatos y revisor simulado aprobados no son evidencia independiente", () => {
    const brief = validateBrief(CELL_BRIEF, { activity: CELL_ACTIVITY_1, expectedAnswer: null, signatures: [], lowDetail: true });
    expect(brief.ok).toBe(true);
    if (!brief.ok) throw Error("fixture");
    expect(acceptReview(CELL_REVIEW_APPROVED, brief.brief).ok).toBe(true);
    const c = structuredClone(qualityCorpus.find(c => c.id === "06-planta")!);
    const b = c.document.pages[0]!.blocks.find(b => b.type === "image")!;
    if (b.type !== "image") throw Error("fixture");
    b.alt_text = "Todos los marcadores correctos, verificados por el modelo";
    expect(checkReference(c.document, c.reference).find(f => f.property.endsWith(":pixels"))?.status).toBe("unverified");
  });
});
