import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisualSpecView } from "@/components/material/visual-spec";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { conflictViolated } from "@/lib/adaptation/conflicts";
import { resolveWithheldAutonomously } from "@/lib/adaptation/autonomous-resolution";
import { sequentialIds } from "@/lib/adaptation/document";
import { createMockGenerator, createMockReviewer } from "@/lib/adaptation/mock";
import { createMockPlannerV3 } from "@/lib/adaptation/mock-v3";
import { autoReview, reviewPlan } from "@/lib/adaptation/plan-review";
import { normalizePlanV3, type RulesUse } from "@/lib/adaptation/plan-v3";
import { runAdaptation } from "@/lib/adaptation/pipeline";
import { applyVisualResolution, visualStopCode, unresolvedEssential } from "@/lib/adaptation/visual-policy";
import { resolveMagicVisuals, type MagicVisualDeps } from "@/lib/materials/visuals/auto/policy";
import { justifyDecisions, rankByStrengths } from "@/lib/profiles/strength-leverage";
import type { ConflictResolution } from "@/lib/schemas/adaptation-context";
import type { Decision } from "@/lib/schemas/adaptation-plan";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import { allBlocks } from "@/lib/schemas/material-document";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { corroboratesFlow } from "@/lib/materials/visuals/auto/flow";
import type { PageModel, TextBox } from "@/lib/materials/visuals/auto/page-model";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { flowClaim, flowFigure } from "@/lib/visuals/from-analysis";
import { describeSpec, VisualSpecSchema } from "@/lib/visuals/spec";
import { argumentationAnalysis, fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { fractionsCaseDocument } from "../support/fractions-case";
import { V22_PROFILES } from "./fixtures/v22-profiles";

/**
 * «Hacer magia» as a Pedagogía Terapéutica specialist (rediseño autónomo): it decides, resolves, reviews and delivers; the teacher
 * chooses a material and a profile and presses the button. No model call, no network: scripted dependencies only.
 */

// ---------------------------------------------------------------------------------------------------------------------
// «Un estanque en equilibrio» (5.º de Primaria, Ciencias): the real failure, rebuilt from its own traces. The figure of activity 3a
// is a scheme of four boxes joined by arrows; locating it failed, illustrations were off, and no rung could draw it.
// ---------------------------------------------------------------------------------------------------------------------
const POND = {
  kind: "diagram" as const,
  title: "Relación alimentaria del estanque",
  description: "Esquema de cuatro recuadros unidos por flechas: Algas → Larvas de insectos → Ranas → Garzas.",
  text: "ALGAS → LARVAS DE INSECTOS → RANAS → GARZAS",
};

function pondSheet(visual: Partial<typeof POND> = {}) {
  const base = fractionsCaseDocument();
  base.analysis.visuals[1] = { ...base.analysis.visuals[1]!, ...POND, ...visual, role: "required" } as (typeof base.analysis.visuals)[number];
  Object.assign(base.analysis.activities.find((a) => a.id === "act_4")!, { type: "short_answer", instruction: "Explica qué indican las flechas del esquema.", response_format: "write_text", expected_answer: { basis: "not_inferable", value: null } });
  return base;
}
// Nothing could be located, nothing is corroborated from pixels, no model, and the workspace has no illustrations: the real conditions.
const noHelp = (over: Partial<MagicVisualDeps> = {}): MagicVisualDeps => ({ readyOriginals: async () => new Set<string>(), assistants: null, illustrationsWithheld: "disabled", ...over });
const resolve = (s: ReturnType<typeof pondSheet>, deps: MagicVisualDeps = noHelp()) => resolveMagicVisuals(deps, { analysis: s.analysis, document: s.document, requiredVisuals: ["vis_1", "vis_2"], stage: "primaria" });
const PRINTED = ["ALGAS", "LARVAS DE INSECTOS", "RANAS", "GARZAS"];

describe("Fase 4 · el estanque: la figura solo se redibuja con evidencia del ORIGINAL, y sin ella la parada sigue siendo segura", () => {
  it("el texto y la descripción del análisis NO bastan: son la misma lectura. Sin evidencia del original, parada segura (lo que pasó en producción)", async () => {
    const plan = await resolve(pondSheet());
    const need = plan.needs.find((n) => n.key === "vis_2")!;
    expect(need.resolution).toEqual({ action: "unresolved", reason: "illustration_unavailable" });
    expect(visualStopCode(unresolvedEssential(plan))).toBe("visual_unavailable");
    // And with a corroborator that finds nothing in the PDF the result is the same.
    const none = await resolve(pondSheet(), noHelp({ corroborateFlow: async () => null }));
    expect(none.needs.find((n) => n.key === "vis_2")!.resolution.action).toBe("unresolved");
  });

  it("con las etiquetas corroboradas por el original, el esquema se redibuja con ellas y su orden; contrato de reconstrucción", async () => {
    const s = pondSheet();
    const plan = await resolve(s, noHelp({ corroborateFlow: async () => PRINTED }));
    const need = plan.needs.find((n) => n.key === "vis_2")!;
    expect(need.category).toBe("reconstructable_structured_visual");
    expect(need.attempts).toEqual(["locate", "reconstruct", "reconstruct_flow"]);
    expect(need.contract).toMatchObject({ class: "structured_reconstructable", provenance: "pixel_reconstruction", validation: "pixels_verified" });
    expect(unresolvedEssential(plan)).toEqual([]);
    if (need.resolution.action !== "figure") throw new Error("not a figure");
    expect(need.resolution.spec).toMatchObject({ kind: "flow", items: ["Algas", "Larvas de insectos", "Ranas", "Garzas"] });
    // The description for assistive technology says what is drawn, never what an arrow MEANS (the activity asks that).
    expect(describeSpec(need.resolution.spec)).toBe("Relación alimentaria del estanque. Esquema de 4 recuadros unidos por flechas, en este orden: Algas → Larvas de insectos → Ranas → Garzas.");
    expect(describeSpec(need.resolution.spec)).not.toMatch(/come|alimenta a|energ/i);
    const applied = applyVisualResolution(s.document, plan);
    const image = allBlocks(applied).find((b) => b.type === "image" && b.source.kind === "figure" && b.source.visual_ref === "vis_2");
    expect(image).toBeDefined();
    const activity = allBlocks(applied).find((b) => b.type === "activity" && b.trace.source_refs.includes("act_4"));
    expect(activity?.type === "activity" && activity.resource_block_ids).toContain(image!.id);
    expect(activity?.type === "activity" && activity.trace.origin).not.toBe("adapted");
  });

  it("si el original corrobora OTRAS etiquetas u otro orden que el análisis, no se dibuja nada", async () => {
    for (const printed of [["ALGAS", "RANAS", "LARVAS DE INSECTOS", "GARZAS"], ["ALGAS", "LARVAS", "RANAS", "GARZAS"], ["ALGAS", "LARVAS DE INSECTOS", "RANAS"]]) {
      const plan = await resolve(pondSheet(), noHelp({ corroborateFlow: async () => printed }));
      expect(plan.needs.find((n) => n.key === "vis_2")!.resolution.action, printed.join(",")).toBe("unresolved");
    }
  });

  it("sin datos completos en el análisis ni siquiera se consulta al original: parada segura con su causa", async () => {
    for (const visual of [{ text: null as unknown as string }, { text: "ALGAS → RANAS" }, { description: "Un esquema del estanque." }, { text: "ALGAS → LARVAS DE INSECTOS / RANAS → GARZAS" }]) {
      const plan = await resolve(pondSheet(visual), noHelp({ corroborateFlow: async () => PRINTED }));
      const need = plan.needs.find((n) => n.key === "vis_2")!;
      expect(need.resolution.action, JSON.stringify(visual)).toBe("unresolved");
      expect(visualStopCode(unresolvedEssential(plan))).toBe("visual_unavailable");
    }
  });

  it("una imagen que SÍ se localiza en el original se conserva tal cual: no se redibuja", async () => {
    const plan = await resolve(pondSheet(), noHelp({ readyOriginals: async () => new Set(["vis_1", "vis_2"]), corroborateFlow: async () => PRINTED }));
    expect(plan.needs.find((n) => n.key === "vis_2")).toMatchObject({ category: "exact_original_visual", resolution: { action: "located" }, attempts: ["locate"] });
  });
});

// A one-page PDF of the pond scheme drawn the way the real sheet is: each box is a rectangle, its label a text item (the text layer),
// and the arrows are glyphs of the text layer between the boxes (here «->», which the standard fonts can print).
async function pondPdf(options: { arrow?: string | null; labels?: string[]; merged?: boolean; boxes?: boolean } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  const labels = options.labels ?? ["ALGAS", "LARVAS DE INSECTOS", "RANAS", "GARZAS"];
  if (options.merged) {
    page.drawText(labels.join("  ->  "), { x: 50, y: 600, size: 11, font });
  } else {
    const xs = [40, 150, 330, 440];
    const arrow = options.arrow === undefined ? "->" : options.arrow;
    labels.forEach((l, i) => {
      page.drawText(l, { x: xs[i]!, y: 600, size: 11, font });
      if (options.boxes !== false) page.drawRectangle({ x: xs[i]! - 8, y: 590, width: font.widthOfTextAtSize(l, 11) + 16, height: 26, borderWidth: 1, borderColor: rgb(0, 0, 0) });
      if (arrow && i < labels.length - 1) page.drawText(arrow, { x: xs[i]! + font.widthOfTextAtSize(l, 11) + 14, y: 600, size: 11, font });
    });
  }
  return pdf.save();
}

// The REAL sheet's page 2 (probed on the teacher's file, not stored here): the label «LARVAS DE INSECTOS» split over two lines of
// one box, the arrows «→» as glyphs of the text layer, and light-grey box borders. Rebuilt as a page model with those coordinates.
function realPondModel(over: { arrow?: string; order?: string[]; split?: boolean; boxes?: boolean; extra?: boolean } = {}): PageModel {
  const width = 827, height = 1169;
  const gray = new Uint8Array(width * height).fill(255);
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) gray[y * width + x] = 200;
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) gray[y * width + x] = 200;
  };
  const t = (text: string, x0: number, y0: number, x1: number, y1: number): TextBox => ({ text, x0, y0, x1, y1 });
  const names = over.order ?? ["ALGAS", "LARVAS DE INSECTOS", "RANAS", "GARZAS"];
  const frames = [[100, 190, 216, 254], [240, 190, 396, 254], [430, 190, 568, 254], [620, 190, 760, 254]] as const;
  const texts: TextBox[] = [t("3. Observa esta relación alimentaria del estanque.", 69, 159, 475, 176), t("a) Explica qué indican las flechas del esquema.", 69, 274, 383, 290)];
  const lines = (name: string, f: readonly [number, number, number, number]) => {
    const cx = (f[0] + f[2]) / 2;
    if (name === "LARVAS DE INSECTOS" && over.split !== false) return [t("LARVAS DE", cx - 41, 205, cx + 41, 221), t("INSECTOS", cx - 36, 224, cx + 36, 239)];
    return [t(name, cx - 24, 214, cx + 24, 230)];
  };
  names.forEach((n, i) => texts.push(...lines(n, frames[i]!)));
  for (const x of [225, 408, 591]) texts.push(t(over.arrow ?? "→", x, 214, x + 11, 230));
  if (over.extra) texts.push(t("ALGAS", 300, 244, 350, 252));
  if (over.boxes !== false) frames.forEach((f) => box(f[0], f[1], f[2], f[3]));
  return { width, height, gray, texts, mmPerPx: 0.254 };
}

describe("la evidencia del original: capa de texto del PDF (etiquetas, flechas con su sentido) y cajas dibujadas", () => {
  it("el PDF REAL del estanque (etiqueta partida en dos líneas, flechas «→» como caracteres) corrobora la cadena", () => {
    expect(corroboratesFlow(realPondModel(), PRINTED)).toBe(true);
    // The same sheet with the label on one line is also recognised.
    expect(corroboratesFlow(realPondModel({ split: false }), PRINTED)).toBe(true);
  });
  it("el SENTIDO de las flechas importa: flechas hacia la izquierda o dobles no corroboran un orden de izquierda a derecha", () => {
    expect(corroboratesFlow(realPondModel({ arrow: "←" }), PRINTED)).toBe(false);
    expect(corroboratesFlow(realPondModel({ arrow: "↔" }), PRINTED)).toBe(false);
    expect(corroboratesFlow(realPondModel({ arrow: "<-" }), PRINTED)).toBe(false);
    // A sheet whose boxes read in another order is not the claimed chain, even with right-pointing arrows.
    expect(corroboratesFlow(realPondModel({ order: ["GARZAS", "RANAS", "LARVAS DE INSECTOS", "ALGAS"] }), PRINTED)).toBe(false);
    expect(corroboratesFlow(realPondModel({ order: ["ALGAS", "RANAS", "LARVAS DE INSECTOS", "GARZAS"] }), PRINTED)).toBe(false);
  });
  it("no se inventa: sin cajas dibujadas, con un texto extra en el esquema, con otras etiquetas o con una repetida, nada", () => {
    expect(corroboratesFlow(realPondModel({ boxes: false }), PRINTED)).toBe(false);
    expect(corroboratesFlow(realPondModel({ extra: true }), PRINTED)).toBe(false);
    expect(corroboratesFlow(realPondModel(), ["ALGAS", "LARVAS", "RANAS", "GARZAS"])).toBe(false);
    expect(corroboratesFlow(realPondModel(), [...PRINTED, "PECES"])).toBe(false);
    expect(corroboratesFlow(realPondModel(), ["ALGAS", "ALGAS"])).toBe(false);
  });
  it("con un PDF generado (raster real): flechas «->», cajas y etiquetas corroboran; sin flechas, sin cajas, con flecha invertida o fundido en una línea, no", async () => {
    const read = async (o: Parameters<typeof pondPdf>[0] = {}) => (await readPage(await pondPdf(o), "application/pdf", 1, 100)).model;
    expect(corroboratesFlow(await read(), PRINTED)).toBe(true);
    expect(corroboratesFlow(await read({ arrow: null }), PRINTED)).toBe(false);
    expect(corroboratesFlow(await read({ boxes: false }), PRINTED)).toBe(false);
    expect(corroboratesFlow(await read({ arrow: "<-" }), PRINTED)).toBe(false);
    expect(corroboratesFlow(await read({ merged: true }), PRINTED)).toBe(false);
  });
});

describe("flowClaim: una afirmación del análisis, nunca una figura por sí sola", () => {
  const ok = { ...POND };
  it("extrae la cadena completa y coherente de 2 a 6 recuadros", () => {
    expect(flowClaim(ok)).toEqual(["ALGAS", "LARVAS DE INSECTOS", "RANAS", "GARZAS"]);
    expect(flowFigure(flowClaim(ok)!, ok.title)).toMatchObject({ kind: "flow", items: ["Algas", "Larvas de insectos", "Ranas", "Garzas"] });
    expect(VisualSpecSchema.safeParse(flowFigure(flowClaim(ok)!)).success).toBe(true);
  });
  it("rechaza lo que no sería el esquema del original", () => {
    expect(flowClaim({ ...ok, kind: "image" })).toBeNull();
    expect(flowClaim({ ...ok, text: "ALGAS" })).toBeNull();
    expect(flowClaim({ ...ok, text: "A → B → C → D → E → F → G" })).toBeNull();
    expect(flowClaim({ ...ok, text: "ALGAS → ALGAS → RANAS" })).toBeNull();
    expect(flowClaim({ ...ok, text: "ALGAS → RANAS Y GARZAS" })).toBeNull();
    expect(flowClaim({ ...ok, text: "ALGAS → RANAS" })).toBeNull();
    expect(flowClaim({ ...ok, description: "Esquema con flechas: Algas, Larvas de insectos y Ranas." })).toBeNull();
    expect(flowClaim({ ...ok, description: "Esquema: Garzas, Ranas, Larvas de insectos y Algas." })).toBeNull();
  });
});

describe("el esquema se dibuja igual en pantalla y en el PDF", () => {
  it("recuadros y flechas, con su etiqueta accesible; las flechas son decorativas para el lector de pantalla", () => {
    const html = renderToStaticMarkup(createElement(VisualSpecView, { spec: flowFigure(flowClaim(POND)!)!, label: "Relación alimentaria del estanque" }));
    expect(html).toContain('data-spec="flow"');
    expect(html).toContain('aria-label="Relación alimentaria del estanque"');
    expect([...html.matchAll(/ms-vflow-box/g)]).toHaveLength(4);
    expect([...html.matchAll(/ms-vflow-arrow/g)]).toHaveLength(3);
    expect(html).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fase 3 · conflictos: «dos ayudas podrían contradecirse» solo si de verdad lo hacen
// ---------------------------------------------------------------------------------------------------------------------
const decision = (over: Partial<Decision> = {}): Decision => ({ id: "dec_1", target: "act_1", action: "add_support", strategies: ["comprehension_support"], dimensions: ["worked_examples"], intensity: "light", preserves: [], supports: [], flags: [], ...over }) as Decision;
const conflict = (key: string): ConflictResolution => ({ key, dimensions: ["worked_examples"], targets: ["act_1"], rule: "pedagogical_integrity", guidance: "x" }) as ConflictResolution;

describe("Fase 3 · un conflicto ya resuelto por su guía no se muestra como contradicción", () => {
  it("dos ayudas incompatibles sí se detectan: dos apoyos visuales en la misma actividad con carga visual", () => {
    const a = decision({ id: "dec_1", supports: [{ kind: "visual_cue", uses_task_data: false }] });
    const b = decision({ id: "dec_2", strategies: ["visual_support"], supports: [{ kind: "visual_cue", uses_task_data: false }] });
    expect(conflictViolated(conflict("added_visuals_vs_visual_load"), a, { decisions: [a, b] })).toBe(true);
    // One visual aid per activity is exactly what the guidance asks for.
    expect(conflictViolated(conflict("added_visuals_vs_visual_load"), a, { decisions: [a] })).toBe(false);
  });
  it("un ejemplo con los datos de la tarea contradice «los ejemplos nunca resuelven la tarea»; uno análogo no", () => {
    const own = decision({ supports: [{ kind: "worked_example", uses_task_data: true }] });
    const analogous = decision({ supports: [{ kind: "worked_example", uses_task_data: false }] });
    expect(conflictViolated(conflict("examples_vs_answer"), own, { decisions: [own] })).toBe(true);
    expect(conflictViolated(conflict("examples_vs_answer"), analogous, { decisions: [analogous] })).toBe(false);
  });
  it("reescribir un texto fuente literal contradice su guía; dividirlo no", () => {
    expect(conflictViolated(conflict("reading_load_vs_literal_text"), decision({ action: "rephrase", strategies: ["language_simplification"] }), { decisions: [] })).toBe(true);
    expect(conflictViolated(conflict("reading_load_vs_literal_text"), decision({ action: "segment", strategies: ["text_segmentation"] }), { decisions: [] })).toBe(false);
  });
  it("respuesta cerrada donde se evalúa razonamiento abierto o escritura contradice la guía; un esquema o un plan no", () => {
    const closed = decision({ action: "change_response_format", response_target: "select_option" });
    expect(conflictViolated(conflict("selection_vs_open_reasoning"), closed, { decisions: [closed] })).toBe(true);
    expect(conflictViolated(conflict("writing_reduction_vs_evaluated_writing"), closed, { decisions: [closed] })).toBe(true);
    const planner = decision({ supports: [{ kind: "planner", uses_task_data: false }] });
    expect(conflictViolated(conflict("writing_reduction_vs_evaluated_writing"), planner, { decisions: [planner] })).toBe(false);
  });
  it("un conflicto desconocido conserva la lectura prudente", () => {
    expect(conflictViolated(conflict("regla_nueva"), decision(), { decisions: [] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fase 3 · decisiones retenidas por el método V2.2: alternativas seguras, nunca una pregunta al docente
// ---------------------------------------------------------------------------------------------------------------------
const RULES: RulesUse = { version: "v9.9", package_sha256: "a".repeat(64), block_sha256: "b".repeat(64), included: ["D900-E01"] };
const analysis = fractionsAnalysis();
const contextB = buildAdaptationContext({ profile: V22_PROFILES.B, education: { stage: "primaria", grade: null, subject: null }, analysis, adaptationType: "accessibility" }).context;
// need_1 of profile B is fine_motor_demand, served by «response_format».
const draft = (over: Record<string, unknown>) => ({ target: "act_2", action: "add_support", strategies: ["response_format"], need_refs: ["need_1"], intensity: "light", supports: [{ kind: "checklist", uses_task_data: false }], status: "active", hint_yes: [], ...over });

function resolveDraft(decisions: unknown[], questions: unknown[] = []) {
  const { plan, declarations } = normalizePlanV3({ decisions, summary: [], teacher_questions: questions }, analysis, contextB, RULES);
  const base = autoReview(plan, analysis, contextB);
  const { review, resolutions } = resolveWithheldAutonomously(base, plan, declarations, analysis, contextB);
  return { plan, review, resolutions, reviewed: reviewPlan(plan, review, analysis, contextB) };
}

describe("Fase 3 · lo retenido se resuelve internamente", () => {
  it("una decisión condicionada se resuelve con una alternativa segura o conservando el original, con su causa; nadie contesta", () => {
    const { resolutions, review, reviewed } = resolveDraft([draft({ status: "conditional", question: "q_1" })], [{ id: "q_1", text: "¿Puede usar teclado?" }]);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ decision_id: "dec_1", cause: "conditional" });
    expect(["safe_variant", "alternative", "kept_original"]).toContain(resolutions[0]!.kind);
    // Never left for a teacher: no entry is pending and no confirmation is required.
    expect(review.entries.every((e) => e.action !== "approved" || resolutions.every((r) => r.decision_id !== e.decision_id))).toBe(true);
    expect(review.confirmations ?? []).toEqual([]);
    expect(reviewed.decisions.every((d) => d.outcome === "applied" || d.outcome === "rejected")).toBe(true);
  });

  it("un apoyo que da una pista de la solución se aplica sin esa pista (variante segura) y el resto de la decisión no cambia", () => {
    const { resolutions, reviewed } = resolveDraft([draft({ target: "act_3", hint_yes: ["P8"], supports: [{ kind: "checklist", uses_task_data: false }, { kind: "key_idea", uses_task_data: true }] })]);
    expect(resolutions[0]).toMatchObject({ cause: "answer_hint", kind: "safe_variant" });
    const effective = reviewed.decisions.find((d) => d.id === "dec_1")!.effective!;
    expect(effective.supports).toEqual([{ kind: "checklist", uses_task_data: false }]);
    expect(effective.target).toBe("act_3");
    expect(effective.supports.some((s) => s.uses_task_data)).toBe(false);
    expect(reviewed.effectiveValidation.valid).toBe(true);
  });

  it("si nada seguro es ejecutable se conserva el original (decisión conservadora), nunca una adaptación inventada", () => {
    const { resolutions, reviewed } = resolveDraft([draft({ target: "act_3", hint_yes: ["P8"], supports: [{ kind: "key_idea", uses_task_data: true }] })]);
    expect(resolutions[0]).toMatchObject({ cause: "answer_hint", kind: "kept_original" });
    expect(reviewed.decisions[0]!.outcome).toBe("rejected");
    expect(reviewed.effective.decisions).toEqual([]);
  });

  it("conservar el original NO resuelve una barrera: una necesidad esencial que ninguna decisión alcanza para ESA actividad queda señalada (parada, no ficha válida)", () => {
    const high = { ...contextB, needs: contextB.needs.map((n) => ({ ...n, level: "high" as const })) };
    const dimension = high.needs[0]!.dimension;
    const go = (decisions: unknown[]) => {
      const { plan, declarations } = normalizePlanV3({ decisions, summary: [], teacher_questions: [{ id: "q_1", text: "¿Puede usar teclado?" }] }, analysis, high, RULES);
      return resolveWithheldAutonomously(autoReview(plan, analysis, high), plan, declarations, analysis, high);
    };
    // The only decision for that need is withheld and nothing safe is executable: the original stays, the need is NOT attended.
    const alone = go([draft({ status: "conditional", question: "q_1" })]);
    expect(alone.resolutions[0]!.kind).toBe("kept_original");
    expect(alone.uncovered).toEqual([{ decision_id: "dec_1", dimensions: [dimension] }]);
    // The same dimension used on ANOTHER activity does not cover it: the barrier remains where it was left out.
    const elsewhere = go([draft({ status: "conditional", question: "q_1" }), draft({ target: "act_3" })]);
    expect(elsewhere.uncovered).toEqual([{ decision_id: "dec_1", dimensions: [dimension] }]);
    // The same activity, or a support for the whole document, does reach it.
    expect(go([draft({ status: "conditional", question: "q_1" }), draft({ target: "act_2" })]).uncovered).toEqual([]);
    expect(go([draft({ status: "conditional", question: "q_1" }), draft({ target: "document" })]).uncovered).toEqual([]);
    // A need that is not essential (low or medium) does not stop the sheet by itself.
    const low = { ...contextB, needs: contextB.needs.map((n) => ({ ...n, level: "low" as const })) };
    const { plan, declarations } = normalizePlanV3({ decisions: [draft({ status: "conditional", question: "q_1" })], summary: [], teacher_questions: [{ id: "q_1", text: "¿Puede usar teclado?" }] }, analysis, low, RULES);
    expect(resolveWithheldAutonomously(autoReview(plan, analysis, low), plan, declarations, analysis, low).uncovered).toEqual([]);
  });

  it("la revisión del docente no se toca", () => {
    const { plan, declarations } = normalizePlanV3({ decisions: [draft({ status: "conditional", question: "q_1" })], summary: [], teacher_questions: [{ id: "q_1", text: "¿Puede usar teclado?" }] }, analysis, contextB, RULES);
    const teacher = { ...autoReview(plan, analysis, contextB), reviewer: { kind: "teacher" as const } };
    expect(resolveWithheldAutonomously(teacher, plan, declarations, analysis, contextB)).toEqual({ review: teacher, resolutions: [], uncovered: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Principio: el perfil funcional es el centro de todas las decisiones
// ---------------------------------------------------------------------------------------------------------------------
const run = (profile: FunctionalProfile, material = analysis) =>
  runAdaptation({ profile, education: { stage: "primaria", grade: null, subject: null }, analysis: material, adaptationType: "accessibility" }, { planner: createMockPlannerV3(material, RULES), generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds(), plannerVersion: 3 });

describe("el perfil funcional decide: el mismo material, decisiones distintas y justificadas, con los mismos objetivos", () => {
  it("perfiles A, B y C producen decisiones diferentes sobre la misma ficha, y la ficha conserva todas sus actividades", async () => {
    const material = argumentationAnalysis();
    const results = await Promise.all([run(V22_PROFILES.A, material), run(V22_PROFILES.B, material), run(V22_PROFILES.C, material)]);
    // What each profile asks the planner to do (before any review) differs: A planning supports, B the response route, C nothing.
    const asked = (r: (typeof results)[number]) => JSON.stringify(r.reviewed.raw.decisions.map((d) => [d.target, d.action, d.strategies, d.dimensions, d.response_target ?? null]));
    const [a, b, c] = results.map(asked) as [string, string, string];
    expect(new Set([a, b, c]).size).toBe(3);
    expect(results[2]!.reviewed.raw.decisions).toEqual([]);
    // A changes the sheet; C leaves it as it is: no decision is applied for a category or by default.
    expect(results[0]!.plan.decisions.length).toBeGreaterThan(0);
    expect(results[2]!.plan.decisions).toEqual([]);
    for (const r of results) {
      expect(allBlocks(r.document).filter((x) => x.type === "activity").length).toBeGreaterThanOrEqual(material.activities.length);
      // Every decision answers a need of THIS profile (never a category).
      expect(r.reviewed.raw.decisions.every((d) => d.dimensions.length > 0)).toBe(true);
    }
  });

  it("cada cambio tiene su justificación: la necesidad, la barrera que reduce, la fortaleza que aprovecha y lo que conserva", () => {
    const observations = { strengths: ["visual_information", "step_lists"] as const, barriers: ["planning", "long_instructions"] as const };
    const [seq, vis] = justifyDecisions(
      [
        { id: "dec_1", dimensions: ["planning_support"], strategies: ["task_sequencing"], preserves: ["prt_1"] },
        { id: "dec_2", dimensions: ["visual_distraction_reduction"], strategies: ["spatial_organization"], preserves: [] },
      ],
      { strengths: [...observations.strengths], barriers: [...observations.barriers] },
    );
    expect(seq).toEqual({ decision_id: "dec_1", needs: ["planning_support"], barriers: ["planning"], strengths: ["step_lists"], preserves: ["prt_1"] });
    expect(vis).toMatchObject({ barriers: [], strengths: ["visual_information"] });
  });

  it("la fortaleza decide QUÉ estrategia entre las que sirven a la necesidad (política 3); sin fortalezas o en la política 2 no cambia nada", () => {
    const profile = (strengths: string[]): FunctionalProfile => ({ ...emptyFunctionalProfile(), supports: { comprehension_support: undefined, visual_math_support: "high", working_memory_support: "medium" } as FunctionalProfile["supports"], observations: { strengths: strengths as never, barriers: [] } });
    const ctx = (p: FunctionalProfile, policy: 2 | 3) => buildAdaptationContext({ profile: p, education: { stage: "primaria", grade: null, subject: null }, analysis, adaptationType: "accessibility", policy }).context.needs.map((n) => [n.dimension, n.strategies]);
    // Policy 2 is byte for byte what it was: strengths never reorder it.
    expect(ctx(profile(["visual_information"]), 2)).toEqual(ctx(profile([]), 2));
    expect(ctx(profile([]), 3)).toEqual(ctx(profile([]), 2));
    // Policy 3: the strengths reorder the SAME candidate strategies, never add one.
    const withStrength = ctx(profile(["visual_information"]), 3);
    expect(withStrength.map(([, s]) => [...(s as string[])].sort())).toEqual(ctx(profile([]), 2).map(([, s]) => [...(s as string[])].sort()));
    expect(rankByStrengths(["worked_example", "visual_support", "task_sequencing"], { strengths: ["visual_information"], barriers: [] })[0]).toBe("visual_support");
    expect(rankByStrengths(["worked_example", "visual_support"], undefined)).toEqual(["worked_example", "visual_support"]);
  });

  it("Hacer magia sin intervención del docente: el pipeline genera, revisa y entrega sin ninguna decisión pendiente", async () => {
    const result = await run(V22_PROFILES.B, argumentationAnalysis());
    expect(result.reviewed.decisions.every((d) => d.outcome === "applied" || d.outcome === "rejected")).toBe(true);
    expect(result.reviewed.review.reviewer.kind).toBe("auto");
    expect(result.reviewed.review.confirmations ?? []).toEqual([]);
    expect(result.validation.valid).toBe(true);
  });
});
