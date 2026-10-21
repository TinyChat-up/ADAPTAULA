import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MaterialSheet } from "@/components/material/sheet";
import { supportsDefiningEvaluatedConcepts } from "@/lib/adaptation/assessment-safety";
import { responseFor } from "@/lib/adaptation/document";
import { protectedFor } from "@/lib/adaptation/facts";
import type { NormalizedGeneration } from "@/lib/adaptation/generated";
import { CONCEPT_LEAK_CHECK, RESPONSE_AREA_CHECK } from "@/lib/adaptation/generation-checks";
import { diagnoseGeneration, failureSignature, repairLocally, screenGeneration } from "@/lib/adaptation/generation-recovery";
import { normalizePlan } from "@/lib/adaptation/plan";
import { AUTOMATIC_STOP_COPY } from "@/lib/adaptation/presentation/copy";
import { visualStopCode, type VisualNeedOutcome } from "@/lib/adaptation/visual-policy";
import { buildRenderModel } from "@/lib/render/model";
import type { AdaptationPlan, DraftDecision } from "@/lib/schemas/adaptation-plan";
import type { GeneratedSegments } from "@/lib/schemas/ai-contracts";
import { allBlocks, type Block, type DraftBlock, type MaterialDocument } from "@/lib/schemas/material-document";
import { contextOf, documentOf, sheet, type SyntheticSheet } from "../support/real-run-v3-synthetic";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/**
 * The eight sheets of the real run v3 as a regression matrix («Hacer magia» 2.0). SYNTHETIC equivalents (tests/support), one
 * assertion per defect seen there: never «the PDF is valid». No model is called; the generations are scripted.
 */

const html = (doc: MaterialDocument) => renderToStaticMarkup(createElement(MaterialSheet, { model: buildRenderModel(doc, { mode: "student", design: "claro", requiredVisuals: [], deferred: [] }).model }));
const activities = (doc: MaterialDocument) => allBlocks(doc).filter((b): b is Extract<Block, { type: "activity" }> => b.type === "activity");

function planWith(s: SyntheticSheet, decisions: Array<Partial<DraftDecision> & Pick<DraftDecision, "target" | "action">>): AdaptationPlan {
  const context = contextOf(s.analysis);
  const dims = context.needs.map((n) => n.dimension).slice(0, 1) as DraftDecision["dimensions"];
  return normalizePlan({ decisions: decisions.map((d) => ({ strategies: ["planning_support"], dimensions: dims, intensity: "light", preserves: protectedFor(s.analysis, d.target).map((p) => p.id), supports: [{ kind: "checklist", uses_task_data: false }], flags: [], ...d })), summary: [] }, s.analysis, context);
}

const support = (block: Partial<DraftBlock> & Pick<DraftBlock, "type">, target: string, decision: string): DraftBlock =>
  ({ id: `s_${Math.random().toString(36).slice(2, 8)}`, trace: { origin: "support", source_refs: target === "document" ? [] : [target], decision_ids: [decision] }, ...block }) as DraftBlock;

const normalized = (segments: GeneratedSegments, ids: string[]): NormalizedGeneration => ({ version: 2, segments, issues: [], requested: ids, generated: ids, ignored: [], declined: [], preserved: [] });

const unresolved = (reason: string): VisualNeedOutcome => ({ key: "vis_1", origin: "original", essential: true, activityIds: ["act_1"], category: "unresolved_visual", resolution: { action: "unresolved", reason }, attempts: [] });

describe("matriz de las 8 fichas de la prueba real v3 (equivalentes sintéticos)", () => {
  it("01 · un bloque inválido ya no hace inconstruible la ficha: se criba, se atribuye a su decisión y lo válido se conserva", () => {
    const s = sheet("01-fracciones");
    const plan = planWith(s, [{ target: "act_1", action: "add_support" }, { target: "act_2", action: "add_support" }]);
    const [d1, d2] = plan.decisions.map((d) => d.id);
    const tooLong = support({ type: "checklist", items: Array.from({ length: 13 }, (_, i) => `Paso número ${i + 1} de la comprobación.`) }, "act_2", d2!);
    const ok = support({ type: "checklist", items: ["Mira si los denominadores son iguales.", "Suma solo los numeradores."] }, "act_1", d1!);
    const raw = normalized({ segments: [{ target: "act_1", decision_ids: [d1!], new_item_answers: [], blocks: [ok] }, { target: "act_2", decision_ids: [d2!], new_item_answers: [], blocks: [tooLong] }], change_summary: [] }, [d1!, d2!]);
    const screened = screenGeneration(raw);
    expect(screened.issues).toEqual([expect.objectContaining({ code: "invalid_block_dropped", decision_id: d2 })]);
    expect(screened.generated).toEqual([d1]);
    expect(screened.ignored).toContain(d2);
    const doc = documentOf(s, plan, screened.segments);
    expect(allBlocks(doc).some((b) => b.type === "checklist" && b.trace.decision_ids.includes(d1!))).toBe(true);
    // The inferred answer never reaches the student's sheet.
    expect(html(doc)).not.toContain("5/7");
  });

  it("01 · el área de respuesta cambiada sin decisión se repara sin modelo (la del original) y el diagnóstico la nombra", () => {
    const s = sheet("01-fracciones");
    const plan = planWith(s, [{ target: "act_1", action: "rephrase" }]);
    const d1 = plan.decisions[0]!.id;
    const rewritten = support({ type: "activity", prompt: "Suma 3/7 y 2/7. Después simplifica.", response: { kind: "choice", options: [{ id: "o1", text: "5/7" }, { id: "o2", text: "5/14" }], multiple: false } } as Partial<DraftBlock> & Pick<DraftBlock, "type">, "act_1", d1);
    const generation = normalized({ segments: [{ target: "act_1", decision_ids: [d1], new_item_answers: [], blocks: [rewritten] }], change_summary: [] }, [d1]);
    const audit = { checks: [{ name: RESPONSE_AREA_CHECK, ok: false, detail: "act_1", decisions: [d1], refs: ["act_1"] }] };
    const repaired = repairLocally(generation, audit, s.analysis, new Set([d1]));
    expect(repaired?.fixes).toEqual([`${RESPONSE_AREA_CHECK}: act_1`]);
    const block = repaired!.generation.segments.segments[0]!.blocks[0] as Extract<DraftBlock, { type: "activity" }>;
    expect(block.response).toEqual(responseFor(s.analysis.activities[0]!));
    expect(diagnoseGeneration({ audit })).toEqual([{ category: "structure_loss", rule: RESPONSE_AREA_CHECK, decisions: [d1], refs: ["act_1"], repair: "deterministic" }]);
  });

  it("02 · «Operaciones y unidades» (caja para calcular) y «Respuesta» se conservan por actividad", () => {
    const doc = documentOf(sheet("02-problemas"));
    for (const a of activities(doc)) expect(a.response).toEqual({ kind: "fields", fields: [{ label: "Operaciones y unidades", space: "box", lines: 5 }, { label: "Respuesta", space: "lines", lines: 2 }] });
    const out = html(doc);
    expect(out.match(/Operaciones y unidades/g)).toHaveLength(2);
    expect(out.match(/ms-field-box/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("02 · un apoyo repetido (hoja + cada actividad) se imprime una vez y conserva la trazabilidad de todas sus decisiones", () => {
    const s = sheet("02-problemas");
    const plan = planWith(s, [{ target: "document", action: "add_support" }, { target: "act_1", action: "add_support" }, { target: "act_2", action: "add_support" }]);
    const [dd, d1, d2] = plan.decisions.map((d) => d.id) as [string, string, string];
    const items = ["Lee el problema dos veces antes de empezar.", "Subraya los datos con sus unidades."];
    const generated: GeneratedSegments = {
      segments: [
        { target: "document", decision_ids: [dd], new_item_answers: [], blocks: [support({ type: "checklist", items }, "document", dd)] },
        { target: "act_1", decision_ids: [d1], new_item_answers: [], blocks: [support({ type: "checklist", items }, "act_1", d1)] },
        { target: "act_2", decision_ids: [d2], new_item_answers: [], blocks: [support({ type: "checklist", items: ["Subraya los datos con sus unidades."] }, "act_2", d2)] },
      ],
      change_summary: [],
    };
    const lists = allBlocks(documentOf(s, plan, generated)).filter((b) => b.type === "checklist");
    expect(lists).toHaveLength(1);
    expect(new Set(lists[0]!.trace.decision_ids)).toEqual(new Set([dd, d1, d2]));
  });

  it("03 · la figura geométrica sin reconstrucción verificable sigue parando, con causa honesta (no el plan si no hay ilustraciones)", () => {
    const doc = documentOf(sheet("03-geometria"));
    expect(allBlocks(doc).find((b) => b.type === "image")).toMatchObject({ source: { kind: "original" } });
    expect(visualStopCode([unresolved("representation_not_buildable")])).toBe("visual");
    expect(visualStopCode([unresolved("illustration_unavailable")])).toBe("visual_unavailable");
  });

  it("04 · párrafos y diálogo separados, una casilla por elemento de ordenación en su orden impreso, número que no se parte", () => {
    const doc = documentOf(sheet("04-lectura"));
    const reading = allBlocks(doc).find((b) => b.type === "reading_text");
    expect(reading && reading.type === "reading_text" ? reading.paragraphs.filter((p) => p.startsWith("—")) : []).toHaveLength(2);
    const ordering = activities(doc)[0]!;
    expect(ordering.response).toEqual({ kind: "sequence", items: ["Comieron junto al puente.", "Subieron al autobús.", "Vieron una garza en la orilla.", "Volvieron cantando al colegio."] });
    // The items are drawn once, in the answer area (never also run together in the prompt).
    expect(ordering.prompt).toBe("Ordena del 1 al 4 lo que pasó en la excursión.");
    const out = html(doc);
    expect(out.match(/<li[^>]*>/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(out).toContain("ms-sequence");
    expect(readFileSync("src/components/material/material.css", "utf8")).toMatch(/\[data-design="claro"\] \.ms-num\[data-numeric\] \{ white-space: nowrap; \}/);
  });

  it("05 · las tres oraciones siguen separadas, con campos Sujeto/Predicado, y un glosario que define lo evaluado se detecta", () => {
    const s = sheet("05-oraciones");
    const doc = documentOf(s);
    const first = activities(doc)[0]!;
    expect(first.response).toMatchObject({ kind: "fields", fields: [{ label: "Sujeto" }, { label: "Predicado" }] });
    const out = html(doc);
    expect(out).toMatch(/parque\.<\/span><br\/>/);
    expect(out).toMatch(/sopa\.<\/span><br\/>/);
    const leak: MaterialDocument = {
      ...doc,
      pages: [{ blocks: [...doc.pages[0]!.blocks, { id: "blk_leak", type: "vocabulary", items: [{ term: "Sustantivo", definition: "Palabra que nombra personas, animales o cosas." }, { term: "Verbo", definition: "Palabra que expresa una acción." }], trace: { origin: "support", source_refs: ["act_2"], decision_ids: ["dec_9"] } }] }, ...doc.pages.slice(1)],
    };
    expect(supportsDefiningEvaluatedConcepts(leak, s.analysis.activities)).toEqual([expect.objectContaining({ blockId: "blk_leak", activityId: "act_2", decisionIds: ["dec_9"] })]);
    expect(diagnoseGeneration({ audit: { checks: [{ name: CONCEPT_LEAK_CHECK, ok: false, detail: "", decisions: ["dec_9"], refs: ["blk_leak"] }] } })[0]).toMatchObject({ category: "answer_leak", repair: "ai_fragment" });
  });

  it("06 y 07 · ilustraciones desactivadas para todos: la parada no culpa al plan ni propone cambiarlo", () => {
    for (const id of ["06-cuadricula", "07-flechas"]) expect(allBlocks(documentOf(sheet(id))).some((b) => b.type === "image")).toBe(true);
    expect(visualStopCode([unresolved("illustration_unavailable")])).toBe("visual_unavailable");
    expect(`${AUTOMATIC_STOP_COPY.visual_unavailable.body} ${AUTOMATIC_STOP_COPY.visual_unavailable.hint}`).not.toMatch(/tu plan (no )?incluy|cuando tu plan/);
    expect(visualStopCode([unresolved("illustration_not_in_plan")])).toBe("visual_plan");
    expect(visualStopCode([unresolved("illustration_quota_exhausted")])).toBe("visual_quota");
    expect(AUTOMATIC_STOP_COPY.visual_quota.body).toMatch(/este mes/);
  });

  it("08 · los mismos fallos en las mismas decisiones tienen la misma firma (la guarda sin progreso detiene la tercera generación)", () => {
    const audit = (decisions: string[]) => ({ checks: [{ name: "el generador no propuso nada fuera de lo autorizado", ok: false, detail: "", decisions, refs: [] }] });
    expect(failureSignature(diagnoseGeneration({ audit: audit(["dec_2", "dec_1"]) }))).toBe(failureSignature(diagnoseGeneration({ audit: audit(["dec_1", "dec_2"]) })));
    expect(failureSignature(diagnoseGeneration({ audit: audit(["dec_1"]) }))).not.toBe(failureSignature(diagnoseGeneration({ audit: audit(["dec_2"]) })));
    const doc = documentOf(sheet("08-partes"));
    expect(activities(doc)[0]!.response).toMatchObject({ kind: "fields", fields: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }] });
    expect(activities(doc)[0]!.prompt).toBe("Escribe qué parte de la planta indica cada letra.");
  });
});
