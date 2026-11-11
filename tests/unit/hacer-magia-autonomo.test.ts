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

// A one-page PDF of the pond scheme: each label is its own text item (the text layer) and arrows are drawn between the boxes.
async function pondPdf(options: { arrows?: boolean; labels?: string[]; merged?: boolean } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  const labels = options.labels ?? ["ALGAS", "LARVAS DE INSECTOS", "RANAS", "GARZAS"];
  if (options.merged) {
    page.drawText(labels.join("  ->  "), { x: 50, y: 600, size: 11, font });
  } else {
    const xs = [50, 150, 330, 430];
    labels.forEach((l, i) => {
      page.drawText(l, { x: xs[i]!, y: 600, size: 11, font });
      page.drawRectangle({ x: xs[i]! - 6, y: 592, width: font.widthOfTextAtSize(l, 11) + 12, height: 22, borderWidth: 1, borderColor: rgb(0, 0, 0) });
      if (options.arrows !== false && i < labels.length - 1) page.drawLine({ start: { x: xs[i]! + font.widthOfTextAtSize(l, 11) + 8, y: 603 }, end: { x: xs[i + 1]! - 8, y: 603 }, thickness: 2, color: rgb(0, 0, 0) });
    });
  }
  return pdf.save();
}

describe("la evidencia del original: texto del PDF y tinta entre los recuadros", () => {
  it("un esquema impreso como el del estanque corrobora sus etiquetas", async () => {
    const { model } = await readPage(await pondPdf(), "application/pdf", 1, 100);
    expect(corroboratesFlow(model, PRINTED)).toBe(true);
  });
  it("no corrobora si falta una flecha, si las etiquetas van en otro orden, si falta una o si el texto del PDF está fundido en una sola línea", async () => {
    const noArrows = (await readPage(await pondPdf({ arrows: false }), "application/pdf", 1, 100)).model;
    // The boxes' own borders are not connectors: without a line across the gap the chain is not corroborated.
    expect(corroboratesFlow(noArrows, PRINTED)).toBe(false);
    const { model } = await readPage(await pondPdf(), "application/pdf", 1, 100);
    expect(corroboratesFlow(model, ["ALGAS", "RANAS", "LARVAS DE INSECTOS", "GARZAS"])).toBe(false);
    expect(corroboratesFlow(model, [...PRINTED, "PECES"])).toBe(false);
    expect(corroboratesFlow(model, ["ALGAS", "ALGAS"])).toBe(false);
    const merged = (await readPage(await pondPdf({ merged: true }), "application/pdf", 1, 100)).model;
    expect(corroboratesFlow(merged, PRINTED)).toBe(false);
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

  it("conservar el original NO resuelve una barrera: una necesidad esencial sin ninguna otra decisión queda señalada (parada, no ficha válida)", () => {
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
    // Another applied decision serves the same need: it is covered and the sheet can go on.
    const covered = go([draft({ status: "conditional", question: "q_1" }), draft({ target: "act_3" })]);
    expect(covered.uncovered).toEqual([]);
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
