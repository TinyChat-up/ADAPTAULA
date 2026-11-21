import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRecreation, regenerateRecreation, restoreVersion, type GenerationDeps } from "@/lib/recreation/create";
import { MemoryRecreationStore, RecreationVersionSchema } from "@/lib/recreation/record";
import { loadRecreationView } from "@/lib/recreation/view";
import { demo } from "@/app/demo/recreacion/data";
import { sheetModel } from "@/lib/render/sheet-model";
import { POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { mockStack } from "../support/recreation-mocks";

/**
 * The platform mode (ADR-051, ADR-052): generate once and store (the answers apart, server-only), then open — the current version
 * or an older one — without any model call; regenerate or restore only when asked. Simulated Claude and OpenAI; 0 paid calls.
 */
const WS = "11111111-1111-4111-8111-111111111111";
const MATERIAL = "44444444-4444-4444-8444-444444444444";

function setup(over: Partial<GenerationDeps> = {}, options: Parameters<typeof mockStack>[0] = { imagesAuthorized: true }) {
  const stack = mockStack(options);
  const store = new MemoryRecreationStore();
  let n = 0;
  const reserved: string[] = [];
  const refunded: string[] = [];
  const deps: GenerationDeps = {
    store,
    planner: stack.planner,
    canWrite: async () => true,
    quota: { reserve: async (key) => (reserved.push(key), "reserved"), refund: async (key) => void refunded.push(key) },
    budgetAllows: async () => true,
    newId: () => `55555555-5555-4555-8555-${String(++n).padStart(12, "0")}`,
    now: () => "2026-11-18T10:00:00Z",
    runs: stack.runs,
    ...over,
  };
  const request = { ...stack.request, workspaceId: WS, materialId: MATERIAL };
  const totalCalls = () => Object.values(stack.calls).reduce((a, b) => a + b, 0);
  return { stack, store, deps, request, totalCalls, reserved, refunded };
}
const created = async (s: ReturnType<typeof setup>, key = "peticion-0001") => {
  const r = await createRecreation(s.deps, { ...s.request, idempotencyKey: key });
  if (r.status !== "created") throw new Error(r.status);
  return r;
};

describe("las respuestas no están en lo que se muestra ni en lo que se guarda para mostrar", () => {
  it("la versión guardada no lleva clave; la parte interna (solo servidor) sí", async () => {
    const s = setup();
    const r = await created(s);
    expect(r.version.student.answer_key).toEqual([]);
    expect(r.version.materials?.answer_key ?? []).toEqual([]);
    const internal = await s.store.getInternal(r.version.id);
    expect(internal!.answer_key.student.length).toBe(7);
    expect(JSON.stringify(internal)).toContain("30 − 18 = 12");
    expect(JSON.stringify(r.version)).not.toMatch(/30 − 18|Criterios|anchored|verified|recreation_verify/);
  });

  it("el esquema de la versión visible rechaza un documento con respuestas", async () => {
    const s = setup();
    const r = await created(s);
    expect(RecreationVersionSchema.safeParse({ ...r.version, student: { ...r.version.student, answer_key: [{ block_id: "blk_r0005", basis: "new_item", value: "x" }] } }).success).toBe(false);
  });

  it("la vista solo recibe un lector: no tiene forma de leer la parte interna", async () => {
    const s = setup();
    const r = await created(s);
    const reader = { getLine: s.store.getLine.bind(s.store), getVersion: s.store.getVersion.bind(s.store), listVersions: s.store.listVersions.bind(s.store) };
    const view = (await loadRecreationView(reader, r.line.id))!;
    expect(Object.keys(view).sort()).toEqual(["assets", "createdAt", "currentVersion", "explanation", "id", "materials", "state", "student", "title", "version", "versions"]);
    expect(JSON.stringify(view)).not.toMatch(/30 − 18|Criterios|answer_key":\[\{|"plan":|"verification":|"internal"/);
  });
});

describe("estado del material: lista, revisión o incompleta, sin dar respuestas", () => {
  it("con respuestas apoyadas en el texto pero no demostradas, pide revisión de esas actividades, sin decir cuáles son las respuestas", async () => {
    const s = setup();
    const r = await created(s);
    expect(r.version.state).toBe("review");
    expect(r.version.review_activities).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(r.version.state_message).toContain("Contrasta las respuestas propuestas con la fuente citada.");
    expect(r.version.state_message).not.toMatch(/Ser vivo|alimentan|algas/i);
  });
});

describe("generar una vez, consultar sin IA", () => {
  it("abrir, recargar o cambiar de sección cien veces no llama a ningún modelo", async () => {
    const s = setup();
    const r = await created(s);
    const after = s.totalCalls();
    for (let i = 0; i < 100; i++) expect(await loadRecreationView(s.store, r.line.id)).not.toBeNull();
    expect(s.totalCalls()).toBe(after);
  });

  it("el módulo de la vista no puede llamar a una IA: no importa proveedores, planificador, pipeline de imágenes ni creación", () => {
    for (const file of ["src/lib/recreation/view.ts", "src/lib/recreation/record.ts"]) {
      const runtime = readFileSync(file, "utf8").split("\n").filter((l) => /^import\s/.test(l) && !/^import\s+type\s/.test(l));
      expect(runtime.join("\n")).not.toMatch(/lib\/ai|planner|pilot|visuals|illustrate|create/);
    }
  });

  it("imprimir desde lo guardado: los modelos de impresión salen del registro, sin llamadas", async () => {
    const s = setup();
    const r = await created(s);
    const before = s.totalCalls();
    const view = (await loadRecreationView(s.store, r.line.id))!;
    expect(sheetModel({ document: view.materials!, subjectName: null, deferred: [] }, "student").validation.status).toBe("renderable");
    expect(s.totalCalls()).toBe(before);
  });
});

describe("idempotencia, cupo y presupuesto antes de cualquier llamada", () => {
  it("la misma petición dos veces (doble clic, reintento) no genera dos veces ni reserva dos unidades", async () => {
    const s = setup();
    const first = await created(s, "peticion-repetida");
    const calls = s.totalCalls();
    const second = await created(s, "peticion-repetida");
    expect(second.reused).toBe(true);
    expect(second.line.id).toBe(first.line.id);
    expect(s.totalCalls()).toBe(calls);
    expect(s.reserved).toHaveLength(1);
  });

  it("sin permiso, sin cupo o sin presupuesto: 0 llamadas y el motivo; un plan inválido devuelve la unidad", async () => {
    for (const [over, status] of [[{ canWrite: async () => false }, "forbidden"], [{ quota: { reserve: async () => "quota" as const, refund: async () => undefined } }, "quota"], [{ budgetAllows: async () => false }, "budget"]] as const) {
      const s = setup(over as Partial<GenerationDeps>);
      expect(await createRecreation(s.deps, { ...s.request, idempotencyKey: "peticion-0002" })).toMatchObject({ status });
      expect(s.totalCalls()).toBe(0);
    }
    const bad = structuredClone(POND_RECREATION_PLAN);
    bad.activities[4]!.steps = ["Debe darte 12."];
    const s = setup({}, { plans: [bad, bad] });
    expect(await createRecreation(s.deps, { ...s.request, idempotencyKey: "peticion-0003" })).toMatchObject({ status: "failed", message: expect.stringContaining("No se ha guardado nada") });
    expect(s.refunded).toEqual(s.reserved);
  });
});

describe("versiones: regenerar crea otra, recuperar una anterior no llama a nada", () => {
  it("abrir la versión histórica publicada muestra sus documentos y su revisión guardada", async () => {
    const view = await loadRecreationView({
      getLine: async () => demo.line, getVersion: async () => demo.version, listVersions: async () => [demo.version],
    }, demo.line.id, 1);
    expect(view?.state).toEqual({ kind: "review", message: demo.version.state_message, activities: ["1", "3"] });
    expect(view?.student).toEqual(demo.version.student);
    expect(view?.materials).toEqual(demo.version.materials);
  });

  it("regenerar pide confirmación; confirmado crea la versión 2 y la 1 sigue intacta", async () => {
    const s = setup();
    const r = await created(s);
    const before = s.totalCalls();
    expect(await regenerateRecreation(s.deps, { lineId: r.line.id, confirmed: false, request: s.request })).toMatchObject({ status: "confirm" });
    expect(s.totalCalls()).toBe(before);
    expect(await regenerateRecreation(s.deps, { lineId: r.line.id, confirmed: true, request: s.request })).toMatchObject({ status: "created", version: { version: 2 } });
    expect((await s.store.listVersions(r.line.id)).map((v) => v.version)).toEqual([1, 2]);
    expect((await s.store.getVersion(r.line.id, 1))!.id).toBe(r.version.id);
  });

  it("una regeneración con las mismas peticiones visuales reutiliza las ilustraciones aprobadas; ninguna se sobrescribe", async () => {
    const s = setup();
    const r = await created(s);
    const images = s.stack.calls.image ?? 0;
    const again = await regenerateRecreation(s.deps, { lineId: r.line.id, confirmed: true, request: s.request });
    expect(s.stack.calls.image ?? 0).toBe(images);
    if (again.status !== "created") throw new Error(again.status);
    expect(again.version.assets.map((a) => a.asset_id).sort()).toEqual(r.version.assets.map((a) => a.asset_id).sort());
    expect((await s.store.getVersion(r.line.id, 1))!.assets).toEqual(r.version.assets);
  });

  it("abrir una versión anterior y recuperarla: sin llamadas, solo cambia la versión actual", async () => {
    const s = setup();
    const r = await created(s);
    await regenerateRecreation(s.deps, { lineId: r.line.id, confirmed: true, request: s.request });
    const before = s.totalCalls();
    const old = (await loadRecreationView(s.store, r.line.id, 1))!;
    expect(old).toMatchObject({ version: 1, currentVersion: 2 });
    expect(old.versions.map((v) => [v.version, v.current])).toEqual([[2, true], [1, false]]);
    expect(await restoreVersion({ store: s.store, canWrite: async () => false }, { lineId: r.line.id, version: 1, workspaceId: WS })).toEqual({ status: "forbidden" });
    expect(await restoreVersion(s.deps, { lineId: r.line.id, version: 1, workspaceId: "99999999-9999-4999-8999-999999999999" })).toEqual({ status: "not_found" });
    expect(await restoreVersion(s.deps, { lineId: r.line.id, version: 1, workspaceId: WS })).toEqual({ status: "restored" });
    expect((await loadRecreationView(s.store, r.line.id))!.version).toBe(1);
    expect(s.totalCalls()).toBe(before);
  });
});
