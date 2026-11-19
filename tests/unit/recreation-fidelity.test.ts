import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { auditFidelity } from "@/lib/recreation/fidelity";
import { planRecreation, runRecreation } from "@/lib/recreation/pilot";
import { briefOf, decideResource, necessaryQuantities, toolReport } from "@/lib/recreation/tools";
import { verifyPlan } from "@/lib/recreation/verify";
import { POND_PILOT_PROFILE, POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { pondAnalysis } from "../support/pond-case";
import { mockStack } from "../support/recreation-mocks";

/**
 * ADR-057, local and without API: nothing Claude designs is lost between the plan and the documents. A quantity is only translated away
 * when the activity does not need it; every relation an activity depends on ends DRAWN in the document; frozen v5 keeps its rules.
 */
const analysis = pondAnalysis();
const needs = buildAdaptationContext({ profile: POND_PILOT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "methodological" }).context.needs.map((n) => n.dimension);
const verified = verifyPlan(POND_RECREATION_PLAN, analysis, { needs });
const LIMITS = { maxImages: 8 };
const clone = (patch: (p: typeof POND_RECREATION_PLAN) => void) => {
  const plan = structuredClone(POND_RECREATION_PLAN);
  patch(plan);
  return plan;
};
const sheetText = (doc: { pages: Array<{ blocks: Array<Record<string, unknown>> }> }) => JSON.stringify(doc.pages);

describe("una cantidad solo se traduce cuando la actividad no la necesita", () => {
  it("si la actividad pide contar a partir de la imagen, «tres ranas» NO se pierde: es una limitación dicha a Claude", () => {
    const plan = clone((p) => {
      p.activities[0]!.prompt = "Cuenta las ranas de la ilustración y escribe cuántas hay.";
      p.visual_requests[0]!.must_show = ["tres ranas en la orilla"];
    });
    expect(necessaryQuantities(plan.visual_requests[0]!, plan, verified).map((q) => `${q.token}@${q.activity}`)).toEqual(["tres@ra_1"]);
    const errors = toolReport(plan, verified, needs, LIMITS, analysis).errors;
    expect(errors.map((e) => e.code)).toEqual(["tool_gap"]);
    expect(errors[0]!.message).toMatch(/cantidad «tres».*necesaria en la actividad ra_1/);
    expect(errors[0]!.message).toMatch(/tarjetas \(una por elemento\)/);
  });

  it("si la cantidad forma parte de una respuesta verificada tampoco se elimina", () => {
    const plan = clone((p) => {
      p.visual_requests[0]!.activity_ids = ["ra_5"];
      p.visual_requests[0]!.must_show = ["12 algas en la superficie"];
    });
    expect(necessaryQuantities(plan.visual_requests[0]!, plan, verified).map((q) => q.why)).toEqual(["la cantidad forma parte de la respuesta"]);
    expect(toolReport(plan, verified, needs, LIMITS, analysis).errors.map((e) => e.code)).toContain("tool_gap");
  });

  it("si el propio enunciado ya la dice, la imagen no necesita llevarla: se traduce y queda REGISTRADO", () => {
    const plan = clone((p) => {
      p.activities[0]!.prompt = "En la orilla hay tres ranas. ¿Cuál de estos componentes es un ser vivo?";
      p.visual_requests[0]!.must_show = ["tres ranas en la orilla", "una garza"];
    });
    expect(necessaryQuantities(plan.visual_requests[0]!, plan, verified)).toEqual([]);
    expect(toolReport(plan, verified, needs, LIMITS, analysis).errors).toEqual([]);
    expect(briefOf(plan.visual_requests[0]!, plan, null).adapted.join(" ")).toMatch(/tres ranas en la orilla.*ranas en la orilla/);
  });

  it("de extremo a extremo, lo adaptado queda en el registro de la imagen (nunca en silencio)", async () => {
    const plan = clone((p) => { p.visual_requests[0]!.must_show = ["tres ranas en la orilla", "una garza"]; });
    const stack = mockStack({ imagesAuthorized: true, plans: [plan] });
    const outcome = await runRecreation(stack.planner, { ...stack.request, visualPolicy: "designed" });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    expect(outcome.visuals[0]!.attempts.filter((a) => a.startsWith("T:")).join(" ")).toMatch(/ranas/);
  });
});

describe("cada relación necesaria termina dibujada en el documento", () => {
  const arrowsPlan = () => clone((p) => {
    p.visual_requests[0]!.activity_ids = ["ra_4"];
    p.visual_requests[0]!.needs_exact = { labels: false, arrows: true, numbers: false };
    p.visual_requests[0]!.essential = false;
  });

  it("con el esquema declarado en el plan, la actividad lo recibe aunque no lo enlazara", async () => {
    const plan = arrowsPlan();
    expect(plan.activities.find((a) => a.id === "ra_4")!.visual_ids).toEqual([]);
    const stack = mockStack({ imagesAuthorized: true, plans: [plan] });
    const outcome = await runRecreation(stack.planner, { ...stack.request, visualPolicy: "designed" });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    const sheet = outcome.compiled.student;
    const blocks = sheet.pages[0]!.blocks;
    const activity = (label: string) => blocks.find((b) => b.type === "activity" && b.label === label);
    const linked = (label: string) => { const b = activity(label); return b && b.type === "activity" ? b.resource_block_ids ?? [] : []; };
    // One scheme is printed once; every activity that depends on it points at THAT block (the renderer repeats it on a later sheet).
    const flows = blocks.filter((b) => b.type === "image" && b.source.kind === "figure" && b.source.spec.kind === "flow").map((b) => b.id);
    expect(flows).toHaveLength(1);
    expect(linked("3")).toContain(flows[0]);
    expect(linked("4")).toContain(flows[0]);
    expect(outcome.compiled.unresolved).toEqual([]);
  });

  it("sin datos de los que dibujarlo, se dice ANTES de llamar a nadie (y vuelve a Claude)", () => {
    const plan = clone((p) => { p.visuals = []; p.activities.forEach((a) => (a.visual_ids = [])); p.visual_requests[0]!.needs_exact = { labels: false, arrows: true, numbers: false }; });
    const bare = structuredClone(analysis);
    for (const v of bare.visuals) v.text = null;
    expect(decideResource(plan.visual_requests[0]!, plan, bare)).toMatchObject({ route: "gap", gap: { capability: "exact_scheme_without_data" } });
    const errors = toolReport(plan, verified, needs, LIMITS, bare).errors;
    expect(errors.map((e) => e.code)).toContain("tool_gap");
    expect(errors[0]!.message).toMatch(/Declara en visuals un esquema/);
  });

  it("con el diagrama del original (rótulos unidos por «→»), el renderizador lo dibuja: no hace falta que Claude lo declare", () => {
    const plan = clone((p) => { p.visuals = []; p.activities.forEach((a) => (a.visual_ids = [])); p.visual_requests[0]!.needs_exact = { labels: false, arrows: true, numbers: false }; });
    const withFlow = structuredClone(analysis);
    withFlow.visuals[1]!.text = "Algas → Larvas de insectos → Ranas → Garzas";
    expect(decideResource(plan.visual_requests[0]!, plan, withFlow).route).toBe("illustration");
  });
});

describe("las adaptaciones congeladas con v5 no cambian sus reglas", () => {
  const rich = () => clone((p) => {
    p.visual_requests[0]!.must_show = ["tres ranas en la orilla", "20 cm de agua en el estanque", "una garza"];
    p.visual_requests[0]!.alt_text = "Un estanque con tres ranas y 20 cm de agua.";
  });

  it("v5 («new_images») sigue rechazando como antes; v6 («designed») acepta y adapta", async () => {
    const stack5 = mockStack({ imagesAuthorized: true, plans: [rich(), rich()] });
    const v5 = await planRecreation(stack5.planner, { analysis: stack5.request.analysis, context: stack5.request.context, scope: "methodological", visualPolicy: "new_images" });
    expect(v5.status).toBe("rejected");
    if (v5.status === "rejected") expect(v5.issues.map((i) => i.code)).toContain("illustration_not_drawable");
    const stack6 = mockStack({ imagesAuthorized: true, plans: [rich()] });
    const v6 = await planRecreation(stack6.planner, { analysis: stack6.request.analysis, context: stack6.request.context, scope: "methodological", visualPolicy: "designed" });
    expect(v6.status).toBe("planned");
  });

  it("el plan del estanque: v5 conserva su validador rígido (el fallo real) y v6 lo acepta", async () => {
    const v5stack = mockStack({ imagesAuthorized: true });
    const v5 = await planRecreation(v5stack.planner, { analysis: v5stack.request.analysis, context: v5stack.request.context, scope: "methodological", visualPolicy: "new_images" });
    expect(v5.status).toBe("rejected");
    if (v5.status === "rejected") expect(v5.issues.map((i) => i.code)).toContain("illustration_not_drawable");
    const v6stack = mockStack({ imagesAuthorized: true });
    expect((await planRecreation(v6stack.planner, { analysis: v6stack.request.analysis, context: v6stack.request.context, scope: "methodological", visualPolicy: "designed" })).status).toBe("planned");
  });
});

describe("auditoría de fidelidad: lo diseñado llega al documento", () => {
  it("la ficha del estanque no pierde nada entre el plan y los documentos", async () => {
    const stack = mockStack({ imagesAuthorized: true });
    const outcome = await runRecreation(stack.planner, { ...stack.request, visualPolicy: "designed" });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    expect(outcome.compiled.lost).toEqual([]);
    expect(auditFidelity(outcome.plan, outcome.compiled, outcome.visuals)).toEqual([]);
  });

  it("detecta cada pérdida con su actividad: una categoría, un paso, un material o un enlace", async () => {
    const stack = mockStack({ imagesAuthorized: true });
    const outcome = await runRecreation(stack.planner, { ...stack.request, visualPolicy: "designed" });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    const broken = structuredClone(outcome.compiled);
    const text = sheetText(broken.student);
    expect(text).toContain("Ser vivo");
    broken.student = { ...broken.student, pages: JSON.parse(text.replaceAll("Ser vivo", "Cosa")) };
    broken.materials = null;
    const lost = auditFidelity(outcome.plan, broken, outcome.visuals).map((l) => l.message);
    expect(lost.join(" | ")).toMatch(/falta «Ser vivo» en la respuesta/);
    expect(lost.join(" | ")).toMatch(/faltan los materiales/);
  });
});
