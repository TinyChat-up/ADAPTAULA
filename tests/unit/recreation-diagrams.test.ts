import { describe, expect, it } from "vitest";
import { RECREATION_PLANNER_V6 } from "@prompts/recreation-planner/v6";
import { RECREATION_PLANNER_V7 } from "@prompts/recreation-planner/v7";
import { RecreationPlanLegacySchema, type Diagram, type RecreationPlan } from "@/lib/recreation/contract";
import { diagramSpecOf, labelSupported, relationEvidence } from "@/lib/recreation/diagrams";
import { auditFidelity } from "@/lib/recreation/fidelity";
import { planRecreation, runRecreation } from "@/lib/recreation/pilot";
import { chooseScheme } from "@/lib/recreation/relations";
import { sanitizePlan, undesignedResources } from "@/lib/recreation/repair";
import { verifyPlan } from "@/lib/recreation/verify";
import { buildRenderModel } from "@/lib/render/model";
import { renderPrintHtml } from "@/lib/render/print/html";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { describeDiagram, diagramIssues, levelsOf, pathOf } from "@/lib/visuals/diagram";
import { VisualSpecSchema } from "@/lib/visuals/spec";
import { POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { mockStack } from "../support/recreation-mocks";

/**
 * ADR-059, local and without API: Claude may design NEW exact schemes (nodes, relations, their evidence, the activities that use them)
 * and Adaptaula draws them with code. Reference case: the real failure of «Hacer magia» (planning, `planner_schema`,
 * `scheme_not_designed` on ra_4 after 2 calls), rebuilt synthetically because the rejected plan is never stored. Then the same
 * mechanism with Lengua and Matemáticas content: nothing in the engine depends on the subject.
 */

const clone = (patch: (p: RecreationPlan) => void): RecreationPlan => {
  const plan = structuredClone(POND_RECREATION_PLAN) as RecreationPlan;
  patch(plan);
  return plan;
};
const ra = (plan: RecreationPlan, id: string) => plan.activities.find((a) => a.id === id)!;

// ---- Ciencias: the food chain of the READING (not of any picture), for activity 4 ------------------------------------------------
const CHAIN_FACTS: RecreationPlan["facts"] = [
  { id: "f_20", kind: "statement", source_ref: "ctt_1", quote: "Algunas larvas se alimentan de algas" },
  { id: "f_21", kind: "statement", source_ref: "ctt_1", quote: "las ranas comen insectos y sus larvas" },
  { id: "f_22", kind: "statement", source_ref: "ctt_1", quote: "las garzas pueden alimentarse de ranas" },
];
const foodChain = (activityIds: string[] = ["ra_4"]): Diagram => ({
  id: "rd_1",
  layout: "chain",
  title: "Quién se alimenta de quién",
  purpose: "Seguir la relación alimentaria para predecir qué pasa si faltan las larvas.",
  activity_ids: activityIds,
  groups: [],
  nodes: [
    { id: "n_1", label: "Algas", fact_id: "f_20", group_id: null },
    { id: "n_2", label: "Larvas", fact_id: "f_20", group_id: null },
    { id: "n_3", label: "Ranas", fact_id: "f_21", group_id: null },
    { id: "n_4", label: "Garzas", fact_id: "f_22", group_id: null },
  ],
  relations: [
    { from: "n_1", to: "n_2", label: null, fact_id: "f_20" },
    { from: "n_2", to: "n_3", label: null, fact_id: "f_21" },
    { from: "n_3", to: "n_4", label: null, fact_id: "f_22" },
  ],
});
/** Activity 4 explains its prediction «con el esquema», and the scheme it means is a NEW one built from the reading. */
const withChain = (diagram: Diagram = foodChain()) => clone((p) => {
  p.facts.push(...CHAIN_FACTS);
  p.diagrams = [diagram];
});
const withWater = (): Diagram => ({
  id: "rd_2",
  layout: "groups",
  title: "El agua en mayo y en junio",
  purpose: "Comparar las dos situaciones antes de calcular.",
  activity_ids: ["ra_5"],
  groups: [{ id: "g_1", label: "Mayo" }, { id: "g_2", label: "Junio" }],
  nodes: [
    { id: "n_1", label: "30 centímetros", fact_id: "f_13", group_id: "g_1" },
    { id: "n_2", label: "18 centímetros", fact_id: "f_14", group_id: "g_2" },
  ],
  relations: [],
});

const runV7 = async (plans: RecreationPlan[], prepare?: (s: ReturnType<typeof mockStack>) => void) => {
  const stack = mockStack({ imagesAuthorized: true, plans, promptVersion: 7 });
  prepare?.(stack);
  const outcome = await runRecreation(stack.planner, { ...stack.request, visualPolicy: "designed", diagrams: true });
  return { stack, outcome };
};
const studentHtml = async (doc: MaterialDocument, keep: (b: MaterialDocument["pages"][number]["blocks"][number]) => boolean) => {
  const pages = doc.pages.map((p) => ({ ...p, blocks: p.blocks.filter(keep) })).filter((p) => p.blocks.length > 0);
  const out = await renderPrintHtml(buildRenderModel({ ...doc, pages }, { mode: "student", deferred: [], requiredVisuals: [], assets: {} }).model, []);
  return out.html;
};

describe("causa raíz: el contrato v6 no podía expresar un esquema nuevo (caso de referencia)", () => {
  it("v6: un esquema con elementos que no están dibujados en el original se descarta en silencio y la actividad 4 vuelve como scheme_not_designed, dos veces", async () => {
    // What Claude can only write in v6: a «flow» tied to a picture (vis_2) with a node that picture does not print (the sun is in the reading).
    const plan = clone((p) => {
      p.visuals.push({ id: "rv_2", kind: "flow", title: "Del sol a las garzas", items: ["Luz del sol", "Algas", "Larvas de insectos", "Ranas", "Garzas"], source_ref: "vis_2" });
      ra(p, "ra_4").visual_ids = ["rv_2"];
      ra(p, "ra_4").prompt = "Imagina que casi desaparecen las larvas. ¿Qué pasaría en el estanque? Explica tu idea con el esquema del sol.";
    });
    const stack = mockStack({ imagesAuthorized: true, plans: [plan, plan], promptVersion: 6 });
    const planned = await planRecreation(stack.planner, { analysis: stack.request.analysis, context: stack.request.context, scope: "methodological", visualPolicy: "designed" });
    expect(planned.status).toBe("rejected");
    expect(planned.calls).toBe(2);
    if (planned.status === "rejected") {
      expect(planned.issues.filter((i) => i.severity === "error").map((i) => `${i.code}@${i.path}`)).toEqual(["scheme_not_designed@activities.ra_4"]);
      // The repair told Claude to use «the original's labels», which cannot express this scheme: the same plan fails again.
      expect(planned.issues.find((i) => i.code === "scheme_not_designed")!.message).toMatch(/rótulos del original/);
    }
  });

  it("v7: el mismo diseño como esquema NUEVO se planifica a la primera, sin llamadas adicionales", async () => {
    const stack = mockStack({ imagesAuthorized: true, plans: [withChain()], promptVersion: 7 });
    const planned = await planRecreation(stack.planner, { analysis: stack.request.analysis, context: stack.request.context, scope: "methodological", visualPolicy: "designed", diagrams: true });
    expect(planned.status).toBe("planned");
    expect(planned.calls).toBe(1);
    expect(stack.calls.recreation_plan).toBe(1);
  });
});

describe("Ciencias · la actividad 4 obtiene SU esquema, dibujado por código", () => {
  it("el esquema llega al documento, ligado a la actividad 4, con la relación y el orden diseñados, y sin pedir nada a OpenAI", async () => {
    const { stack, outcome } = await runV7([withChain()]);
    if (outcome.status !== "ready") throw new Error(outcome.status);
    expect(outcome.compiled.links!.activities.ra_4).toEqual(["rd:rd_1"]);
    const blocks = outcome.compiled.student.pages.flatMap((p) => p.blocks);
    const drawn = blocks.find((b) => b.id === outcome.compiled.links!.printed["rd:rd_1"])!;
    expect(drawn.type === "image" && drawn.source.kind === "figure" && drawn.source.spec).toMatchObject({ kind: "diagram", layout: "chain" });
    if (drawn.type === "image" && drawn.source.kind === "figure" && drawn.source.spec.kind === "diagram") {
      expect(pathOf(drawn.source.spec)!.map((id) => drawn.source.kind === "figure" && drawn.source.spec.kind === "diagram" ? drawn.source.spec.nodes.find((n) => n.id === id)!.label : "")).toEqual(["Algas", "Larvas", "Ranas", "Garzas"]);
    }
    const act4 = blocks.find((b) => b.type === "activity" && b.label === "4");
    expect(act4?.type === "activity" && act4.resource_block_ids).toContain(drawn.id);
    // The cognitive operation and the instruction are Claude's, untouched.
    expect(act4?.type === "activity" && act4.prompt).toBe(ra(POND_RECREATION_PLAN as RecreationPlan, "ra_4").prompt);
    expect(outcome.plan.activities.find((a) => a.id === "ra_4")!.operations).toEqual(["predict", "justify"]);
    // Code drew it: the image calls are the plan's own pictures, not one more for the scheme.
    const withoutDiagram = await runV7([clone(() => undefined)]);
    expect(stack.calls.image).toBe(withoutDiagram.stack.calls.image);
    expect(outcome.compiled.lost).toEqual([]);
    expect(auditFidelity(outcome.plan, outcome.compiled, outcome.visuals, stack.request.analysis)).toEqual([]);
    // Honest provenance: the drawing is exact; what each arrow means is the design's reading, for the teacher to review.
    expect(outcome.provenance.find((r) => r.resource === "Esquema nuevo «Quién se alimenta de quién»")).toMatchObject({ status: "dibujo exacto; lectura de las flechas: revisión docente" });
    expect(outcome.verification.review_required).toBe(true);
    expect(outcome.verification.issues.map((i) => `${i.severity}:${i.code}`)).toContain("warning:diagram_relation_reading_unverified");
  });

  it("el PDF (el HTML que se imprime) contiene el esquema realmente pedido junto a la actividad 4", async () => {
    const { outcome } = await runV7([withChain()]);
    if (outcome.status !== "ready") throw new Error(outcome.status);
    const id = outcome.compiled.links!.printed["rd:rd_1"];
    const html = await studentHtml(outcome.compiled.student, (b) => b.id === id || (b.type === "activity" && b.label === "4"));
    expect(html).toContain('data-spec="diagram"');
    expect(html).toContain('data-layout="chain"');
    for (const label of ["Quién se alimenta de quién", "Algas", "Larvas", "Ranas", "Garzas"]) expect(html).toContain(label);
    expect(html.indexOf("Algas")).toBeLessThan(html.indexOf("Garzas"));
  });

  it("no se inventan relaciones: una flecha que ninguna cita enuncia vuelve a Claude con el motivo exacto", () => {
    const plan = withChain({ ...foodChain(), relations: [...foodChain().relations.slice(0, 2), { from: "n_3", to: "n_4", label: null, fact_id: "f_20" }] });
    const v = verifyPlan(plan, mockStack().request.analysis, { needs: [] });
    expect(v.issues.filter((i) => i.severity === "error").map((i) => `${i.code}@${i.path}`)).toContain("diagram_relation_unsupported@diagrams.rd_1");
    const label = withChain({ ...foodChain(), nodes: foodChain().nodes.map((n) => (n.id === "n_4" ? { ...n, label: "Peces" } : n)) });
    expect(verifyPlan(label, mockStack().request.analysis, { needs: [] }).issues.map((i) => i.code)).toContain("diagram_label_unsupported");
  });

  it("un esquema que no forma la cadena que dice no se dibuja", () => {
    const broken = withChain({ ...foodChain(), relations: foodChain().relations.slice(0, 2) });
    expect(verifyPlan(broken, mockStack().request.analysis, { needs: [] }).issues.map((i) => i.code)).toContain("diagram_shape");
  });

  it("un esquema nunca da la respuesta: ni flechas rotuladas donde se pide interpretar la relación, ni los elementos ya clasificados", () => {
    const analysis = mockStack().request.analysis;
    const labelled = withChain({ ...foodChain(["ra_3"]), relations: foodChain().relations.map((r) => ({ ...r, label: "alimento de" })) });
    expect(verifyPlan(labelled, analysis, { needs: [] }).issues.filter((i) => i.code === "solution_revealed").map((i) => i.path)).toContain("activities.ra_3");
    const sorted = clone((p) => {
      p.diagrams = [{ id: "rd_3", layout: "groups", title: "Componentes", purpose: "Ver los componentes.", activity_ids: ["ra_1"], groups: [{ id: "g_1", label: "Ser vivo" }, { id: "g_2", label: "Elemento no vivo" }], nodes: [{ id: "n_1", label: "Algas", fact_id: "f_1", group_id: "g_1" }, { id: "n_2", label: "Agua", fact_id: "f_2", group_id: "g_2" }], relations: [] }];
    });
    expect(verifyPlan(sorted, analysis, { needs: [] }).issues.filter((i) => i.code === "solution_revealed").length).toBeGreaterThan(0);
  });
});

describe("lo que una cita puede probar de una relación, y lo que no", () => {
  const analysis = mockStack().request.analysis;
  it("acepta una frase afirmativa que une los dos extremos", () => {
    expect(relationEvidence("Larvas", "Algas", "Algunas larvas se alimentan de algas")).toEqual({ ok: true });
    expect(relationEvidence("Ranas", "Larvas", "las ranas comen insectos y sus larvas")).toEqual({ ok: true });
    expect(relationEvidence("Oración", "Predicado", "La oración tiene dos partes: el sujeto y el predicado")).toEqual({ ok: true });
    expect(relationEvidence("1/2", "2/4", "1/2 es igual a 2/4")).toEqual({ ok: true });
  });

  it("rechaza una frase negativa, aunque nombre los dos extremos", () => {
    expect(relationEvidence("Garzas", "Algas", "Las garzas no comen algas")).toEqual({ ok: false, reason: "negated" });
    expect(relationEvidence("Ranas", "Algas", "Ni las ranas ni los peces se alimentan de algas")).toEqual({ ok: false, reason: "negated" });
    expect(relationEvidence("Sujeto", "Verbo", "El sujeto nunca es el verbo")).toEqual({ ok: false, reason: "negated" });
  });

  it("rechaza una enumeración: nombrar dos elementos no es relacionarlos", () => {
    expect(relationEvidence("Algas", "Larvas", "En el estanque viven algas, plantas acuáticas, larvas de insectos, ranas y garzas")).toEqual({ ok: false, reason: "list" });
    expect(relationEvidence("Ranas", "Garzas", "En el estanque viven algas, plantas acuáticas, larvas de insectos, ranas y garzas")).toEqual({ ok: false, reason: "no_link" });
    expect(relationEvidence("3/4", "0,75", "Escribe 3/4 y 0,75")).toEqual({ ok: false, reason: "no_link" });
  });

  it("rechaza dos elementos dichos en frases distintas, y una cita que no nombra uno de ellos", () => {
    expect(relationEvidence("Algas", "Garzas", "Las algas crecen con la luz. Las garzas vuelan sobre el agua.")).toEqual({ ok: false, reason: "separate_clauses" });
    expect(relationEvidence("Algas", "Peces", "Algunas larvas se alimentan de algas")).toEqual({ ok: false, reason: "missing" });
  });

  it("no afirma la dirección: una flecha al revés pasa la comprobación de la cita, y por eso queda marcada sin comprobar y para revisión", () => {
    // «Algunas larvas se alimentan de algas» joins both ends; nothing in it tells a program which way the arrow goes.
    expect(relationEvidence("Algas", "Larvas", "Algunas larvas se alimentan de algas")).toEqual(relationEvidence("Larvas", "Algas", "Algunas larvas se alimentan de algas"));
    const reversed = withChain({ ...foodChain(), relations: [{ from: "n_2", to: "n_1", label: null, fact_id: "f_20" }, { from: "n_1", to: "n_3", label: null, fact_id: "f_21" }, { from: "n_3", to: "n_4", label: null, fact_id: "f_22" }] });
    const v = verifyPlan(reversed, analysis, { needs: [] });
    expect(v.issues.find((i) => i.code === "diagram_relation_reading_unverified")).toMatchObject({ severity: "warning", path: "diagrams.rd_1" });
    expect(v.review_required).toBe(true);
  });

  it("en el plan: una flecha apoyada en una cita negativa o en una enumeración vuelve a Claude con el motivo", () => {
    const plan = withChain();
    plan.facts.push({ id: "f_23", kind: "statement", source_ref: "ctt_1", quote: "viven algas, plantas acuáticas, larvas de insectos, ranas y garzas" });
    plan.diagrams![0]!.relations[0]!.fact_id = "f_23";
    const issue = verifyPlan(plan, analysis, { needs: [] }).issues.find((i) => i.code === "diagram_relation_unsupported")!;
    expect(issue.message).toMatch(/solo los enumera/);
  });
});

describe("asociación automática sin adivinar", () => {
  const analysis = mockStack().request.analysis;
  it("un esquema declarado para otra actividad se enlaza a la que lo nombra solo si es el ÚNICO que encaja", () => {
    const plan = withChain(foodChain(["ra_3"]));
    plan.visuals = [];
    ra(plan, "ra_3").visual_ids = [];
    const sanitized = sanitizePlan(plan, analysis, [], "methodological", { picturesRequired: true, preciseRelations: true, diagrams: true });
    expect(sanitized.diagrams![0]!.activity_ids).toEqual(["ra_3", "ra_4"]);
    expect(undesignedResources(sanitized, { diagrams: true })).toEqual([]);
  });

  it("con dos candidatos (el del original y el nuevo) no se elige ninguno y Claude recibe qué esquemas existen", () => {
    const plan = withChain(foodChain(["ra_3"]));
    expect(chooseScheme(ra(plan, "ra_4"), plan, analysis)).toMatchObject({ ok: false, reason: "ambiguous" });
    const sanitized = sanitizePlan(plan, analysis, [], "methodological", { picturesRequired: true, preciseRelations: true, diagrams: true });
    const issue = undesignedResources(sanitized, { diagrams: true }).find((i) => i.path === "activities.ra_4")!;
    expect(issue.code).toBe("scheme_not_designed");
    expect(issue.message).toMatch(/diagrams.*"ra_4" en activity_ids/);
    expect(issue.message).toMatch(/rd_1 \(ra_3\)/);
  });

  it("el esquema que Claude enlaza explícitamente nunca se sustituye, y uno del original mal citado ya no se borra en silencio en v7", () => {
    const plan = withChain();
    plan.visuals.push({ id: "rv_2", kind: "flow", title: "Mal citado", items: ["Luz del sol", "Algas"], source_ref: "vis_2" });
    ra(plan, "ra_6").visual_ids = ["rv_2"];
    const v7 = sanitizePlan(plan, analysis, [], "methodological", { picturesRequired: true, preciseRelations: true, diagrams: true });
    expect(v7.visuals.map((v) => v.id)).toContain("rv_2");
    expect(verifyPlan(v7, analysis, { needs: [] }).issues.map((i) => `${i.code}@${i.path}`)).toContain("visual_label_not_in_source@visuals.rv_2");
    const v6 = sanitizePlan(plan, analysis, [], "methodological", { picturesRequired: true, preciseRelations: true });
    expect(v6.visuals.map((v) => v.id)).not.toContain("rv_2");
  });
});

describe("dos esquemas nuevos y actividades con recursos distintos: un intercambio se detecta", () => {
  it("la actividad 4 lleva la cadena y la 5 la comparación; intercambiarlas es un error de fidelidad", async () => {
    const plan = withChain();
    plan.diagrams!.push(withWater());
    const { stack, outcome } = await runV7([plan]);
    if (outcome.status !== "ready") throw new Error(outcome.status);
    expect(outcome.compiled.links!.activities.ra_4).toEqual(["rd:rd_1"]);
    expect(outcome.compiled.links!.activities.ra_5).toEqual(["rd:rd_2"]);
    expect(auditFidelity(outcome.plan, outcome.compiled, outcome.visuals, stack.request.analysis)).toEqual([]);
    const swapped = structuredClone(outcome.compiled);
    const [a, b] = [swapped.links!.printed["rd:rd_1"]!, swapped.links!.printed["rd:rd_2"]!];
    for (const block of swapped.student.pages.flatMap((p) => p.blocks)) {
      if (block.type === "activity" && block.resource_block_ids) block.resource_block_ids = block.resource_block_ids.map((x) => (x === a ? b : x === b ? a : x));
    }
    const issues = auditFidelity(outcome.plan, swapped, outcome.visuals, stack.request.analysis).map((i) => `${i.activity}: ${i.message}`);
    expect(issues).toContain("4: el esquema «rd_1» no está ligado a la actividad");
    expect(issues).toContain("5: el esquema «rd_2» no está ligado a la actividad");
    // The drawing itself replaced by another design is also caught.
    const redrawn = structuredClone(outcome.compiled);
    const block = redrawn.student.pages.flatMap((p) => p.blocks).find((x) => x.id === a)!;
    if (block.type === "image" && block.source.kind === "figure") block.source.spec = diagramSpecOf(withWater());
    expect(auditFidelity(outcome.plan, redrawn, outcome.visuals, stack.request.analysis).map((i) => i.message)).toContain("el esquema ligado no es «rd_1»: sus nodos o sus relaciones no coinciden con el diseño");
  });
});

describe("el mismo mecanismo en otras asignaturas (nada depende del estanque)", () => {
  const addText = (stack: ReturnType<typeof mockStack>, text: string, subject: string) => {
    const base = stack.request.analysis.texts.find((t) => t.id === "ctt_3")!;
    stack.request.analysis.texts.push({ ...base, id: "ctt_9", text });
    stack.request.analysis.identification.subject.value = subject;
  };

  it("Lengua: una jerarquía nueva (oración → sujeto y predicado) para la actividad que la nombra", async () => {
    const plan = clone((p) => {
      p.facts.push({ id: "f_30", kind: "statement", source_ref: "ctt_9", quote: "La oración tiene dos partes: el sujeto y el predicado" });
      ra(p, "ra_4").prompt = "Mira el esquema de la oración. Escribe una oración sobre las ranas del estanque y explica qué parte es el sujeto.";
      p.diagrams = [{
        id: "rd_1", layout: "hierarchy", title: "Partes de la oración", purpose: "Recordar las dos partes antes de escribir.", activity_ids: ["ra_4"], groups: [],
        nodes: [{ id: "n_1", label: "Oración", fact_id: "f_30", group_id: null }, { id: "n_2", label: "Sujeto", fact_id: "f_30", group_id: null }, { id: "n_3", label: "Predicado", fact_id: "f_30", group_id: null }],
        relations: [{ from: "n_1", to: "n_2", label: null, fact_id: "f_30" }, { from: "n_1", to: "n_3", label: null, fact_id: "f_30" }],
      }];
    });
    const { stack, outcome } = await runV7([plan], (s) => addText(s, "La oración tiene dos partes: el sujeto y el predicado. El sujeto es de quien se dice algo.", "Lengua Castellana"));
    if (outcome.status !== "ready") throw new Error(outcome.status === "rejected" ? JSON.stringify(outcome.issues.filter((i) => i.severity === "error")) : outcome.status);
    expect(outcome.compiled.links!.activities.ra_4).toEqual(["rd:rd_1"]);
    expect(auditFidelity(outcome.plan, outcome.compiled, outcome.visuals, stack.request.analysis)).toEqual([]);
    const id = outcome.compiled.links!.printed["rd:rd_1"];
    const html = await studentHtml(outcome.compiled.student, (b) => b.id === id);
    expect(html).toContain('data-layout="hierarchy"');
    for (const label of ["Oración", "Sujeto", "Predicado"]) expect(html).toContain(label);
  });

  it("Matemáticas: una cadena de fracciones equivalentes, con los números citados tal cual", async () => {
    const plan = clone((p) => {
      p.facts.push({ id: "f_40", kind: "statement", source_ref: "ctt_9", quote: "1/2 es igual a 2/4" }, { id: "f_41", kind: "statement", source_ref: "ctt_9", quote: "2/4 es igual a 4/8" });
      ra(p, "ra_4").prompt = "Mira el esquema de fracciones. Escribe otra fracción equivalente a 1/2 y explica cómo la has obtenido.";
      p.diagrams = [{
        id: "rd_1", layout: "chain", title: "Fracciones equivalentes", purpose: "Ver que la misma cantidad se escribe de varias formas.", activity_ids: ["ra_4"], groups: [],
        nodes: [{ id: "n_1", label: "1/2", fact_id: "f_40", group_id: null }, { id: "n_2", label: "2/4", fact_id: "f_40", group_id: null }, { id: "n_3", label: "4/8", fact_id: "f_41", group_id: null }],
        relations: [{ from: "n_1", to: "n_2", label: "es igual a", fact_id: "f_40" }, { from: "n_2", to: "n_3", label: "es igual a", fact_id: "f_41" }],
      }];
    });
    const { stack, outcome } = await runV7([plan], (s) => addText(s, "Una fracción puede escribirse de varias formas: 1/2 es igual a 2/4 y 2/4 es igual a 4/8.", "Matemáticas"));
    if (outcome.status !== "ready") throw new Error(outcome.status === "rejected" ? JSON.stringify(outcome.issues.filter((i) => i.severity === "error")) : outcome.status);
    expect(outcome.compiled.links!.activities.ra_4).toEqual(["rd:rd_1"]);
    expect(auditFidelity(outcome.plan, outcome.compiled, outcome.visuals, stack.request.analysis)).toEqual([]);
    const html = await studentHtml(outcome.compiled.student, (b) => b.id === outcome.compiled.links!.printed["rd:rd_1"]);
    for (const label of ["1/2", "2/4", "4/8", "es igual a"]) expect(html).toContain(label);
    // A number the quote does not say is not evidence.
    expect(labelSupported("3/6", "1/2 es igual a 2/4")).toBe(false);
  });
});

describe("la herramienta de dibujo y la compatibilidad", () => {
  it("cada forma se comprueba antes de dibujarse (cadena, ciclo, jerarquía, grupos)", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `n_${i + 1}` }));
    expect(pathOf({ layout: "cycle", nodes: n(3), edges: [{ from: "n_1", to: "n_2" }, { from: "n_2", to: "n_3" }, { from: "n_3", to: "n_1" }], groups: [] })).toEqual(["n_1", "n_2", "n_3"]);
    expect(diagramIssues({ layout: "cycle", nodes: n(3), edges: [{ from: "n_1", to: "n_2" }, { from: "n_2", to: "n_3" }], groups: [] })).not.toEqual([]);
    expect(levelsOf({ layout: "hierarchy", nodes: n(4), edges: [{ from: "n_1", to: "n_2" }, { from: "n_1", to: "n_3" }, { from: "n_3", to: "n_4" }], groups: [] })).toEqual([["n_1"], ["n_2", "n_3"], ["n_4"]]);
    expect(diagramIssues({ layout: "hierarchy", nodes: n(3), edges: [{ from: "n_1", to: "n_2" }, { from: "n_3", to: "n_2" }], groups: [] })).not.toEqual([]);
    expect(diagramIssues({ layout: "groups", nodes: [{ id: "n_1", group: 0 }, { id: "n_2", group: 1 }], edges: [], groups: ["A", "B"] })).toEqual([]);
    expect(diagramIssues({ layout: "groups", nodes: [{ id: "n_1", group: 0 }, { id: "n_2", group: 0 }], edges: [], groups: ["A", "B"] })).toEqual(["un grupo está vacío"]);
    const spec = diagramSpecOf(foodChain());
    expect(VisualSpecSchema.safeParse(spec).success).toBe(true);
    expect(describeDiagram(spec)).toBe("Quién se alimenta de quién. Algas → Larvas → Ranas → Garzas.");
  });

  it("v1–v6 no cambian: su esquema de salida no tiene diagrams y un plan antiguo no gana ninguno", () => {
    expect(RECREATION_PLANNER_V6.output.schema).toBe(RecreationPlanLegacySchema);
    expect(RecreationPlanLegacySchema.parse(withChain())).not.toHaveProperty("diagrams");
    expect(RECREATION_PLANNER_V7.system.startsWith(RECREATION_PLANNER_V6.system)).toBe(true);
    expect(RECREATION_PLANNER_V7.version).toBe(7);
    const legacy = sanitizePlan(withChain(), mockStack().request.analysis, [], "methodological", { picturesRequired: true, preciseRelations: true });
    expect(legacy.diagrams).toBeUndefined();
  });
});
