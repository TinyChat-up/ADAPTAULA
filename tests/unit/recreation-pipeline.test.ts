import { describe, expect, it } from "vitest";
import { allBlocks } from "@/lib/schemas/material-document";
import { buildRenderModel } from "@/lib/render/model";
import { worstCallUsd } from "@/lib/recreation/planner";
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
  it("imágenes autorizadas: plan del «Claude» simulado, ilustración del «OpenAI» simulado revisada y colocada antes de su actividad", async () => {
    const { outcome, runs, assets, calls } = await ready({ imagesAuthorized: true });
    expect(calls).toMatchObject({ recreation_plan: 1, illustration_brief: 1, image: 1, illustration_review: 1 });
    const visual = outcome.visuals[0]!;
    expect(visual).toMatchObject({ request_id: "vr_1", route: "C_generated" });
    expect(assets.size).toBe(1);
    const blocks = allBlocks(outcome.compiled.student);
    const image = blocks.findIndex((b) => b.type === "image" && b.source.kind === "generated");
    const first = blocks.findIndex((b) => b.type === "activity");
    expect(image).toBeGreaterThan(-1);
    expect(image).toBe(first - 1);
    // Every model call is recorded as ai_runs would get it: purpose, prompt and version, model, cost; never the content.
    expect(runs.map((r) => `${r.purpose}:${r.promptKey}@v${r.promptVersion}`)).toEqual(["plan:recreation_planner@v1", "image_brief:image_brief@v1", "image:image_render@v1", "image_review:image_review@v1"]);
    expect(JSON.stringify(runs)).not.toMatch(/estanque|larvas|Algas/);
    expect(runs.every((r) => r.estimatedCostUsd === 0)).toBe(true);
  });

  it("la procedencia dice quién produjo y quién comprobó cada recurso", async () => {
    const { outcome } = await ready({ imagesAuthorized: true });
    const by = new Map(outcome.provenance.map((p) => [p.resource, p]));
    expect(by.get("Actividad 7")).toMatchObject({ produced_by: expect.stringContaining("recreation_planner v1"), status: "solución comprobada" });
    expect(by.get("Actividad 1")!.status).toBe("apoyada en el texto, sin comprobar");
    expect(by.get("Imagen vr_1")).toMatchObject({ produced_by: expect.stringContaining("MockImageProvider"), checked_by: expect.stringContaining("image_review"), status: "C_generated" });
    expect(by.get("Esquema «Esquema del estanque»")!.produced_by).toContain("renderer");
    expect(JSON.stringify(outcome.compiled.key)).toContain("Procedencia");
  });

  it("imágenes NO autorizadas: se informa de la causa, no se llama a ningún modelo de imagen y la ficha sigue completa (la imagen no era imprescindible)", async () => {
    const { outcome, calls } = await ready({ imagesAuthorized: false });
    expect(calls.image ?? 0).toBe(0);
    expect(calls.illustration_brief ?? 0).toBe(0);
    expect(outcome.visuals[0]).toMatchObject({ route: "none", essential: false, source: null });
    expect(outcome.visuals[0]!.attempts.join(" ")).toContain("generación no disponible (disabled)");
    expect(JSON.stringify(outcome.compiled.key)).toContain("no incluida");
  });

  it("una imagen IMPRESCINDIBLE que no se puede producir se imprime como hueco visible y la guía lo dice; nunca se oculta", async () => {
    const plan = structuredClone(POND_RECREATION_PLAN);
    plan.visual_requests[0]!.essential = true;
    const { outcome } = await ready({ imagesAuthorized: false, plans: [plan] });
    expect(outcome.visuals[0]).toMatchObject({ route: "none", essential: true, source: { kind: "missing" } });
    expect(allBlocks(outcome.compiled.student).some((b) => b.type === "image" && b.source.kind === "requested" && b.source.essential === true)).toBe(true);
    expect(JSON.stringify(outcome.compiled.guide)).toMatch(/FALTA 1 imagen imprescindible/);
    // The renderer does not print a stand-in on the student's sheet; its validation says the sheet is incomplete.
    const { validation } = buildRenderModel(outcome.compiled.student, { mode: "student", deferred: [] });
    expect(validation.status).not.toBe("renderable");
    expect(validation.issues.map((i) => i.code).join(" ")).toMatch(/visual|missing|pending/);
  });

  it("una ilustración que la revisión rechaza no llega a la ficha: se cuenta, se intenta una vez más y se informa", async () => {
    const { outcome, calls, assets } = await ready({ imagesAuthorized: true, review: "reject" });
    expect(calls.image).toBe(2);
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
