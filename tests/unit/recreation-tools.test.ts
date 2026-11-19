import { describe, expect, it } from "vitest";
import { RECREATION_PLANNER_V5 } from "@prompts/recreation-planner/v5";
import { RECREATION_PLANNER_V6 } from "@prompts/recreation-planner/v6";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { validateBrief } from "@/lib/visuals/illustration";
import { planRecreation } from "@/lib/recreation/pilot";
import { briefOf, decideResource, qualitative, toolReport, TOOL_LIMIT_VIOLATIONS } from "@/lib/recreation/tools";
import { verifyPlan } from "@/lib/recreation/verify";
import { POND_PILOT_PROFILE, POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { pondAnalysis } from "../support/pond-case";
import { mockStack } from "../support/recreation-mocks";

/**
 * ADR-056: a limit of an image tool is adapted for, not an error of the idea. Regression of the real failure
 * `illustration_not_drawable` (a request with counts, measures and numbered parts), and of what must STILL stop a plan.
 * Local, 0 API calls.
 */
const analysis = pondAnalysis();
const needs = buildAdaptationContext({ profile: POND_PILOT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "methodological" }).context.needs.map((n) => n.dimension);
const verified = verifyPlan(POND_RECREATION_PLAN, analysis, { needs });
const LIMITS = { maxImages: 8 };

const planWith = (patch: (plan: typeof POND_RECREATION_PLAN) => void) => {
  const plan = structuredClone(POND_RECREATION_PLAN);
  patch(plan);
  return plan;
};
/** The pond's own requests, rewritten the way a designer writes them: counts, a measure, an exact-looking phrase. */
const richRequests = (plan: typeof POND_RECREATION_PLAN) => {
  const r = plan.visual_requests[0]!;
  r.must_show = ["tres ranas en la orilla", "20 cm de agua en el estanque", "una garza", "un grupo de cuatro libélulas"];
  r.concepts = ["ecosistema del estanque", "dos productores"];
  r.alt_text = "Un estanque con tres ranas, una garza y 20 cm de agua.";
  r.needs_exact = { labels: false, arrows: false, numbers: false };
  plan.activities.find((a) => r.activity_ids.includes(a.id))!.prompt = "Observa las partes señaladas con los números 1 y 2 de la escena. ¿Cuál es un ser vivo?";
};

describe("una limitación de OpenAI se adapta, no rechaza la planificación", () => {
  it("cantidades, medidas y partes numeradas pasan al renderizador y la ilustración se pide sin ellas", () => {
    const plan = planWith(richRequests);
    const report = toolReport(plan, verified, needs, LIMITS);
    expect(report.errors).toEqual([]);
    expect(report.notes.join(" ")).toMatch(/ranas/);
    const { brief } = briefOf(plan.visual_requests[0]!, plan, null);
    const text = JSON.stringify(brief);
    expect(text).not.toMatch(/\b\d+\b|\b(dos|tres|cuatro)\b/i);
    expect(brief.required_elements!.map((e) => e.name).join(" ")).toMatch(/ranas/);
  });

  it("con las reglas anteriores esa misma petición era un error: ahora solo lo son los fallos reales", () => {
    const plan = planWith(richRequests);
    const raw = { ...briefOf(plan.visual_requests[0]!, plan, null).brief, alt_text: plan.visual_requests[0]!.alt_text, required_elements: [{ name: "tres ranas", marker: null, label: null }] };
    const strict = validateBrief(raw, { activity: plan.activities[0]!.prompt, expectedAnswer: null, signatures: [], lowDetail: false });
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.violations.every((v) => TOOL_LIMIT_VIOLATIONS.has(v))).toBe(true);
    expect(validateBrief(raw, { activity: "", expectedAnswer: null, signatures: [], lowDetail: false, ignore: TOOL_LIMIT_VIOLATIONS }).ok).toBe(true);
  });

  it("la traducción conserva lo visual y quita solo lo exacto", () => {
    expect(qualitative("tres ranas en la orilla").text).toBe("ranas en la orilla");
    expect(qualitative("20 cm de agua").text).toBe("de agua");
    expect(qualitative("una garza").changed).toBe(false);
  });

  it("flechas y rótulos exactos son del renderizador: no impiden la ilustración", () => {
    const r = { ...POND_RECREATION_PLAN.visual_requests[0]!, needs_exact: { labels: true, arrows: true, numbers: false } };
    expect(decideResource(r, POND_RECREATION_PLAN).route).toBe("illustration");
  });
});

describe("lo que sigue siendo un error para Claude", () => {
  it("una cantidad EXACTA de elementos dibujados es una limitación de herramienta, dicha como tal (solo si es imprescindible)", () => {
    const essential = planWith((p) => { p.visual_requests[0]!.needs_exact.numbers = true; p.visual_requests[0]!.essential = true; });
    const errors = toolReport(essential, verified, needs, LIMITS).errors;
    expect(errors.map((e) => e.code)).toEqual(["tool_gap"]);
    expect(errors[0]!.message).toMatch(/Limitación de herramienta, no de tu idea/);
    const optional = planWith((p) => { p.visual_requests[0]!.needs_exact.numbers = true; p.visual_requests[0]!.essential = false; });
    const report = toolReport(optional, verified, needs, LIMITS);
    expect(report.errors).toEqual([]);
    expect(report.notes.join(" ")).toMatch(/counted_group/);
  });

  it("revelar una respuesta en lo que debe verse sigue siendo un problema de la idea", () => {
    const choice = verified.activities.find((v) => v.solution.kind === "options");
    const answer = choice && choice.solution.kind === "options" ? choice.solution.correct[0]! : "";
    expect(answer).not.toBe("");
    const plan = planWith((p) => { p.visual_requests[0]!.alt_text = answer; p.visual_requests[0]!.activity_ids = [choice!.id]; });
    const errors = toolReport(plan, verified, needs, LIMITS).errors;
    expect(errors.map((e) => e.code)).toContain("illustration_unsafe");
    expect(errors.find((e) => e.code === "illustration_unsafe")!.message).toMatch(/Problema de la idea, no de la herramienta/);
  });

  it("el presupuesto: lo imprescindible debe caber; el resto se recorta al generar", () => {
    const many = planWith((p) => { const base = p.visual_requests[0]!; p.visual_requests = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(base), id: `vr_${i + 1}`, essential: true, must_show: ["una rana", "una garza"] })); });
    expect(toolReport(many, verified, needs, { maxImages: 3 }).errors.map((e) => e.code)).toContain("too_many_illustrations");
    const soft = planWith((p) => { const base = p.visual_requests[0]!; p.visual_requests = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(base), id: `vr_${i + 1}`, essential: false, must_show: ["una rana", "una garza"] })); });
    expect(toolReport(soft, verified, needs, { maxImages: 3 }).errors).toEqual([]);
  });
});

describe("recursos fuera del catálogo: se registran, no se inventan", () => {
  const custom = (essential: boolean) => planWith((p) => { p.custom_resources = [{ id: "rc_1", title: "Maqueta de papel del estanque", purpose: "Construir el ecosistema con las manos", activity_ids: [p.activities[0]!.id], description: "Una maqueta que el alumno monta sobre una base.", essential }]; });

  it("no esencial: pasa y queda como demanda; esencial: vuelve a Claude con alternativas", () => {
    expect(toolReport(custom(false), verified, needs, LIMITS)).toMatchObject({ errors: [] });
    expect(toolReport(custom(false), verified, needs, LIMITS).notes.join(" ")).toMatch(/Maqueta/);
    const errors = toolReport(custom(true), verified, needs, LIMITS).errors;
    expect(errors.map((e) => e.code)).toEqual(["tool_gap"]);
    expect(errors[0]!.message).toMatch(/ilustración, un esquema/);
  });

  it("el verificador rechaza un recurso ligado a una actividad que no existe", () => {
    const plan = planWith((p) => { p.custom_resources = [{ id: "rc_1", title: "x", purpose: "y", activity_ids: ["ra_99"], description: "z", essential: false }]; });
    expect(verifyPlan(plan, analysis, { needs }).issues.map((i) => i.code)).toContain("custom_resource_activity_unknown");
  });
});

describe("recorrido: una petición con límites de herramienta llega a OpenAI en vez de detener el plan", () => {
  it("la planificación acepta el plan y la ilustración se genera con el brief traducido", async () => {
    const plan = planWith(richRequests);
    const stack = mockStack({ imagesAuthorized: true, plans: [plan] });
    const planned = await planRecreation(stack.planner, { analysis: stack.request.analysis, context: stack.request.context, scope: "methodological", visualPolicy: "designed" });
    expect(planned.status).toBe("planned");
    expect(stack.calls.recreation_plan).toBe(1);
  });
});

describe("planificador v6", () => {
  it("añade libertad y herramientas sin tocar v5", () => {
    expect(RECREATION_PLANNER_V6.system.startsWith(RECREATION_PLANNER_V5.system)).toBe(true);
    expect(RECREATION_PLANNER_V6.system).toContain("custom_resources");
    expect(RECREATION_PLANNER_V6.system).toContain("no te autolimites");
    expect(RECREATION_PLANNER_V6.version).toBe(6);
  });
});
