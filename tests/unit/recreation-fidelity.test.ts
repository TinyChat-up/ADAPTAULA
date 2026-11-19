import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { compileRecreation } from "@/lib/recreation/compile";
import { auditFidelity } from "@/lib/recreation/fidelity";
import { planRecreation, runRecreation } from "@/lib/recreation/pilot";
import { chooseScheme } from "@/lib/recreation/relations";
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
    expect(errors[0]!.message).toMatch(/Enlaza en visual_ids de cada actividad el esquema que necesita/);
  });

  it("con el diagrama del original (rótulos unidos por «→»), el renderizador lo dibuja: no hace falta que Claude lo declare", () => {
    const plan = clone((p) => { p.visuals = []; p.activities.forEach((a) => (a.visual_ids = [])); p.visual_requests[0]!.needs_exact = { labels: false, arrows: true, numbers: false }; });
    const withFlow = structuredClone(analysis);
    withFlow.visuals[1]!.text = "Algas → Larvas de insectos → Ranas → Garzas";
    // Only when the request points at THAT original picture (or the activity's facts cite it): never "any diagram of the analysis".
    expect(decideResource(plan.visual_requests[0]!, plan, withFlow).route).toBe("gap");
    plan.visual_requests[0]!.original_ref = withFlow.visuals[1]!.id;
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

describe("dos esquemas distintos y actividades que necesitan recursos diferentes (ADR-058)", () => {
  /** ra_4 depends on the food chain (rv_1); ra_5 on the water level table (rv_2). Neither is linked by Claude: evidence decides. */
  const twoSchemes = () => clone((p) => {
    p.visuals = [
      { id: "rv_1", kind: "flow", title: "Esquema del estanque", items: ["Algas", "Larvas de insectos", "Ranas", "Garzas"], source_ref: "vis_2" },
      { id: "rv_2", kind: "flow", title: "Nivel del agua", items: ["MAYO", "JUNIO"], source_ref: "vis_3" },
    ];
    p.activities.find((a) => a.id === "ra_3")!.visual_ids = ["rv_1"];
    p.activities.find((a) => a.id === "ra_5")!.prompt = "Mira el esquema del nivel del agua en mayo y en junio. Calcula cuántos centímetros bajó.";
  });
  const run = async (plan: ReturnType<typeof twoSchemes>) => {
    const stack = mockStack({ imagesAuthorized: true, plans: [plan] });
    const outcome = await runRecreation(stack.planner, { ...stack.request, visualPolicy: "designed" });
    if (outcome.status !== "ready") throw new Error(`${outcome.status}`);
    return outcome;
  };

  it("cada actividad recibe SU esquema, no el primero de la lista", async () => {
    const plan = twoSchemes();
    const ra4 = plan.activities.find((a) => a.id === "ra_4")!;
    const ra5 = plan.activities.find((a) => a.id === "ra_5")!;
    expect(chooseScheme(ra4, plan, analysis)).toMatchObject({ ok: true, flow: { key: "rv:rv_1" } });
    expect(chooseScheme(ra5, plan, analysis)).toMatchObject({ ok: true, flow: { key: "rv:rv_2" } });
    const outcome = await run(plan);
    expect(outcome.compiled.links!.activities.ra_4).toContain("rv:rv_1");
    expect(outcome.compiled.links!.activities.ra_4).not.toContain("rv:rv_2");
    expect(outcome.compiled.links!.activities.ra_5).toEqual(["rv:rv_2"]);
    expect(outcome.compiled.lost).toEqual([]);
    expect(auditFidelity(outcome.plan, outcome.compiled, outcome.visuals, analysis)).toEqual([]);
  });

  it("sin evidencia, o con varios candidatos, NO se adivina: la actividad queda sin esquema y la ficha incompleta", () => {
    const ambiguous = twoSchemes();
    ambiguous.activities.find((a) => a.id === "ra_5")!.prompt = "Mira el esquema. Compara mayo y junio con las larvas de insectos y las ranas.";
    expect(chooseScheme(ambiguous.activities.find((a) => a.id === "ra_5")!, ambiguous, analysis)).toMatchObject({ ok: false, reason: "ambiguous" });
    const none = twoSchemes();
    none.activities.find((a) => a.id === "ra_5")!.prompt = "Mira el esquema y calcula cuántos centímetros bajó el agua.";
    expect(chooseScheme(none.activities.find((a) => a.id === "ra_5")!, none, analysis)).toMatchObject({ ok: false, reason: "none" });
  });

  it("una actividad que nombra un esquema sin ninguno que le corresponda vuelve a Claude ANTES de generar nada", async () => {
    const plan = twoSchemes();
    plan.activities.find((a) => a.id === "ra_5")!.prompt = "Mira el esquema y calcula cuántos centímetros bajó el agua.";
    const stack = mockStack({ imagesAuthorized: true, plans: [plan, plan] });
    const planned = await planRecreation(stack.planner, { analysis: stack.request.analysis, context: stack.request.context, scope: "methodological", visualPolicy: "designed" });
    expect(planned.status).toBe("rejected");
    if (planned.status === "rejected") expect(planned.issues.find((i) => i.code === "scheme_not_designed")?.path).toBe("activities.ra_5");
    expect(stack.calls.image ?? 0).toBe(0);
  });

  it("y si llegara al compilador (defensa en profundidad), la ficha queda incompleta y no se adivina otro esquema", async () => {
    const stack = mockStack({ imagesAuthorized: true, plans: [twoSchemes()] });
    const outcome = await run(twoSchemes());
    const broken = structuredClone(outcome.plan);
    const ra5 = broken.activities.find((a) => a.id === "ra_5")!;
    ra5.prompt = "Mira el esquema y calcula cuántos centímetros bajó el agua.";
    ra5.visual_ids = []; // the sanitised plan had linked rv_2 by evidence; here nothing links it
    const compiled = compileRecreation({ plan: broken, verification: outcome.verification, analysis, presentation: stack.request.context.presentation, visuals: outcome.visuals, reword: false, designed: true });
    expect(compiled.unresolved).toContain("5");
    expect(compiled.lost!.join(" ")).toMatch(/actividad 5: ningún esquema corresponde/);
    expect(compiled.links!.activities.ra_5).toEqual([]);
  });

  it("un esquema intercambiado entre actividades se detecta como error", async () => {
    const outcome = await run(twoSchemes());
    const tampered = structuredClone(outcome.compiled);
    const blocks = tampered.student.pages[0]!.blocks;
    const act = (label: string) => blocks.find((b) => b.type === "activity" && b.label === label) as Extract<(typeof blocks)[number], { type: "activity" }>;
    // ra_4 and ra_5 exchange their resource blocks.
    const [r4, r5] = [act("4").resource_block_ids, act("5").resource_block_ids];
    act("4").resource_block_ids = r5;
    act("5").resource_block_ids = r4;
    const lost = auditFidelity(outcome.plan, tampered, outcome.visuals, analysis).map((l) => `${l.activity}: ${l.message}`);
    expect(lost.some((m) => m.startsWith("4:") && /no está ligado/.test(m))).toBe(true);
    expect(lost.some((m) => m.startsWith("5:") && /no está ligado/.test(m))).toBe(true);
  });

  it("un bloque con los rótulos de OTRO esquema también se detecta aunque esté ligado a la actividad", async () => {
    const outcome = await run(twoSchemes());
    const tampered = structuredClone(outcome.compiled);
    const images = tampered.student.pages[0]!.blocks.filter((b) => b.type === "image" && b.source.kind === "figure" && b.source.spec.kind === "flow");
    const [x, y] = images as Array<{ source: { spec: { items: string[] }; visual_ref?: string } }>;
    [x!.source.spec.items, y!.source.spec.items] = [y!.source.spec.items, x!.source.spec.items];
    const lost = auditFidelity(outcome.plan, tampered, outcome.visuals, analysis).map((l) => l.message);
    expect(lost.join(" | ")).toMatch(/el esquema ligado no es «rv_[12]»/);
  });

  it("materiales: tarjetas, ilustraciones por tarjeta, tablero y actividad se comprueban por identidad", async () => {
    const outcome = await run(twoSchemes());
    expect(outcome.compiled.links!.materials).toMatchObject({ rm_1: expect.any(String), rm_2: expect.any(String) });
    const swapped = structuredClone(outcome.compiled);
    const imgs = swapped.materials!.pages.flatMap((p) => p.blocks).filter((b) => b.type === "image") as Array<{ source: { spec: unknown } }>;
    [imgs[0]!.source.spec, imgs[1]!.source.spec] = [imgs[1]!.source.spec, imgs[0]!.source.spec];
    const lost = auditFidelity(outcome.plan, swapped, outcome.visuals, analysis).map((l) => l.message).join(" | ");
    expect(lost).toMatch(/las tarjetas del material «rm_1» no son las diseñadas/);
    expect(lost).toMatch(/las columnas del tablero «rm_2» no son las diseñadas/);

    const pictures = structuredClone(outcome.compiled);
    const cards = pictures.materials!.pages.flatMap((p) => p.blocks).find((b) => b.type === "image" && b.source.kind === "figure" && b.source.spec.kind === "cut_cards") as { source: { spec: { pictures?: Array<string | null> } } };
    expect(cards.source.spec.pictures?.length).toBeGreaterThan(1);
    const pics = cards.source.spec.pictures!;
    [pics[0], pics[1]] = [pics[1] ?? null, pics[0] ?? null];
    expect(auditFidelity(outcome.plan, pictures, outcome.visuals, analysis).map((l) => l.message).join(" | ")).toMatch(/la ilustración de la tarjeta .* no es la que se le asignó/);

    const rehomed = structuredClone(outcome.compiled);
    const heading = rehomed.materials!.pages.flatMap((p) => p.blocks).find((b) => b.type === "heading" && b.level === 2) as { text: string };
    heading.text = "Tarjetas · actividad 5";
    expect(auditFidelity(outcome.plan, rehomed, outcome.visuals, analysis).map((l) => l.message).join(" | ")).toMatch(/no está bajo la actividad 1/);
  });
});
