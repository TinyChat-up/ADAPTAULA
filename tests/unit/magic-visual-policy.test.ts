import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { VisualNeedsPanel } from "@/components/material/visual-needs-panel";
import { deterministicChecks } from "@/lib/adaptation/review";
import { applyVisualResolution, visualNeedsOfDocument, type VisualResolutionPlan } from "@/lib/adaptation/visual-policy";
import { resolveMagicVisuals, validateRewrite, validateSupport, type MagicVisualDeps } from "@/lib/materials/visuals/auto/policy";
import type { VisualAssistants } from "@/lib/materials/visuals/auto/assistants";
import { buildRenderModel, flatNodes } from "@/lib/render/model";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import { specFromAnalysis } from "@/lib/visuals/from-analysis";
import { fractionsCaseDocument } from "../support/fractions-case";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/**
 * The visual policy of «Hacer magia»: every visual need resolved by the server, in order (locate → reconstruct → generate →
 * rewrite / leave out → honest stop), never by asking the teacher. 0 real model calls: the assistants are scripted.
 */

const run = { purpose: "visual_rewrite" as const, attempt: 1, alias: "STANDARD" as const, provider: "mock" as const, model: "m", effort: "low" as const, promptKey: "k", promptVersion: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 0, status: "success" as const, errorCode: null };
const scripted = (over: Partial<{ support: Awaited<ReturnType<VisualAssistants["support"]>>["draft"]; rewrite: Awaited<ReturnType<VisualAssistants["rewrite"]>>["draft"] }> = {}): VisualAssistants & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    support: async () => (calls.push("support"), { draft: over.support ?? null, run }),
    rewrite: async () => (calls.push("rewrite"), { draft: over.rewrite ?? null, run }),
  };
};
const deps = (ready: string[], assistants: VisualAssistants | null = null): MagicVisualDeps => ({ readyOriginals: async () => new Set(ready), assistants });

/** The fractions sheet with its two required originals; `describe` replaces the analysis's words of a visual. */
function sheet(edit?: (a: ReturnType<typeof fractionsCaseDocument>["analysis"]) => void) {
  const base = fractionsCaseDocument();
  edit?.(base.analysis);
  return base;
}
const resolve = (s: ReturnType<typeof sheet>, d: MagicVisualDeps) => resolveMagicVisuals(d, { analysis: s.analysis, document: s.document, requiredVisuals: ["vis_1", "vis_2"], stage: "primaria" });
const outcome = (plan: VisualResolutionPlan, key: string) => plan.needs.find((n) => n.key === key)!;

describe("classification and order of the rungs", () => {
  it("1 · located in the original (automatic or a person's): kept as the exact original; nothing else is tried", async () => {
    const plan = await resolve(sheet(), deps(["vis_1", "vis_2"]));
    expect(plan.needs.map((n) => [n.key, n.category, n.resolution.action, n.attempts.join(">")])).toEqual([
      ["vis_1", "exact_original_visual", "located", "locate"],
      ["vis_2", "exact_original_visual", "located", "locate"],
    ]);
  });

  it("2 · not found in the pixels: rebuilt from the analysis's complete description (bar 3/8, line 0–1 in quarters), verified", async () => {
    const plan = await resolve(sheet(), deps([]));
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "reconstructable_structured_visual", resolution: { action: "figure", provenance: "reconstruction", spec: { kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } }, attempts: ["locate", "reconstruct"] });
    expect(outcome(plan, "vis_2")).toMatchObject({ resolution: { action: "figure", spec: { kind: "number_line", divisions: 4, labels: [{ text: "0" }, { text: "1/4" }, { text: "1/2" }, { text: "3/4" }, { text: "1" }] } } });
  });

  it("4 · neither located nor rebuildable, but the activity can live without it: rewritten (validated), never a request to the teacher", async () => {
    const s = sheet((a) => (a.visuals[1] = { ...a.visuals[1]!, kind: "image", description: "Dibujo de una jarra de agua de un litro con cuatro marcas iguales." }));
    const assistants = scripted({ rewrite: { feasible: true, prompt: "Una jarra de un litro tiene cuatro marcas iguales. Escribe qué fracción del litro indica la tercera marca: 3/4 en la recta.", steps: [], lines: 2 } });
    // The draft names «3/4» — the task's own datum («Marca 3/4…»), which must be kept — and no image: valid.
    const plan = await resolve(s, deps(["vis_1"], assistants));
    expect(outcome(plan, "vis_2")).toMatchObject({ category: "rewritable_without_visual", resolution: { action: "rewrite", activities: [{ activityId: "act_4" }] }, attempts: ["locate", "reconstruct", "rewrite"] });
  });

  it("5 · nothing reliable: unresolved (the honest stop), with every rung recorded", async () => {
    const s = sheet((a) => (a.visuals[1] = { ...a.visuals[1]!, kind: "image", description: "Dibujo de una jarra." }));
    const plan = await resolve(s, deps(["vis_1"], scripted({ rewrite: { feasible: false, prompt: null, steps: null, lines: null } })));
    expect(outcome(plan, "vis_2")).toMatchObject({ category: "unresolved_visual", resolution: { action: "unresolved" }, attempts: ["locate", "reconstruct", "rewrite"] });
  });

  it("a located figure is never replaced by a rebuilt one (a person's or the locator's crop wins)", async () => {
    const plan = await resolve(sheet(), deps(["vis_1"]));
    expect(outcome(plan, "vis_1").resolution).toEqual({ action: "located" });
    expect(outcome(plan, "vis_2").resolution.action).toBe("figure");
  });
});

describe("the model's drafts are hypotheses: validated before they reach a sheet", () => {
  const activity = "Marca 3/4 en la recta numérica.";
  it("a rewrite that drops a datum, mentions an image, copies the task or gives the answer is refused", () => {
    expect(validateRewrite({ feasible: true, prompt: "Marca la fracción en la recta dibujada.", steps: null, lines: 2 }, activity, "", [])).toBeNull();
    expect(validateRewrite({ feasible: true, prompt: "Observa la imagen y marca 3/4 donde corresponde.", steps: null, lines: 2 }, activity, "", [])).toBeNull();
    expect(validateRewrite({ feasible: true, prompt: activity, steps: null, lines: 2 }, activity, "", [])).toBeNull();
    expect(validateRewrite({ feasible: true, prompt: "Ana bebe 3/4 y 1/4 de litro. Bebe 1 litro en total.", steps: null, lines: 2 }, "Ana bebe 3/4 de litro y 1/4 de litro. ¿Cuánto bebe?", "", ["1 litro"])).toBeNull();
    expect(validateRewrite({ feasible: true, prompt: "Divide el segmento de 0 a 1 en cuatro partes iguales y escribe dónde iría 3/4.", steps: ["Divide.", "Escribe."], lines: 2 }, activity, "", [])).toMatchObject({ lines: 2 });
  });

  it("a new support must be short, not a copy of the task and without its answer", () => {
    const task = "Ana bebe 3/4 de litro por la mañana y 1/4 por la tarde. ¿Cuántos litros bebe en total?";
    expect(validateSupport({ useful: true, kind: "steps", title: "Antes de sumar", steps: ["Mira si los denominadores son iguales.", "Suma solo los numeradores."], cards: null }, task, ["1 litro"])).toMatchObject({ kind: "steps" });
    expect(validateSupport({ useful: true, kind: "steps", title: null, steps: ["Suma: el total es 1 litro.", "Escríbelo."], cards: null }, task, ["1 litro"])).toBeNull();
    expect(validateSupport({ useful: false, kind: null, title: null, steps: null, cards: null }, task, [])).toBeNull();
    expect(validateSupport({ useful: true, kind: "cards", title: null, steps: null, cards: [{ term: "<b>x</b>", hint: "y" }, { term: "a", hint: "b" }] }, task, [])).toBeNull();
  });

  it("the analysis's description is used only when complete and without marked points", () => {
    expect(specFromAnalysis({ kind: "number_line", title: null, description: "Recta numérica de 0 a 1 con un punto marcado en 3/4.", text: null })).toBeNull();
    expect(specFromAnalysis({ kind: "geometric_figure", title: null, description: "Rectángulo dividido en 4 partes iguales.", text: null })).toBeNull();
    expect(specFromAnalysis({ kind: "diagram", title: null, description: "Cuadrícula de 3 filas y 4 columnas con 5 casillas sombreadas.", text: null })).toMatchObject({ kind: "grid", rows: 3, cols: 4 });
  });
});

describe("applied to the sheet: complete, with each figure in its activity, and a review that passes", () => {
  it("rebuilt figures take the image's place (same activity, same links); the deterministic review finds nothing to FAIL", async () => {
    const s = sheet();
    const plan = await resolve(s, deps([]));
    const doc = applyVisualResolution(s.document, plan);
    const figures = allBlocks(doc).filter((b) => b.type === "image" && b.source.kind === "figure");
    expect(figures).toHaveLength(2);
    expect(deterministicChecks({ analysis: s.analysis, plan: s.plan, context: s.context, document: doc } as never).filter((c) => c.status === "FAIL")).toEqual([]);
    const { model, validation } = buildRenderModel(doc, { mode: "student", design: "claro", requiredVisuals: ["vis_1", "vis_2"], deferred: [] });
    expect(validation.status).not.toBe("not_renderable");
    const act1 = model.pages.flatMap((p) => p.nodes).find((n) => n.kind === "activity" && n.label === "1");
    expect(act1?.kind === "activity" && act1.figures[0]).toMatchObject({ kind: "image", state: "available", spec: { kind: "fraction_bar" } });
    expect(flatNodes(model.pages.flatMap((p) => p.nodes)).filter((n) => n.kind === "image" && n.state !== "available")).toEqual([]);
  });

  it("a rewrite removes the image and its link, answers on lines, and keeps the activity's label and trace to the visual", async () => {
    const s = sheet((a) => (a.visuals[1] = { ...a.visuals[1]!, kind: "image", description: "Dibujo de una jarra." }));
    const plan = await resolve(s, deps(["vis_1"], scripted({ rewrite: { feasible: true, prompt: "Divide el segmento de 0 a 1 en cuatro partes iguales y escribe dónde iría 3/4.", steps: [], lines: 2 } })));
    const doc = applyVisualResolution(s.document, plan);
    expect(allBlocks(doc).some((b) => b.type === "image" && b.source.kind === "original" && b.source.visual_ref === "vis_2")).toBe(false);
    const act4 = allBlocks(doc).find((b) => b.type === "activity" && b.label === "4");
    expect(act4).toMatchObject({ prompt: expect.stringContaining("cuatro partes"), response: { kind: "lines", lines: 2 }, trace: { origin: "adapted", source_refs: ["act_4", "vis_2"] } });
    expect(deterministicChecks({ analysis: s.analysis, plan: s.plan, context: s.context, document: doc } as never).filter((c) => c.status === "FAIL")).toEqual([]);
  });

  it("3 · a support a decision asked for is generated (steps), drawn in the CLARO style inside its activity; an optional one that fails is left out", async () => {
    const s = sheet();
    const block = allBlocks(s.document).find((b) => b.type === "activity" && b.label === "3")!;
    const withRequest = structuredClone(s.document) as MaterialDocument;
    const page = withRequest.pages.find((p) => p.blocks.some((b) => b.id === block.id))!;
    const at = page.blocks.findIndex((b) => b.id === block.id);
    page.blocks.splice(at, 0, { id: "blk_req1", type: "image", source: { kind: "requested", decision_id: "dec_3", purpose: "Secuencia para sumar fracciones", style: "diagram", essential: true }, alt_text: "Recurso visual de la actividad", trace: { origin: "adapted", source_refs: ["act_3"], decision_ids: ["dec_3"] } });
    page.blocks[at + 1] = { ...(page.blocks[at + 1] as Extract<MaterialDocument["pages"][number]["blocks"][number], { type: "activity" }>), resource_block_ids: ["blk_req1"] };
    const needs = visualNeedsOfDocument(withRequest, ["vis_1", "vis_2"]);
    expect(needs.find((n) => n.key === "dec_3")).toMatchObject({ origin: "requested", essential: true, activityIds: ["act_3"] });
    const assistants = scripted({ support: { useful: true, kind: "steps", title: "Para sumar fracciones", steps: ["Comprueba que los denominadores son iguales.", "Suma los numeradores.", "Mantén el denominador."], cards: null } });
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(["vis_1", "vis_2"]), assistants }, { analysis: s.analysis, document: withRequest, requiredVisuals: ["vis_1", "vis_2"], stage: "primaria" });
    expect(outcome(plan, "dec_3")).toMatchObject({ category: "generatable_support_visual", resolution: { action: "figure", provenance: "generated", spec: { kind: "steps" } } });
    const doc = applyVisualResolution(withRequest, plan);
    const html = renderToStaticMarkup(createElement(MaterialSheet, { model: buildRenderModel(doc, { mode: "student", design: "claro", requiredVisuals: [], deferred: [] }).model }));
    expect(html).toContain('data-spec="steps"');
    expect(html).toContain("Mantén el denominador.");

    const optional = structuredClone(withRequest);
    const req = allBlocks(optional).find((b) => b.id === "blk_req1")!;
    if (req.type === "image" && req.source.kind === "requested") req.source.essential = false;
    const failed = await resolveMagicVisuals({ readyOriginals: async () => new Set(["vis_1", "vis_2"]), assistants: scripted() }, { analysis: s.analysis, document: optional, requiredVisuals: [], stage: "primaria" });
    expect(outcome(failed, "dec_3")).toMatchObject({ category: "rewritable_without_visual", resolution: { action: "omit", reason: "optional_support" } });
    expect(allBlocks(applyVisualResolution(optional, failed)).some((b) => b.id === "blk_req1")).toBe(false);
  });
});

describe("what the teacher sees in «Hacer magia»: never a step to complete an image", () => {
  const need = { key: "vis_2", origin: "original" as const, essential: true, status: "to_select" as const, label: "Imagen del documento original", activity: "Actividad 4", message: "x", omittable: false };
  const html = (manual: boolean) => renderToStaticMarkup(createElement(VisualNeedsPanel, { needs: [need, { ...need, key: "dec_1", origin: "requested", status: "to_provide", essential: false, omittable: true }], adaptationId: "a", canWrite: true, locateHref: () => "/x", manual, editHref: "/vista?editar=1" }));
  it("magic: no «Localizar en el original», no «Añadir imagen», no «Continuar sin esta imagen», no «Buscar»; an honest line and «editarla»", () => {
    const out = html(false);
    for (const forbidden of ["Localizar en el original", "No está en el original", "Añadir", "Continuar sin esta imagen", "Buscar en el original"]) expect(out).not.toContain(forbidden);
    expect(out).toContain("No hemos podido completar automáticamente");
    expect(out).toContain("editarla tú");
  });
  it("edit / «Revisar antes de crear»: the manual controls stay", () => {
    const out = html(true);
    expect(out).toContain("Localizar en el original");
    expect(out).toContain("Buscar en el original");
  });
});
