import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRecreation, regenerateRecreation, type GenerationDeps } from "@/lib/recreation/create";
import { MemoryRecreationStore } from "@/lib/recreation/record";
import { loadRecreationView } from "@/lib/recreation/view";
import { buildRenderModel } from "@/lib/render/model";
import { POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { mockStack } from "../support/recreation-mocks";

/**
 * The platform mode (ADR-051): generate once, store, then open as many times as wanted without any model call; regenerate only when
 * asked, after permissions, allowance and budget, as a new version. Simulated Claude and OpenAI; 0 paid calls.
 */
const WS = "11111111-1111-4111-8111-111111111111";
const MATERIAL = "44444444-4444-4444-8444-444444444444";

function setup(over: Partial<GenerationDeps> = {}, options: Parameters<typeof mockStack>[0] = { imagesAuthorized: true }) {
  const stack = mockStack(options);
  const store = new MemoryRecreationStore();
  let n = 0;
  const deps: GenerationDeps = {
    store,
    planner: stack.planner,
    canWrite: async () => true,
    entitlement: async () => ({ allowed: true }),
    budgetAllows: async () => true,
    newId: () => `55555555-5555-4555-8555-${String(++n).padStart(12, "0")}`,
    now: () => "2026-11-18T10:00:00Z",
    runs: stack.runs,
    ...over,
  };
  const request = { ...stack.request, workspaceId: WS, materialId: MATERIAL };
  const totalCalls = () => Object.values(stack.calls).reduce((a, b) => a + b, 0);
  return { stack, store, deps, request, totalCalls };
}

describe("generar una vez, consultar sin IA", () => {
  it("abrir, recargar o cambiar de pestaña cien veces no llama a ningún modelo", async () => {
    const { store, deps, request, totalCalls } = setup();
    const created = await createRecreation(deps, request);
    expect(created.status).toBe("created");
    const after = totalCalls();
    expect(after).toBe(4); // plan, brief, image, review: once
    const id = created.status === "created" ? created.record.id : "";
    for (let i = 0; i < 100; i++) expect(await loadRecreationView(store, id)).not.toBeNull();
    expect(totalCalls()).toBe(after);
    expect(store.reads).toBe(100);
  });

  it("el módulo de la vista no puede llamar a una IA: no importa proveedores, planificador ni pipeline de imágenes", () => {
    for (const file of ["src/lib/recreation/view.ts", "src/lib/recreation/record.ts"]) {
      const runtime = readFileSync(file, "utf8").split("\n").filter((l) => /^import\s/.test(l) && !/^import\s+type\s/.test(l));
      expect(runtime.join("\n")).not.toMatch(/lib\/ai|planner|pilot|visuals|illustrate|create/);
    }
  });

  it("la vista no lleva soluciones ni datos internos: sin clave, sin plan, sin verificación, sin procedencia", async () => {
    const { store, deps, request } = setup();
    const created = await createRecreation(deps, request);
    const view = (await loadRecreationView(store, created.status === "created" ? created.record.id : ""))!;
    expect(Object.keys(view).sort()).toEqual(["assets", "createdAt", "explanation", "id", "materials", "state", "student", "title", "version"]);
    expect(view.student.answer_key).toEqual([]);
    const dump = JSON.stringify(view);
    expect(dump).not.toMatch(/30 − 18|Criterios|verified|anchored|teacher_review|SIN COMPROBAR|recreation_verify/);
    expect(dump).not.toContain("Que las larvas de insectos se alimentan de algas\",\"correct");
    // The record keeps the answer key for the server's checks.
    expect(store.history(view.id)[0]!.student.answer_key.length).toBe(7);
  });

  it("la explicación se guarda con la adaptación y se muestra tal cual: qué, por qué y cómo, sin respuestas", async () => {
    const { store, deps, request } = setup();
    const created = await createRecreation(deps, request);
    const view = (await loadRecreationView(store, created.status === "created" ? created.record.id : ""))!;
    expect(view.explanation.adapted.length).toBeGreaterThanOrEqual(2);
    expect(view.explanation.why.length).toBeGreaterThanOrEqual(1);
    expect(view.explanation.how_to_use.length).toBeGreaterThanOrEqual(3);
    expect(view.explanation.observe.map((o) => o.activity)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(JSON.stringify(view.explanation)).not.toMatch(/\b12\b|dislexia|TDAH|diagnóstico/i);
  });

  it("la ficha y los materiales se pueden imprimir desde lo guardado: el modelo de impresión sale del registro, sin llamadas", async () => {
    const { store, deps, request, totalCalls } = setup();
    const created = await createRecreation(deps, request);
    const before = totalCalls();
    const view = (await loadRecreationView(store, created.status === "created" ? created.record.id : ""))!;
    expect(buildRenderModel(view.materials!, { mode: "student", deferred: [] }).validation.status).toBe("renderable");
    expect(view.assets).toHaveLength(1);
    expect(totalCalls()).toBe(before);
  });
});

describe("regenerar es una acción aparte, explícita y controlada", () => {
  it("sin confirmar: avisa de que se creará una versión nueva y no llama a nada", async () => {
    const { deps, request, totalCalls } = setup();
    const created = await createRecreation(deps, request);
    const before = totalCalls();
    const id = created.status === "created" ? created.record.id : "";
    const asked = await regenerateRecreation(deps, { id, confirmed: false, request });
    expect(asked).toMatchObject({ status: "confirm", message: expect.stringContaining("versión nueva") });
    expect(totalCalls()).toBe(before);
  });

  it("confirmado: versión 2; la versión 1 se conserva", async () => {
    const { store, deps, request } = setup();
    const created = await createRecreation(deps, request);
    const id = created.status === "created" ? created.record.id : "";
    const again = await regenerateRecreation(deps, { id, confirmed: true, request });
    expect(again).toMatchObject({ status: "created", record: { id, version: 2 } });
    expect(store.history(id).map((r) => r.version)).toEqual([1, 2]);
    expect((await loadRecreationView(store, id))!.version).toBe(2);
  });

  it("sin permiso, sin cupo o sin presupuesto: no se llama a ningún modelo y se dice por qué", async () => {
    for (const [over, status] of [[{ canWrite: async () => false }, "forbidden"], [{ entitlement: async () => ({ allowed: false as const, reason: "quota" as const }) }, "quota"], [{ budgetAllows: async () => false }, "budget"]] as const) {
      const { deps, request, totalCalls, store } = setup(over as Partial<GenerationDeps>);
      expect(await createRecreation(deps, request)).toMatchObject({ status });
      expect(totalCalls()).toBe(0);
      expect(store.reads).toBe(0);
    }
  });

  it("un plan que no supera las comprobaciones no se guarda ni se muestra como correcto", async () => {
    const bad = structuredClone(POND_RECREATION_PLAN);
    bad.activities[4]!.steps = ["Debe darte 12."];
    const { deps, request, store } = setup({}, { plans: [bad, bad] });
    const result = await createRecreation(deps, request);
    expect(result).toMatchObject({ status: "failed", outcome: "rejected", message: expect.stringContaining("No se ha guardado nada") });
    expect(store.reads).toBe(0);
  });
});
