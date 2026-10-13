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
import { consistentWithActivities, contradicts, sameStructure, specFromAnalysis } from "@/lib/visuals/from-analysis";
import type { VisualSpec } from "@/lib/visuals/spec";
import { fractionsCaseDocument } from "../support/fractions-case";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/**
 * The visual policy of «Hacer magia»: every visual need resolved by the server, in order (locate → reconstruct → generate →
 * rewrite / leave out → substitute → stop only when nothing valid can be built), never by asking the teacher. 0 real model
 * calls: the assistants are scripted.
 */

const run = { purpose: "visual_rewrite" as const, attempt: 1, alias: "STANDARD" as const, provider: "mock" as const, model: "m", effort: "low" as const, promptKey: "k", promptVersion: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 0, status: "success" as const, errorCode: null };
type Drafts = { support: Awaited<ReturnType<VisualAssistants["support"]>>["draft"]; rewrite: Awaited<ReturnType<VisualAssistants["rewrite"]>>["draft"]; substitute: Awaited<ReturnType<VisualAssistants["substitute"]>>["draft"] };
const scripted = (over: Partial<Drafts> = {}): VisualAssistants & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    support: async () => (calls.push("support"), { draft: over.support ?? null, run }),
    rewrite: async () => (calls.push("rewrite"), { draft: over.rewrite ?? null, run }),
    substitute: async () => (calls.push("substitute"), { draft: over.substitute ?? null, run }),
  };
};
const noFigure = null;
/** The bar of activity 1 described incompletely, and its answer not inferable: no figure can be derived from the material. */
const undeterminedBar = (a: ReturnType<typeof fractionsCaseDocument>["analysis"]) => {
  a.visuals[0] = { ...a.visuals[0]!, description: "Barra con algunas partes coloreadas." };
  Object.assign(a.activities.find((x) => x.id === "act_1")!, { expected_answer: { basis: "not_inferable", value: null } });
};
const BAR_SUBSTITUTE = { feasible: true, prompt: "Observa la barra. ¿Qué fracción de la barra está coloreada? Escríbela.", steps: [], lines: 1, figure: { kind: "fraction_bar" as const, parts: 6, shaded: 2, rows: null, cols: null, line_end: null, divisions: null } };
const deps = (ready: string[], assistants: VisualAssistants | null = null, pixels: Record<string, VisualSpec> = {}): MagicVisualDeps => ({ readyOriginals: async () => new Set(ready), assistants, corroborate: async (v) => pixels[v.id] ?? null });
/** What the ORIGINAL's pixels read (the shaded parts are wherever the original has them, not «from the left»). */
const PIXELS: Record<string, VisualSpec> = {
  vis_1: { spec_version: 1, kind: "fraction_bar", parts: 8, shaded: [0, 3, 5] },
  vis_2: { spec_version: 1, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [{ tick: 0, text: "0" }, { tick: 1, text: "1/4" }, { tick: 2, text: "1/2" }, { tick: 3, text: "3/4" }, { tick: 4, text: "1" }] },
};
/** The second visual turned into a mere data source (a label that carries a datum), used by a calculation. */
const dataSource = (a: ReturnType<typeof fractionsCaseDocument>["analysis"]) => {
  a.visuals[1] = { ...a.visuals[1]!, kind: "image", title: null, description: "Etiqueta de una botella de agua: 3/4 de litro.", text: null };
  Object.assign(a.activities.find((x) => x.id === "act_4")!, { instruction: "Calcula cuántos cuartos de litro le faltan a la botella para llegar a 1 litro.", response_format: "calculate", answer_area: { type: "lines", lines: 2 }, objective_ids: ["obj_3"] });
  a.protected_elements = a.protected_elements.filter((p) => !p.resource_ids.includes("vis_2"));
};
const DATA_REWRITE = { feasible: true, prompt: "La botella tiene 3/4 de litro de agua. Calcula cuántos cuartos de litro le faltan para llegar a 1 litro.", steps: [], lines: 2 };

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

  it("2 · not cropped, but the original's pixels read the figure the analysis describes: rebuilt FROM THE PIXELS (bar 3/8, line 0–1 in quarters)", async () => {
    const plan = await resolve(sheet(), deps([], null, PIXELS));
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "reconstructable_structured_visual", resolution: { action: "figure", provenance: "reconstruction", spec: { kind: "fraction_bar", parts: 8, shaded: [0, 3, 5] } }, attempts: ["locate", "reconstruct"] });
    expect(outcome(plan, "vis_2")).toMatchObject({ resolution: { action: "figure", spec: { kind: "number_line", divisions: 4, labels: [{ text: "0" }, { text: "1/4" }, { text: "1/2" }, { text: "3/4" }, { text: "1" }] } } });
  });

  it("3 · not in the PDF and not readable from pixels: a NEW figure of the same kind, from the material's own data, with no model", async () => {
    const assistants = scripted();
    const plan = await resolve(sheet(), deps([], assistants));
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "generatable_support_visual", resolution: { action: "figure", provenance: "generated", spec: { kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } }, attempts: ["locate", "reconstruct", "generate"] });
    expect(outcome(plan, "vis_2")).toMatchObject({ category: "generatable_support_visual", resolution: { action: "figure", provenance: "generated", spec: { kind: "number_line", divisions: 4 } } });
    expect(assistants.calls).toEqual([]);
  });

  it("3b · act 4 «Marca 3/4 en la recta» keeps its competence: a new line 0–1 in quarters (labels 0 and 1 only, never 3/4), never a text question", async () => {
    const s = sheet((a) => (a.visuals[1] = { ...a.visuals[1]!, kind: "image", description: "Dibujo de una jarra de agua de un litro con cuatro marcas iguales." }));
    const assistants = scripted({ rewrite: { feasible: true, prompt: "Escribe qué fracción del litro indica la tercera marca: 3/4.", steps: [], lines: 2 } });
    const plan = await resolve(s, deps(["vis_1"], assistants));
    expect(outcome(plan, "vis_2")).toMatchObject({ category: "generatable_support_visual", resolution: { action: "figure", spec: { kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [{ tick: 0, text: "0" }, { tick: 4, text: "1" }] } } });
    expect(assistants.calls).toEqual([]);
  });

  it("3c · a description that contradicts the activity's answer: the figure follows the answer (figure and key say the same)", async () => {
    const plan = await resolve(sheet((a) => (a.visuals[0] = { ...a.visuals[0]!, description: "Barra dividida en 6 partes iguales con 2 partes coloreadas." })), deps(["vis_2"]));
    expect(outcome(plan, "vis_1").resolution).toMatchObject({ action: "figure", provenance: "generated", spec: { kind: "fraction_bar", parts: 8, shaded: [0, 1, 2] } });
  });

  it("4 · neither located nor rebuildable, the figure only carried a datum: rewritten (validated as equivalent), never a request to the teacher", async () => {
    const assistants = scripted({ rewrite: DATA_REWRITE });
    const plan = await resolve(sheet(dataSource), deps(["vis_1"], assistants));
    expect(outcome(plan, "vis_2")).toMatchObject({ category: "rewritable_without_visual", resolution: { action: "rewrite", activities: [{ activityId: "act_4" }] }, attempts: ["locate", "reconstruct", "generate", "rewrite"] });
  });

  it("5 · nothing in the material determines the bar: a NEW equivalent activity with its own bar (still reading a bar), not a text task", async () => {
    const assistants = scripted({ substitute: BAR_SUBSTITUTE });
    const plan = await resolve(sheet(undeterminedBar), deps(["vis_2"], assistants));
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "substituted_activity", resolution: { action: "substitute", spec: { kind: "fraction_bar", parts: 6, shaded: [0, 1] }, activities: [{ activityId: "act_1", lines: 1 }] }, attempts: ["locate", "reconstruct", "generate", "substitute"] });
    // A representation that must be read is never rewritten into words: the rewriter is not even asked.
    expect(assistants.calls).toEqual(["substitute"]);
  });

  it("5b · a substitute that turns reading a bar into a text task is rejected, asked once more, and then the only remaining stop", async () => {
    const assistants = scripted({ substitute: { ...BAR_SUBSTITUTE, prompt: "Escribe con números la fracción tres octavos.", figure: noFigure } });
    const plan = await resolve(sheet(undeterminedBar), deps(["vis_2"], assistants));
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "unresolved_visual", resolution: { action: "unresolved", reason: "no_equivalent_activity" } });
    expect(assistants.calls).toEqual(["substitute", "substitute"]);
  });

  it("5c · the model unavailable for a moment (timeout, overload, rate limit) is not a «no»: the stage is retried, never stopped", async () => {
    const transient = { ...scripted(), substitute: async () => ({ draft: null, run: { ...run, status: "error" as const, errorCode: "provider_unavailable" }, transient: true }) };
    await expect(resolve(sheet(undeterminedBar), deps(["vis_2"], transient))).rejects.toMatchObject({ code: "provider_transient", kind: "retryable" });
  });

  it("6 · no model available and nothing derivable: the stop says why (a technical limit, not a pedagogical request)", async () => {
    const plan = await resolve(sheet(undeterminedBar), deps(["vis_2"]));
    expect(outcome(plan, "vis_1")).toMatchObject({ category: "unresolved_visual", resolution: { action: "unresolved", reason: "no_model_available" } });
  });

  it("a located figure is never replaced by a rebuilt one (a person's or the locator's crop wins)", async () => {
    const plan = await resolve(sheet(), deps(["vis_1"], null, PIXELS));
    expect(outcome(plan, "vis_1").resolution).toEqual({ action: "located" });
    expect(outcome(plan, "vis_2").resolution.action).toBe("figure");
  });
});

describe("the model's drafts are hypotheses: validated before they reach a sheet", () => {
  it("a rewrite of a data-source figure that drops a datum, mentions an image, copies the task or gives the answer is refused", () => {
    const s = sheet(dataSource);
    const ctx = (signatures: string[] = []) => ({ analysis: s.analysis, activity: s.analysis.activities.find((a) => a.id === "act_4")!, visual: s.analysis.visuals[1], signatures, functionalNeeds: [] });
    const reasons = (prompt: string, signatures: string[] = []) => {
      const r = validateRewrite({ feasible: true, prompt, steps: null, lines: 2 }, ctx(signatures));
      return r.ok ? [] : r.violations;
    };
    expect(reasons("Calcula cuántos cuartos de litro le faltan a la botella para llegar al total.")).toContain("data_lost");
    expect(reasons("Observa la imagen: 3/4 de litro. Calcula cuántos cuartos de litro le faltan para llegar a 1 litro.")).toContain("mentions_image");
    expect(reasons(s.analysis.activities.find((a) => a.id === "act_4")!.instruction)).toContain("not_rewritten");
    expect(reasons("La botella tiene 3/4 de litro. Calcula cuántos cuartos de litro le faltan para llegar a 1 litro: 1/4 de litro.", ["1/4"])).toContain("answer_leaked");
    expect(validateRewrite(DATA_REWRITE, ctx())).toMatchObject({ ok: true, rewrite: { lines: 2 } });
  });

  it("a new support must be short, not a copy of the task and without its answer", () => {
    const task = "Ana bebe 3/4 de litro por la mañana y 1/4 por la tarde. ¿Cuántos litros bebe en total?";
    expect(validateSupport({ useful: true, kind: "steps", title: "Antes de sumar", steps: ["Mira si los denominadores son iguales.", "Suma solo los numeradores."], cards: null }, task, ["1 litro"])).toMatchObject({ kind: "steps" });
    expect(validateSupport({ useful: true, kind: "steps", title: null, steps: ["Suma: el total es 1 litro.", "Escríbelo."], cards: null }, task, ["1 litro"])).toBeNull();
    expect(validateSupport({ useful: false, kind: null, title: null, steps: null, cards: null }, task, [])).toBeNull();
    expect(validateSupport({ useful: true, kind: "cards", title: null, steps: null, cards: [{ term: "<b>x</b>", hint: "y" }, { term: "a", hint: "b" }] }, task, [])).toBeNull();
  });

  it("the analysis's description is only a claim: complete or nothing, and checked against the pixels and the activity", () => {
    expect(specFromAnalysis({ kind: "number_line", title: null, description: "Recta numérica de 0 a 1 con un punto marcado en 3/4.", text: null })).toBeNull();
    // Incomplete: how many parts are shaded is not said → no claim, nothing invented.
    expect(specFromAnalysis({ kind: "geometric_figure", title: null, description: "Rectángulo dividido en 4 partes iguales.", text: null })).toBeNull();
    expect(specFromAnalysis({ kind: "geometric_figure", title: null, description: "Barra con algunas partes coloreadas.", text: null })).toBeNull();
    expect(specFromAnalysis({ kind: "number_line", title: null, description: "Recta numérica dividida en partes.", text: null })).toBeNull();
    const bar = { kind: "geometric_figure" as const, title: null, description: "Barra dividida en 8 partes iguales con 3 partes coloreadas.", text: null };
    const claim = specFromAnalysis(bar)!;
    expect(sameStructure(claim, PIXELS.vis_1!)).toBe(true);
    // A crop whose pixels read another bar (6 parts, 2 shaded) is the wrong crop.
    expect(contradicts(bar, { spec_version: 1, kind: "fraction_bar", parts: 6, shaded: [0, 1] })).toBe(true);
    expect(contradicts(bar, PIXELS.vis_1!)).toBe(false);
    // A line in fifths cannot carry «Marca 3/4».
    const fifths: VisualSpec = { spec_version: 1, kind: "number_line", start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 5, labels: [] };
    expect(consistentWithActivities(fifths, ["Marca 3/4 en la recta numérica."])).toBe(false);
    expect(consistentWithActivities(PIXELS.vis_2!, ["Marca 3/4 en la recta numérica."])).toBe(true);
  });
});

describe("applied to the sheet: complete, with each figure in its activity, and a review that passes", () => {
  it("rebuilt figures take the image's place (same activity, same links); the deterministic review finds nothing to FAIL", async () => {
    const s = sheet();
    const plan = await resolve(s, deps([], null, PIXELS));
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
    const s = sheet(dataSource);
    const plan = await resolve(s, deps(["vis_1"], scripted({ rewrite: DATA_REWRITE })));
    const doc = applyVisualResolution(s.document, plan);
    expect(allBlocks(doc).some((b) => b.type === "image" && b.source.kind === "original" && b.source.visual_ref === "vis_2")).toBe(false);
    const act4 = allBlocks(doc).find((b) => b.type === "activity" && b.label === "4");
    expect(act4).toMatchObject({ prompt: expect.stringContaining("3/4 de litro"), response: { kind: "lines", lines: 2 }, trace: { origin: "adapted", source_refs: ["act_4", "vis_2"] } });
    expect(deterministicChecks({ analysis: s.analysis, plan: s.plan, context: s.context, document: doc } as never).filter((c) => c.status === "FAIL")).toEqual([]);
  });

  it("a substitute replaces the activity's task and its figure in place (label, links and trace kept); the review finds nothing to FAIL", async () => {
    const s = sheet(undeterminedBar);
    const plan = await resolve(s, deps(["vis_2"], scripted({ substitute: BAR_SUBSTITUTE })));
    const doc = applyVisualResolution(s.document, plan);
    const act1 = allBlocks(doc).find((b) => b.type === "activity" && b.label === "1");
    expect(act1).toMatchObject({ prompt: BAR_SUBSTITUTE.prompt, response: { kind: "lines", lines: 1 }, trace: { origin: "adapted", source_refs: expect.arrayContaining(["act_1", "vis_1"]) } });
    expect(allBlocks(doc).find((b) => b.type === "image" && b.source.kind === "figure" && b.source.visual_ref === "vis_1")).toMatchObject({ source: { provenance: "generated", spec: { kind: "fraction_bar", parts: 6 } } });
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

describe("a support for the whole sheet (no activity linked)", () => {
  it("is built from the sheet itself (title, objectives, instructions) instead of being skipped into a stop (regression)", async () => {
    const s = sheet();
    const doc = structuredClone(s.document) as MaterialDocument;
    doc.pages[0]!.blocks.unshift({ id: "blk_sheet1", type: "image", source: { kind: "requested", decision_id: "dec_9", purpose: "Secuencia para organizar la ficha", style: "diagram", essential: true }, alt_text: "Recurso visual de la ficha", trace: { origin: "adapted", source_refs: [], decision_ids: ["dec_9"] } });
    const prompts: string[] = [];
    const assistants: VisualAssistants = {
      support: async (input) => (prompts.push(input.activity), { draft: { useful: true, kind: "steps", title: "Cómo trabajar la ficha", steps: ["Lee cada actividad entera antes de empezar.", "Haz una actividad cada vez.", "Repasa al terminar."], cards: null }, run }),
      rewrite: async () => ({ draft: null, run }),
      substitute: async () => ({ draft: null, run }),
    };
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(["vis_1", "vis_2"]), assistants }, { analysis: s.analysis, document: doc, requiredVisuals: ["vis_1", "vis_2"], stage: "primaria" });
    expect(outcome(plan, "dec_9")).toMatchObject({ activityIds: [], category: "generatable_support_visual", resolution: { action: "figure", spec: { kind: "steps" } } });
    expect(prompts[0]).toContain("Fracciones en situaciones cotidianas");
    expect(prompts[0]).toContain("Marca 3/4 en la recta numérica.");
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
