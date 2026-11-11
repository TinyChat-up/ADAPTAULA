import { describe, expect, it } from "vitest";
import { duplicatedContexts, sameText } from "@/lib/adaptation/document";
import { studentText } from "@/lib/adaptation/document-text";
import { auditGeneration } from "@/lib/adaptation/generation-checks";
import { assembleReview, deterministicChecks } from "@/lib/adaptation/review";
import { activityQuotas, groupedTaskQuotas, taskGroups } from "@/lib/render/task-groups";
import { allBlocks, type Block } from "@/lib/schemas/material-document";
import { POND, pondAnalysis } from "../support/pond-case";
import { pondCase } from "../support/pond-plan";

/**
 * Regression of the «Un estanque en equilibrio» sheet that «Hacer magia» delivered badly organised (5.º de Primaria, Ciencias):
 * the final review before the activities, «Lee el texto con atención» after the reading, the components of activity 2 alone on
 * page 1, the statement of activity 5 printed twice, 4a and 4b on different pages. The same assembly serves both planners.
 */

const refs = (b: Block) => b.trace.source_refs;
const flat = (pages: Block[][]) => pages.flatMap((p, page) => p.map((block, index) => ({ block, page, index })));

describe.each(["v2", "v3"] as const)("estanque · orden, proximidad y duplicación con el planificador %s", (planner) => {
  const c = pondCase(planner);
  const pages = c.document.pages.map((p) => p.blocks);
  const all = flat(pages);
  const at = (ref: string, type?: string) => all.find((x) => refs(x.block).includes(ref) && (type === undefined || x.block.type === type))!;
  const activityAt = (ref: string) => at(ref, "activity");
  const visibleText = allBlocks(c.document).map(studentText).join("\n");
  const count = (needle: string) => visibleText.split(needle).length - 1;

  it("la instrucción «Lee el texto con atención» va ANTES de la lectura a la que se refiere, sin perder ninguna de las dos", () => {
    const instruction = at("ctt_2");
    const reading = at("ctt_1");
    expect(instruction.block.type).toBe("instruction");
    expect(studentText(instruction.block)).toContain("Lee el texto con atención");
    expect(reading.block.type).toBe("reading_text");
    expect(instruction.page).toBe(reading.page);
    expect(instruction.index).toBeLessThan(reading.index);
    // …y la lectura sigue literal, entera, antes de las actividades que la usan.
    expect(allBlocks(c.document).find((b) => b.type === "reading_text")).toMatchObject({ literal: true });
    expect(reading.index).toBeLessThan(activityAt("act_1").index);
    expect(studentText(reading.block).replace(/\s+/g, " ")).toContain(POND.READING.split("\n\n")[2]!);
  });

  it("los componentes de la actividad 2 están junto a su consigna (nada entre ellos y la actividad salvo su propia tabla) y en la misma página", () => {
    const components = at("ctt_3");
    const activity = activityAt("act_2");
    expect(components.page).toBe(activity.page);
    const between = pages[components.page]!.slice(components.index + 1, activity.index);
    expect(between.map((b) => b.type)).toEqual(["table"]);
    expect(refs(between[0]!)).toEqual(["vis_1"]);
    // El ejemplo resuelto es un modelo: va primero, antes de los recursos.
    expect(at("act_2", "worked_example").index).toBeLessThan(components.index);
    expect(count(POND.COMPONENTS)).toBe(1);
    expect((activityAt("act_2").block as Extract<Block, { type: "activity" }>).prompt).toBe("Clasifica estos componentes del estanque.");
    expect((activity.block as Extract<Block, { type: "activity" }>).resource_block_ids).toEqual(expect.arrayContaining([components.block.id, at("vis_1").block.id]));
  });

  it("la afirmación de la actividad 5 se imprime UNA vez, justo antes de su consigna y en su página", () => {
    expect(count(POND.STATEMENT)).toBe(1);
    const statement = at("ctt_5");
    const activity = activityAt("act_7");
    expect(statement.page).toBe(activity.page);
    expect(activity.index - statement.index).toBe(1);
    expect((activity.block as Extract<Block, { type: "activity" }>).prompt).toContain("Valora esta afirmación y justifica tu respuesta");
    expect((activity.block as Extract<Block, { type: "activity" }>).resource_block_ids).toContain(statement.block.id);
  });

  it("la revisión global va DESPUÉS de las actividades; las autocomprobaciones de cada actividad, justo tras ella", () => {
    const last = all.at(-1)!;
    expect(last.block.type).toBe("checklist");
    expect(studentText(last.block)).toContain("Revisión final");
    expect(refs(last.block)).toEqual([]);
    expect(Math.max(...all.filter((x) => x.block.type === "activity").map((x) => x.page * 100 + x.index))).toBeLessThan(last.page * 100 + last.index);
    for (const act of ["act_1", "act_7", "act_8"]) {
      const activity = activityAt(act);
      const next = pages[activity.page]![activity.index + 1]!;
      expect(next.type).toBe("checklist");
      expect(refs(next)).toEqual([act]);
    }
    // El recordatorio general (no es una revisión) sigue al principio, donde el alumno empieza.
    expect(all.find((x) => x.block.type === "help_box" && refs(x.block).length === 0)!.page).toBe(0);
  });

  it("3a/3b y 4a/4b quedan juntas en su página, ninguna página supera el máximo de tareas y se pagina por ejercicios", () => {
    expect(c.context.presentation.max_tasks_per_page).toBe(3);
    const pageOf = (ref: string) => activityAt(ref).page;
    expect(pageOf("act_3")).toBe(pageOf("act_4"));
    expect(pageOf("act_5")).toBe(pageOf("act_6"));
    expect(new Set([pageOf("act_3"), pageOf("act_5"), pageOf("act_7")]).size).toBe(3);
    for (const page of pages) expect(page.filter((b) => b.type === "activity").length).toBeLessThanOrEqual(3);
    // El enlace con sus recursos no se rompe al paginar: la tabla del 4a y su ejemplo están con ella.
    expect(at("vis_3").page).toBe(pageOf("act_5"));
    expect(at("act_5", "worked_example").page).toBe(pageOf("act_5"));
    expect(at("vis_2").page).toBe(pageOf("act_3"));
  });

  it("no se pierde ninguna instrucción, recurso ni dato del original", () => {
    for (const activity of c.analysis.activities) expect(activityAt(activity.id).block).toMatchObject({ label: activity.label, prompt: expect.stringContaining(activity.instruction) });
    for (const text of c.analysis.texts) expect(visibleText.replace(/\s+/g, " ")).toContain(text.kind === "reading_text" ? text.text.split("\n\n")[0]! : text.text);
    const tables = allBlocks(c.document).filter((b): b is Extract<Block, { type: "table" }> => b.type === "table");
    expect(tables.map((t) => t.headers)).toEqual([["SERES VIVOS", "ELEMENTOS NO VIVOS"], ["MAYO", "JUNIO"]]);
    expect(tables[1]!.rows).toEqual([["30 cm de profundidad", "18 cm de profundidad"]]);
    expect(allBlocks(c.document).some((b) => b.type === "image" && b.source.kind === "original" && b.source.visual_ref === "vis_2")).toBe(true);
    expect(allBlocks(c.document).filter((b) => b.type === "activity").map((b) => b.label)).toEqual(["1", "2", "3a", "3b", "4a", "4b", "5", "6"]);
    // El análisis no se toca: sigue duplicando el contexto (la corrección es del ensamblado, no del análisis).
    expect(c.analysis.activities.find((a) => a.id === "act_2")!.context).toBe(POND.COMPONENTS);
  });

  it("la revisión determinista y la auditoría de generación siguen sin ningún fallo", () => {
    const input = { analysis: c.analysis, plan: c.plan, context: c.context, document: c.document, validation: c.reviewed.effectiveValidation };
    const review = assembleReview(input, deterministicChecks(input));
    expect(review.checks.filter((x) => x.status === "FAIL")).toEqual([]);
    const audit = auditGeneration({ analysis: c.analysis, context: c.context, reviewed: c.reviewed, generation: c.generation, document: c.document, review });
    expect(audit.checks.filter((x) => !x.ok)).toEqual([]);
  });
});

describe("estanque · los dos planificadores producen la misma ficha", () => {
  it("mismo orden de bloques y misma paginación con el plan actual (v2) y con V2.2 (v3)", () => {
    const shape = (planner: "v2" | "v3") => pondCase(planner).document.pages.map((p) => p.blocks.map((b) => `${b.type}:${refs(b).join("+")}`));
    expect(shape("v3")).toEqual(shape("v2"));
  });
});

describe("duplicación verificada: solo palabras idénticas, vinculadas a la actividad y en su página", () => {
  const analysis = pondAnalysis();
  const none = { decisions: [] };

  it("detecta las dos copias reales del estanque (act_2 → ctt_3, act_7 → ctt_5)", () => {
    expect([...duplicatedContexts(analysis, none)]).toEqual([["act_2", "ctt_3"], ["act_7", "ctt_5"]]);
  });

  it("no toca un contexto que solo se PARECE a un texto: una palabra distinta, una cifra o un dato extra lo conserva", () => {
    for (const changed of [POND.COMPONENTS.replace("Garzas", "Peces"), `${POND.COMPONENTS} · Rocas`, POND.COMPONENTS.replace("Agua", "Agua 18 cm")]) {
      const copy = structuredClone(analysis);
      copy.activities.find((a) => a.id === "act_2")!.context = changed;
      expect(duplicatedContexts(copy, none).has("act_2")).toBe(false);
    }
  });

  it("no la da por duplicada si el texto no es de la actividad, está en otra página, es una lectura o una decisión lo quita", () => {
    const unlinked = structuredClone(analysis);
    unlinked.activities.find((a) => a.id === "act_2")!.resource_ids = ["vis_1"];
    unlinked.texts.find((t) => t.id === "ctt_3")!.activity_ids = [];
    expect(duplicatedContexts(unlinked, none).has("act_2")).toBe(false);
    const elsewhere = structuredClone(analysis);
    elsewhere.texts.find((t) => t.id === "ctt_5")!.page = 1;
    expect(duplicatedContexts(elsewhere, none).has("act_7")).toBe(false);
    const reading = structuredClone(analysis);
    reading.texts.find((t) => t.id === "ctt_3")!.kind = "reading_text";
    expect(duplicatedContexts(reading, none).has("act_2")).toBe(false);
    const removed = { decisions: [{ id: "dec_1", target: "ctt_5", action: "remove" }] } as never;
    expect(duplicatedContexts(analysis, removed).has("act_7")).toBe(false);
  });

  it("sameText compara palabras, no parecidos", () => {
    expect(sameText("«Hola  mundo».", "hola mundo")).toBe(true);
    expect(sameText("Hola mundo", "Hola mundo 2")).toBe(false);
    expect(sameText("", "")).toBe(false);
  });
});

describe("el título de la sección lidera la sección solo si el análisis lo dice", () => {
  it("una instrucción que no es el título de su sección conserva su orden", () => {
    const copy = pondAnalysis();
    copy.sections[0]!.title = "Texto del estanque";
    const reading = copy.texts.find((t) => t.id === "ctt_1")!;
    const instruction = copy.texts.find((t) => t.id === "ctt_2")!;
    expect(Number(reading.id.split("_")[1])).toBeLessThan(Number(instruction.id.split("_")[1]));
    const c = pondCase("v2");
    expect(c.document.pages[0]!.blocks.findIndex((b) => refs(b).includes("ctt_2"))).toBeLessThan(c.document.pages[0]!.blocks.findIndex((b) => refs(b).includes("ctt_1")));
  });
});

describe("cuotas de paginación por ejercicios (groupedTaskQuotas)", () => {
  it("sin partes de ejercicio es exactamente taskGroups", () => {
    for (const [n, max] of [[7, 3], [6, 3], [4, 3], [8, 3], [3, 3], [5, 2]] as const) expect(groupedTaskQuotas(Array(n).fill(1), max)).toEqual(taskGroups(n, max));
  });

  it("un ejercicio con partes no se corta mientras cabe en una página", () => {
    // 3a/3b · 4a/4b · 5 · 6 con máximo 3: ninguna página parte un ejercicio.
    expect(activityQuotas(["3a", "3b", "4a", "4b", "5", "6"], 3)).toEqual([2, 2, 2]);
    // Si caben juntos se juntan: 1 · 2a/2b · 3 → 2 páginas, no 3 (la primera, la de la cabecera, es la menor).
    expect(activityQuotas(["1", "2a", "2b", "3"], 3)).toEqual([1, 3]);
  });

  it("un grupo mayor que el máximo se corta en trozos de ese máximo (no se fuerza una página más grande)", () => {
    expect(groupedTaskQuotas([5], 3)).toEqual([3, 2]);
    expect(groupedTaskQuotas([1, 4, 1], 2)).toEqual([1, 2, 2, 1]);
  });

  it("sin etiquetas cada actividad es la suya y el resultado no cambia", () => {
    expect(activityQuotas([undefined, undefined, undefined, undefined], 3)).toEqual(taskGroups(4, 3));
  });
});
