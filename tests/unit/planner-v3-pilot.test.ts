import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { resolvePipelineVersions, PipelineVersionsSchema } from "@/lib/adaptation/orchestration/versions";
import { plannerV3Pilot, type PlannerV3PilotConfig } from "@/lib/adaptation/v22/pilot-gate";
import { projectMethod } from "@/lib/adaptation/v22/method-projection";
import type { PlannerDeclarations } from "@/lib/adaptation/plan-v3";
import { initialFormState, methodNotice } from "@/lib/adaptation/presentation/review-form";
import type { AdaptationPlanDto } from "@/lib/adaptation/orchestration/service";
import { frozenRules } from "@/lib/agent-rules/frozen";
import { AnthropicProvider, resetOutputModes, type AnthropicClientLike } from "@/lib/ai/providers/anthropic";
import { createImageProvider, createProvider } from "@/lib/ai/router";
import { COUNT_MARGIN, createSpendMeter, requestCeilingUsd, SpendRefused, type SpendLedger } from "@/lib/ai/spend";
import type { ModelSelection, StructuredRequest } from "@/lib/ai/types";
import { imagePilotAllows } from "@/lib/materials/visuals/illustrate/pilot";
import { ADAPTATION_PLANNER_V3 } from "@prompts/adaptation-planner/v3";

/** ADR-046: the V3 pilot's gate, frozen versions and metered spend, with fake transports (no request leaves the machine). */
const WS = "11111111-1111-4111-8111-111111111111";
const STAGING = "https://abcdefghij.supabase.co/";
const open: PlannerV3PilotConfig = { FLAG_PLANNER_V3_PILOT: true, AI_PLANNER_V3_PILOT_MODE: "staging", AI_PLANNER_V3_PILOT_WORKSPACE_ID: WS, AI_PLANNER_V3_PILOT_SUPABASE_URL: STAGING, AGENT_RULES_SOURCE: "storage", AI_PILOT_BUDGET_USD: 10 };

describe("puerta del piloto V3", () => {
  it("solo se abre con todas las condiciones, y nombra la primera que falta", () => {
    expect(plannerV3Pilot(open, WS, STAGING, "preview")).toEqual({ allowed: true });
    const refused = (config: PlannerV3PilotConfig, ws = WS, url = STAGING, env: string | undefined = "preview") => {
      const r = plannerV3Pilot(config, ws, url, env);
      return r.allowed ? null : r.reason;
    };
    expect(refused({ ...open, FLAG_PLANNER_V3_PILOT: false })).toBe("flag_off");
    expect(refused({ ...open, AI_PLANNER_V3_PILOT_MODE: undefined })).toBe("no_mode");
    expect(refused(open, WS, STAGING, "production")).toBe("production");
    expect(refused(open, "22222222-2222-4222-8222-222222222222")).toBe("workspace");
    expect(refused({ ...open, AI_PLANNER_V3_PILOT_WORKSPACE_ID: undefined })).toBe("workspace");
    expect(refused(open, WS, "https://otroproyecto.supabase.co/")).toBe("backend");
    expect(refused(open, WS, "https://abcdefghij.supabase.co/?x=1")).toBe("backend");
    expect(refused({ ...open, AI_PLANNER_V3_PILOT_MODE: "local", AI_PLANNER_V3_PILOT_SUPABASE_URL: "http://127.0.0.1:54321/" }, WS, "http://127.0.0.1:54321/")).toBeNull();
    expect(refused({ ...open, AI_PLANNER_V3_PILOT_MODE: "local" })).toBe("backend");
    expect(refused({ ...open, AGENT_RULES_SOURCE: undefined })).toBe("no_rules");
    expect(refused({ ...open, AI_PILOT_BUDGET_USD: undefined })).toBe("no_budget");
  });

  it("la comprobación común del backend no cambia el piloto de imágenes", () => {
    const images = { AI_IMAGES_PILOT_MODE: "staging" as const, AI_IMAGES_PILOT_WORKSPACE_ID: WS, AI_IMAGES_PILOT_SUPABASE_URL: STAGING };
    expect(imagePilotAllows(images, WS, STAGING, "preview")).toBe(true);
    expect(imagePilotAllows(images, WS, STAGING, "production")).toBe(false);
    expect(imagePilotAllows({ ...images, AI_IMAGES_PILOT_MODE: "production-pilot" }, WS, STAGING, "production")).toBe(true);
    expect(imagePilotAllows(images, WS, "https://user:pw@abcdefghij.supabase.co/", "preview")).toBe(false);
  });
});

describe("versiones fijadas", () => {
  const rules = { version: "v2.2", package_sha256: "a".repeat(64) };

  it("v3 solo con la huella de sus reglas y su propio tope de salida; sin opción, el planificador actual", () => {
    const v3 = resolvePipelineVersions({}, { plannerV3: rules });
    expect(v3.planner).toMatchObject({ prompt_version: 3, max_output_tokens: 12000 });
    expect(v3.rules).toEqual(rules);
    const current = resolvePipelineVersions({});
    expect(current.planner.prompt_version).toBe(2);
    expect(current.rules).toBeUndefined();
    expect(() => PipelineVersionsSchema.parse({ ...v3, rules: undefined })).toThrow();
    expect(() => PipelineVersionsSchema.parse({ ...current, rules })).toThrow();
  });

  it("unas reglas distintas de las fijadas detienen la etapa", () => {
    const loaded = { version: "v2.2", package_sha256: "a".repeat(64), stable: [] };
    expect(frozenRules(loaded, rules)).toBe(loaded);
    expect(() => frozenRules({ ...loaded, package_sha256: "b".repeat(64) }, rules)).toThrow(/fijadas/);
    expect(() => frozenRules(loaded, undefined)).toThrow(/fijadas/);
  });
});

/** An in-memory ledger with the same accounting as migration 035. */
function memoryLedger(budget: number) {
  const rows: Array<{ id: string; reserved: number; settled: number | null; state: "pending" | "settled" | "kept" }> = [];
  const committed = () => rows.reduce((t, r) => t + (r.state === "settled" ? r.settled! : r.reserved), 0);
  const ledger: SpendLedger = {
    async admit(row) {
      if (committed() + row.reservedUsd > budget) return { id: null, committedUsd: committed() };
      const id = `r${rows.length + 1}`;
      rows.push({ id, reserved: row.reservedUsd, settled: null, state: "pending" });
      return { id, committedUsd: committed() };
    },
    async settle(id, usd) {
      const r = rows.find((x) => x.id === id && x.state === "pending");
      if (!r) return;
      r.state = usd === null ? "kept" : "settled";
      r.settled = usd;
    },
  };
  return { ledger, rows, committed };
}

describe("medidor de gasto", () => {
  it("la cota es el recuento con margen, cobrado como escritura de caché, más toda la salida; sin precio no hay cota", () => {
    const input = Math.ceil(10_000 * COUNT_MARGIN.factor) + COUNT_MARGIN.extraTokens;
    expect(requestCeilingUsd("anthropic", "claude-sonnet-5-5", 10_000, 1_000)).toBeCloseTo((input * 2 * 1.25 + 1_000 * 10) / 1_000_000, 6);
    expect(requestCeilingUsd("anthropic", "modelo-sin-precio", 1, 1)).toBeNull();
  });

  it("recuento fallido, sin precio, presupuesto agotado o libro caído: se rechaza y no se envía nada", async () => {
    const { ledger } = memoryLedger(0.05);
    const refusals: string[] = [];
    const meter = createSpendMeter(ledger, (reason) => refusals.push(reason));
    const ask = (over: Partial<Parameters<typeof meter.admit>[0]> = {}) => meter.admit({ provider: "anthropic", model: "claude-sonnet-5-5", maxOutputTokens: 1_000, count: async () => 1_000, ...over });
    await expect(ask({ count: async () => Promise.reject(new Error("429")) })).rejects.toBeInstanceOf(SpendRefused);
    await expect(ask({ model: "modelo-sin-precio" })).rejects.toBeInstanceOf(SpendRefused);
    await expect(ask({ maxOutputTokens: 10_000 })).rejects.toBeInstanceOf(SpendRefused);
    const broken = createSpendMeter({ admit: async () => Promise.reject(new Error("db")), settle: async () => undefined }, (reason) => refusals.push(reason));
    await expect(broken.admit({ provider: "anthropic", model: "claude-sonnet-5-5", maxOutputTokens: 10, count: async () => 1 })).rejects.toMatchObject({ code: "not_configured", retryable: false });
    expect(refusals).toEqual(["count_failed", "no_price", "budget_exhausted", "ledger_unavailable"]);
  });

  it("lo pendiente y lo retenido cuentan por su cota; lo liquidado, por su coste real", async () => {
    const { ledger, committed } = memoryLedger(1);
    const meter = createSpendMeter(ledger);
    const ask = () => meter.admit({ provider: "anthropic", model: "claude-sonnet-5-5", maxOutputTokens: 4_000, count: async () => 20_000 });
    const a = await ask();
    const b = await ask();
    // Two simultaneous requests both count whole while pending.
    expect(committed()).toBeCloseTo(a.reservedUsd + b.reservedUsd, 6);
    await meter.settle(a, { inputTokens: 20_000, outputTokens: 1_000, cachedInputTokens: 0, cacheCreationInputTokens: 0 });
    await meter.settle(b, null);
    expect(committed()).toBeCloseTo((20_000 * 2 + 1_000 * 10) / 1_000_000 + b.reservedUsd, 6);
    // A failed settlement never turns a delivered answer into an error.
    const failing = createSpendMeter({ admit: ledger.admit, settle: async () => Promise.reject(new Error("db")) });
    await expect(failing.settle(a, null)).resolves.toBeUndefined();
  });
});

describe("proveedor medido", () => {
  const sonnet: ModelSelection = { alias: "STANDARD", provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" };
  const request: StructuredRequest = { selection: sonnet, system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], output: ADAPTATION_PLANNER_V3.output, maxOutputTokens: 100, timeoutMs: 1000 };
  const message = { model: "claude-sonnet-5-5", content: [{ type: "text", text: "{}", citations: null }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as unknown as Anthropic.Message;
  const tooComplex = () => new Anthropic.BadRequestError(400, { error: { message: "Schema is too complex for compilation." } }, "Schema is too complex for compilation.", new Headers());

  it("cada petición se cuenta con sus mismos parámetros y se admite antes de enviarse; rechazada, no se envía", async () => {
    const events: string[] = [];
    let counted: unknown;
    let sent: unknown;
    const client: AnthropicClientLike = {
      messages: {
        stream: (params) => (events.push("stream"), (sent = params), { finalMessage: async () => message }),
        countTokens: async (params) => (events.push("count"), (counted = params), { input_tokens: 900 }),
      },
    };
    const { ledger, rows } = memoryLedger(1);
    await new AnthropicProvider(client, { meter: createSpendMeter(ledger) }).generateStructured(request);
    expect(events).toEqual(["count", "stream"]);
    const { max_tokens: _m, ...rest } = sent as { max_tokens: number };
    void _m;
    expect(counted).toEqual(rest);
    expect(rows.map((r) => r.state)).toEqual(["settled"]);

    events.length = 0;
    const tiny = memoryLedger(0.000001);
    await expect(new AnthropicProvider(client, { meter: createSpendMeter(tiny.ledger) }).generateStructured(request)).rejects.toMatchObject({ code: "not_configured" });
    expect(events).toEqual(["count"]);
  });

  it("el respaldo de salidas estructuradas es otra petición: se admite aparte; un error conserva la reserva entera", async () => {
    resetOutputModes();
    let streams = 0;
    const client: AnthropicClientLike = {
      messages: {
        stream: () => ((streams += 1), { finalMessage: async () => (streams === 1 ? Promise.reject(tooComplex()) : message) }),
        countTokens: async () => ({ input_tokens: 900 }),
      },
    };
    const { ledger, rows } = memoryLedger(1);
    await new AnthropicProvider(client, { meter: createSpendMeter(ledger) }).generateStructured(request);
    expect(rows.map((r) => r.state)).toEqual(["kept", "settled"]);
    resetOutputModes();
  });

  it("con medidor, el SDK no reintenta y las imágenes de pago no se crean", () => {
    const meter = createSpendMeter(memoryLedger(1).ledger);
    expect(createProvider(sonnet, { anthropicApiKey: "test", spendMeter: meter })).toBeInstanceOf(AnthropicProvider);
    const image: ModelSelection = { alias: "IMAGE_QUALITY", provider: "openai", model: "gpt-image-2", effort: "medium" };
    expect(() => createImageProvider(image, { openaiApiKey: "test", spendMeter: meter })).toThrow(/disabled where spend is metered/);
    expect(() => createImageProvider({ ...image, provider: "mock", model: "mock-image" }, { spendMeter: meter })).not.toThrow();
  });
});

describe("lo que ve el docente en la revisión", () => {
  const declarations: PlannerDeclarations = {
    rules: null,
    decisions: { dec_1: { status: "conditional", question: "q_1", hint_yes: [], precedents: [], withheld: true }, dec_2: { status: "active", question: null, hint_yes: ["P7"], precedents: [], withheld: false } },
    teacher_questions: [{ id: "q_1", text: "¿Se evalúa la escritura?", decision_ids: ["dec_1"] }],
    residual_barriers: [{ activity: "act_2", dimensions: ["fine_motor_demand"], note: null }],
    issues: [{ decision_id: "dec_1", code: "conditional", message: "x" }],
  };

  it("una decisión retenida empieza sin marcar, con su motivo y su pregunta; las demás, como siempre", () => {
    const method = projectMethod(declarations)!;
    expect(method.decisions.dec_1).toEqual({ withheld: true, conditional: true, question: "¿Se evalúa la escritura?", reasons: ["Depende de tu respuesta a una pregunta."] });
    expect(method.plan.barriers).toEqual([{ target: "act_2", needs: ["fine_motor_demand"], note: null }]);
    const decision = (id: string) => ({ id, target: "act_1", action: "add_support", intensity: "light", strategies: [], needs: [], supports: [], note: null, preserves: [], restrictions: [], status: "valid" as const, issues: [], method: method.decisions[id] });
    const plan = { planFingerprint: "f".repeat(64), decisions: [decision("dec_1"), decision("dec_2")], summary: [], counts: { valid: 2, review: 0, blocked: 0 }, review: { submitted: false, executable: null, blockers: [] }, method: method.plan } satisfies AdaptationPlanDto;
    expect(initialFormState(plan)).toMatchObject({ dec_1: { choice: "reject" }, dec_2: { choice: "approve" } });
    expect(methodNotice(plan.decisions[0]!)).toMatch(/Espera tu decisión.*Pregunta: ¿Se evalúa la escritura\?/);
    expect(methodNotice(plan.decisions[1]!)).toBeUndefined();
    expect(projectMethod(null)).toBeNull();
  });
});

describe("informe de costes por adaptación", () => {
  const row = (over: Partial<import("@/lib/ai/cost-report").CostRow>): import("@/lib/ai/cost-report").CostRow => ({
    created_at: "2026-11-10T10:00:00Z", workspace_id: WS, material_id: "m1", material_title: "Ficha", adaptation_id: "a1", learner_profile_id: "p1", planner_version: 3, rules_package: "a".repeat(64), phase: "planning", purpose: "plan", call_kind: "initial", attempt: 1, job_attempt: 1, status: "success", error_code: null, provider: "anthropic", model: "claude-sonnet-5-5", model_alias: "STANDARD", prompt_key: "adaptation_planner", prompt_version: 3, effort: "medium", input_tokens: 50_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 3_000, reasoning_tokens: null, estimated_cost_usd: "0.13", latency_ms: 1000, rules_sha256: "a".repeat(64), ...over,
  });

  it("separa el análisis por material, suma cada fase de la adaptación y marca el total incompleto si falta un precio", async () => {
    const { summarizeCost, costRowsCsv } = await import("@/lib/ai/cost-report");
    const rows = [
      row({ phase: "analysis", purpose: "analyze", adaptation_id: null, estimated_cost_usd: "0.05" }),
      row({}),
      row({ call_kind: "repair", estimated_cost_usd: "0.12" }),
      row({ phase: "generation", purpose: "generate", estimated_cost_usd: "0.04" }),
      row({ phase: "review", purpose: "review", estimated_cost_usd: null, status: "invalid_output" }),
    ];
    const report = summarizeCost(rows);
    expect(report.materials[0]!.analysis.usd).toBeCloseTo(0.05, 6);
    const a = report.adaptations[0]!;
    expect(a).toMatchObject({ plannerVersion: 3, incomplete: true });
    expect(a.phases.planning).toMatchObject({ calls: 2, repairs: 1, usd: 0.25, models: ["anthropic:claude-sonnet-5-5"] });
    expect(a.phases.review).toMatchObject({ calls: 1, failed: 1, unknownCost: 1 });
    expect(a.usd).toBeCloseTo(0.29, 6);
    expect(report.usd).toBeCloseTo(0.34, 6);
    const csv = costRowsCsv([row({ material_title: "=HYPERLINK(\"x\")" })]);
    expect(csv.split("\n")[1]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
