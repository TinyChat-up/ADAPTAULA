import { describe, expect, it } from "vitest";
import { allBlocks } from "@/lib/schemas/material-document";
import { buildRenderModel } from "@/lib/render/model";
import { versionOf } from "@/lib/recreation/record";
import { RECREATION_PLANNER_LIMITS, worstCallUsd } from "@/lib/recreation/planner";
import { resolvePipelineVersions } from "@/lib/adaptation/orchestration/versions";
import { resolveModel } from "@/lib/ai/registry";
import { POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { runMockRecreation } from "../support/recreation-mocks";

/**
 * Fase 5 · the whole route without spending: simulated Claude (MockProvider with fixtures) → plan → verification → visual request →
 * simulated OpenAI (MockImageProvider) through the product's illustration pipeline → review → MaterialDocuments. 0 paid calls.
 */
const ready = async (options: Parameters<typeof runMockRecreation>[0] = {}) => {
  const r = await runMockRecreation(options);
  if (r.outcome.status !== "ready") throw new Error(JSON.stringify(r.outcome).slice(0, 2000));
  return { ...r, outcome: r.outcome };
};

describe("recorrido completo simulado", () => {
  it("el nuevo techo de respuesta para el plan queda congelado en cada adaptación nueva", () => {
    const versions = resolvePipelineVersions({}, { recreation: true });
    expect(versions.recreation?.planner.max_output_tokens).toBe(RECREATION_PLANNER_LIMITS.maxOutputTokens);
    expect(RECREATION_PLANNER_LIMITS.maxOutputTokens).toBeGreaterThan(8_000);
  });
  it("imágenes autorizadas: plan del «Claude» simulado, ilustración del «OpenAI» simulado revisada; la de contexto abre la ficha, antes de la lectura", async () => {
    const { outcome, runs, assets, calls } = await ready({ imagesAuthorized: true });
    // One context illustration + one per card (6): 7 briefs, 7 images, 7 reviews; one plan.
    expect(calls).toMatchObject({ recreation_plan: 1, illustration_brief: 7, image: 7, illustration_review: 7 });
    const visual = outcome.visuals[0]!;
    expect(visual).toMatchObject({ request_id: "vr_1", route: "C_generated" });
    expect(assets.size).toBe(7);
    expect(outcome.visuals[1]!.cards!.map((c) => c.text)).toEqual(["Algas", "Agua", "Larvas de insectos", "Luz solar", "Garzas", "Temperatura"]);
    expect(outcome.visuals[1]!.cards!.every((c) => c.asset)).toBe(true);
    const blocks = allBlocks(outcome.compiled.student);
    const image = blocks.findIndex((b) => b.type === "image" && b.source.kind === "generated");
    const reading = blocks.findIndex((b) => b.type === "reading_text");
    expect(image).toBeGreaterThan(-1);
    expect(image).toBeLessThan(reading);
    // Every model call is recorded as ai_runs would get it: purpose, prompt and version, model, cost; never the content.
    expect(runs.map((r) => `${r.purpose}:${r.promptKey}@v${r.promptVersion}`).slice(0, 4)).toEqual(["plan:recreation_planner@v1", "image_brief:image_brief@v1", "image:image_render@v1", "image_review:image_review@v1"]);
    expect(runs).toHaveLength(1 + 7 * 3);
    expect(JSON.stringify(runs)).not.toMatch(/estanque|larvas|Algas/);
    expect(runs.every((r) => r.estimatedCostUsd === 0)).toBe(true);
  });

  it("la procedencia dice quién produjo y quién comprobó cada recurso", async () => {
    const { outcome } = await ready({ imagesAuthorized: true });
    const by = new Map(outcome.provenance.map((p) => [p.resource, p]));
    expect(by.get("Actividad 5")).toMatchObject({ produced_by: expect.stringContaining("recreation_planner v1"), status: "solución comprobada" });
    expect(by.get("Actividad 1")!.status).toBe("apoyada en el texto, sin comprobar");
    expect(by.get("Imagen vr_1")).toMatchObject({ produced_by: expect.stringContaining("MockImageProvider"), checked_by: expect.stringContaining("image_review"), status: "C_generated" });
    expect(by.get("Esquema «Esquema del estanque»")!.produced_by).toContain("renderer");
    expect(by.get("Explicación para el docente")!.checked_by).toContain("sin soluciones ni diagnósticos");
  });

  it("imágenes NO autorizadas: se informa de la causa, no se llama a ningún modelo de imagen y la ficha sigue completa (la imagen no era imprescindible)", async () => {
    const { outcome, calls } = await ready({ imagesAuthorized: false });
    expect(calls.image ?? 0).toBe(0);
    expect(calls.illustration_brief ?? 0).toBe(0);
    expect(outcome.visuals[0]).toMatchObject({ route: "none", essential: false, source: null });
    expect(outcome.visuals[0]!.attempts.join(" ")).toContain("generación no disponible (disabled)");
    expect(outcome.provenance.find((p) => p.resource === "Imagen vr_1")!.status).toBe("no incluida");
  });

  it("una imagen IMPRESCINDIBLE que no se puede producir se imprime como hueco visible y la guía lo dice; nunca se oculta", async () => {
    const plan = structuredClone(POND_RECREATION_PLAN);
    plan.visual_requests[0]!.essential = true;
    const { outcome } = await ready({ imagesAuthorized: false, plans: [plan] });
    expect(outcome.visuals[0]).toMatchObject({ route: "none", essential: true, source: { kind: "missing" } });
    expect(allBlocks(outcome.compiled.student).some((b) => b.type === "image" && b.source.kind === "requested" && b.source.essential === true)).toBe(true);
    // The teacher is told in words, with the activity: the record is «incomplete», never shown as ready.
    const stored = versionOf(outcome, { id: "33333333-3333-4333-8333-333333333333", lineId: "77777777-7777-4777-8777-777777777777", version: 1, workspaceId: "11111111-1111-4111-8111-111111111111", now: "2026-11-18T10:00:00Z" }, [], { contract: "c", verifier: "v", visuals: "x", planner: "p" })!;
    expect(stored.version).toMatchObject({ state: "incomplete", state_message: expect.stringMatching(/Falta una imagen necesaria para la actividad 1/) });
    // The renderer does not print a stand-in on the student's sheet; its validation says the sheet is incomplete.
    const { validation } = buildRenderModel(outcome.compiled.student, { mode: "student", deferred: [] });
    expect(validation.status).not.toBe("renderable");
    expect(validation.issues.map((i) => i.code).join(" ")).toMatch(/visual|missing|pending/);
  });

  it("una ilustración que la revisión rechaza no llega a la ficha: se cuenta, se intenta una vez más y se informa", async () => {
    const { outcome, calls, assets } = await ready({ imagesAuthorized: true, review: "reject" });
    expect(calls.image).toBe(14); // two attempts per picture, none approved
    expect(assets.size).toBe(0);
    expect(outcome.visuals[0]).toMatchObject({ route: "none" });
    expect(outcome.visuals[0]!.attempts.join(" ")).toContain("review_rejected");
  });

  it("un brief con rótulos o marcadores se rechaza: el texto lo pone el renderer, no el modelo de imagen", async () => {
    const { MOCK_BRIEF } = await import("../support/recreation-mocks");
    const brief = { ...MOCK_BRIEF, required_elements: [{ name: "una garza", marker: null, label: "Garza" }] };
    const { outcome, calls } = await ready({ imagesAuthorized: true, brief });
    expect(calls.image ?? 0).toBe(0);
    expect(outcome.visuals[0]!.attempts.join(" ")).toContain("brief_rejected");
  });

  it("un plan rechazado se repara UNA vez con los motivos; si vuelve a fallar no se entrega", async () => {
    const bad = structuredClone(POND_RECREATION_PLAN);
    bad.activities[6]!.steps = ["Debe darte 12."];
    const repaired = await ready({ plans: [bad, POND_RECREATION_PLAN] });
    expect(repaired.outcome.calls).toBe(2);
    const twice = await runMockRecreation({ plans: [bad, bad] });
    expect(twice.outcome).toMatchObject({ status: "rejected", calls: 2 });
    expect(twice.calls.recreation_plan).toBe(2);
  });

  it("límite de gasto: sin presupuesto para el peor caso no se llama al planificador", async () => {
    const sonnet = resolveModel("STANDARD", { AI_MODEL_STANDARD: "anthropic:claude-sonnet-5-5" });
    expect(worstCallUsd(sonnet, 60_000)).toBeGreaterThan(0.09);
    const { outcome, calls } = await runMockRecreation({ budgetUsd: -1 });
    expect(outcome.status).toBe("budget_exhausted");
    expect(calls.recreation_plan ?? 0).toBe(0);
  });
});
