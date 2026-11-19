import { describe, expect, it } from "vitest";
import { missingReferences, resolveReferences } from "@/lib/recreation/references";
import { sanitizePlan } from "@/lib/recreation/repair";
import { runMockRecreation } from "../support/recreation-mocks";
import { POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { POND_PILOT_PROFILE } from "../../evals/recreation/pond-plan";
import { pondAnalysis } from "../support/pond-case";

/** Regression of the audit (ADR-053): an instruction never points at a picture, arrows or cards that the student will not have. */
const none = { picture: false, scheme: false, arrows: false, cards: false };
const text = (doc: { pages: Array<{ blocks: Array<{ type: string; prompt?: string; steps?: string[]; text?: string }> }> }) => doc.pages.flatMap((p) => p.blocks).map((b) => `${b.prompt ?? ""} ${(b.steps ?? []).join(" ")} ${b.text ?? ""}`).join(" ");

describe("referencias a recursos que no existen", () => {
  it("detecta imagen, flechas y tarjetas, y solo lo que falta", () => {
    expect(missingReferences("Observa la ilustración y responde.", none)).toEqual(["picture"]);
    expect(missingReferences("Explica qué indican las flechas.", none)).toEqual(["arrows"]);
    expect(missingReferences("Recorta las tarjetas y colócalas en el tablero.", none)).toEqual(["cards"]);
    expect(missingReferences("Observa la ilustración y las flechas.", { ...none, picture: true })).toEqual(["arrows"]);
    expect(missingReferences("Lee el texto y responde.", none)).toEqual([]);
  });

  it("quita solo una frase que únicamente señala; si lo que falta es la tarea, la actividad queda sin resolver", () => {
    expect(resolveReferences({ prompt: "Observa la ilustración. Elige las opciones correctas.", steps: ["Mira el dibujo.", "Marca dos opciones."] }, none)).toMatchObject({ prompt: "Elige las opciones correctas.", steps: ["Marca dos opciones."], unresolved: [] });
    expect(resolveReferences({ prompt: "Explica qué indican las flechas.", steps: [] }, none).unresolved).toEqual(["arrows"]);
    expect(resolveReferences({ prompt: "¿Qué ves en la imagen?", steps: [] }, none).unresolved).toEqual(["picture"]);
    expect(resolveReferences({ prompt: "Observa la ilustración.", steps: [] }, none).unresolved).toEqual(["picture"]);
  });

  it("el saneado vincula a la actividad el esquema que el plan ya declara, sin quitar nada", () => {
    const plan = structuredClone(POND_RECREATION_PLAN);
    const target = plan.activities.find((a) => a.visual_ids.length === 0)!;
    target.prompt = `${target.prompt} Explica tu idea con el esquema.`;
    const context = buildAdaptationContext({ profile: POND_PILOT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis: pondAnalysis(), adaptationType: "methodological" }).context;
    const clean = sanitizePlan(plan, pondAnalysis(), context.needs.map((n) => n.dimension), "methodological");
    const after = clean.activities.find((a) => a.id === target.id)!;
    expect(after.prompt).toBe(target.prompt);
    expect(after.visual_ids).toEqual([plan.visuals[0]!.id]);
  });
});

describe("estanque: la ilustración se rechaza y la ficha no la menciona", () => {
  it("con las imágenes rechazadas, ninguna actividad pide observar lo que no hay y las tarjetas tienen su documento", async () => {
    const plan = structuredClone(POND_RECREATION_PLAN);
    plan.activities[0]!.prompt = "Observa la ilustración del estanque. ¿Cuál de estos componentes es un ser vivo?";
    plan.visual_requests.forEach((r) => (r.essential = false));
    const { outcome } = await runMockRecreation({ imagesAuthorized: true, review: "reject", plans: [plan] });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    expect(outcome.visuals.some((v) => v.route === "none")).toBe(true);
    const sheet = text(outcome.compiled.student);
    expect(sheet).not.toMatch(/ilustraci[oó]n del estanque/i);
    expect(sheet).toMatch(/del documento «Materiales para recortar»/);
    expect(outcome.compiled.unresolved).toEqual([]);
    expect(outcome.compiled.materials).not.toBeNull();
  });

  it("si una actividad solo pedía mirar lo que falta, la ficha queda incompleta y no se entrega", async () => {
    const plan = structuredClone(POND_RECREATION_PLAN);
    plan.activities[0]!.prompt = "Observa la ilustración.";
    plan.activities[0]!.steps = [];
    plan.visual_requests.forEach((r) => (r.essential = false));
    const { outcome } = await runMockRecreation({ imagesAuthorized: true, review: "reject", plans: [plan] });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    expect(outcome.compiled.unresolved).toEqual(["1"]);
  });
});
