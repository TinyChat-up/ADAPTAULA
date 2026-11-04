import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AgentRules } from "@/lib/agent-rules/types";
import { AnthropicProvider, resetOutputModes, type AnthropicClientLike } from "@/lib/ai/providers/anthropic";
import { mockAnalysisDraftV3 } from "@/lib/ai/providers/mock-analysis-v3";
import { getMaterialAnalyzer } from "@/lib/ai/prompts";
import type { ModelSelection, StructuredRequest } from "@/lib/ai/types";
import { ADAPTATION_PLANNER_V3 } from "@prompts/adaptation-planner/v3";
import { BUDGET_SAFETY, COUNT_MARGIN, PilotBudget, callCeilingUsd } from "../../evals/adaptation/pilot-lib";
import { runPilotCalls } from "../../evals/adaptation/pilot-run";

/**
 * The V2.2 pilot's budget guarantees, with fake transports: no request leaves the machine. What is proven: the SDK client makes one
 * HTTP request per call when created with `maxRetries: 0`; the provider does not fall back to a second request; the count uses the
 * same parameters as the call; and the run makes at most two paid requests, each counted and reserved first, stopping on anything
 * uncertain.
 */
const sonnet: ModelSelection = { alias: "STANDARD", provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" };
const analyzer = getMaterialAnalyzer(3);

describe("el SDK no reintenta con maxRetries: 0", () => {
  const failingFetch = () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }), { status: 529, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
    };
    return { fetch, count: () => calls };
  };
  const call = (client: Anthropic) => client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 10, messages: [{ role: "user", content: "x" }] });

  it("un error 5xx es exactamente una petición; con los reintentos por defecto habrían sido tres", async () => {
    const zero = failingFetch();
    await expect(call(new Anthropic({ apiKey: "test", maxRetries: 0, fetch: zero.fetch as typeof globalThis.fetch }))).rejects.toThrow();
    expect(zero.count()).toBe(1);
    const defaults = failingFetch();
    await expect(call(new Anthropic({ apiKey: "test", fetch: defaults.fetch as typeof globalThis.fetch }))).rejects.toThrow();
    expect(defaults.count()).toBe(3);
  });
});

const message = (text: string, usage = { input_tokens: 1000, output_tokens: 500 }) =>
  ({ model: "claude-sonnet-5-5", content: [{ type: "text", text, citations: null }], stop_reason: "end_turn", usage: { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) as unknown as Anthropic.Message;
const tooComplex = () => new Anthropic.BadRequestError(400, { error: { message: "Schema is too complex for compilation." } }, "Schema is too complex for compilation.", new Headers());

describe("proveedor: sin respaldo y con recuento de los mismos parámetros", () => {
  const request: StructuredRequest = { selection: sonnet, system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], output: ADAPTATION_PLANNER_V3.output, maxOutputTokens: 100, timeoutMs: 1000 };

  it("un esquema rechazado no se reintenta en modo prompted cuando el respaldo está desactivado", async () => {
    resetOutputModes();
    const seen: Anthropic.MessageStreamParams[] = [];
    const client: AnthropicClientLike = { messages: { stream: (params) => (seen.push(params), { finalMessage: async () => Promise.reject(tooComplex()) }) } };
    await expect(new AnthropicProvider(client, { promptedFallback: false }).generateStructured(request)).rejects.toMatchObject({ code: "bad_request" });
    expect(seen).toHaveLength(1);
    // The production default keeps its fallback: the same rejection becomes a second request.
    const again: Anthropic.MessageStreamParams[] = [];
    const twice: AnthropicClientLike = { messages: { stream: (params) => (again.push(params), { finalMessage: async () => (again.length === 1 ? Promise.reject(tooComplex()) : message("{}")) }) } };
    await new AnthropicProvider(twice).generateStructured(request);
    expect(again).toHaveLength(2);
    resetOutputModes();
  });

  it("el recuento recibe exactamente los parámetros de la llamada, sin max_tokens", async () => {
    let counted: unknown;
    let sent: unknown;
    const client: AnthropicClientLike = {
      messages: {
        stream: (params) => ((sent = params), { finalMessage: async () => message("{}") }),
        countTokens: async (params) => ((counted = params), { input_tokens: 42 }),
      },
    };
    const provider = new AnthropicProvider(client, { deliveries: { [request.output.name]: "native" } });
    expect(await provider.countInputTokens(request)).toEqual({ mode: "native", inputTokens: 42 });
    await provider.generateStructured(request);
    const { max_tokens: _max, ...rest } = sent as { max_tokens: number };
    void _max;
    expect(counted).toEqual(rest);
  });
});

describe("contabilidad con reserva", () => {
  it("reserva dentro del 80 %, liquida con el uso real y no reserva nada tras detenerse", () => {
    const b = new PilotBudget(1);
    expect(b.cap).toBe(BUDGET_SAFETY);
    expect(b.reserve("a", 0.5)).toBe(true);
    b.settle("a", 0.5, 0.1);
    expect(b.committedUsd).toBe(0.1);
    expect(b.reserve("b", 0.75)).toBe(false);
    expect(b.stopReason).toMatch(/límite seguro/);
    expect(b.reserve("c", 0.01)).toBe(false);
  });

  it("un error, un uso desconocido o un coste mayor que la reserva conservan el máximo y detienen", () => {
    const error = new PilotBudget(1);
    error.reserve("a", 0.3);
    error.keep("a", 0.3, "error del proveedor");
    expect(error.committedUsd).toBe(0.3);
    expect(error.stopReason).toMatch(/error del proveedor/);
    const unknown = new PilotBudget(1);
    unknown.reserve("a", 0.3);
    unknown.settle("a", 0.3, null);
    expect(unknown.committedUsd).toBe(0.3);
    const above = new PilotBudget(1);
    above.reserve("a", 0.3);
    above.settle("a", 0.3, 0.4);
    expect(above.committedUsd).toBe(0.4);
    expect(above.stopReason).toMatch(/superó la reserva/);
  });

  it("la cota de una llamada añade el margen al recuento y cobra la salida máxima", () => {
    const base = callCeilingUsd(sonnet, 10_000, 1_000);
    const input = Math.ceil(10_000 * COUNT_MARGIN.factor) + COUNT_MARGIN.extraTokens;
    expect(base).toBeCloseTo((input * 2 * 1.25 + 1_000 * 10) / 1_000_000, 6);
    expect(() => callCeilingUsd({ ...sonnet, model: "sin-precio" }, 1, 1)).toThrow(/No hay precio/);
  });
});

describe("piloto completo con transporte falso", () => {
  const rules: AgentRules = { version: "v9.9", package_sha256: "a".repeat(64), stable: [{ path: "reglas.md", text: "Reglas sintéticas." }], precedents: [], readCase: () => Promise.reject(new Error("sin casos")) };
  const pdf = new TextEncoder().encode("%PDF-1.4 sintético");

  function fake(options: { analysis?: "ok" | "error"; planner?: "ok" | "too_complex"; count?: number | "fail" } = {}) {
    const requests: Array<{ kind: string; native: boolean }> = [];
    const client: AnthropicClientLike = {
      messages: {
        stream: (params) => {
          const native = Boolean((params.output_config as { format?: unknown } | undefined)?.format);
          requests.push({ kind: "message", native });
          if (!native) return { finalMessage: async () => (options.analysis === "error" ? Promise.reject(new Anthropic.InternalServerError(500, {}, "fallo", new Headers())) : message(JSON.stringify(mockAnalysisDraftV3()), { input_tokens: 6_000, output_tokens: 4_000 })) };
          return { finalMessage: async () => (options.planner === "too_complex" ? Promise.reject(tooComplex()) : message(JSON.stringify({ decisions: [], summary: ["Sin cambios necesarios."] }), { input_tokens: 40_000, output_tokens: 3_000 })) };
        },
        countTokens: async (params) => {
          requests.push({ kind: "count", native: Boolean((params.output_config as { format?: unknown } | undefined)?.format) });
          if (options.count === "fail") throw new Anthropic.InternalServerError(500, {}, "fallo", new Headers());
          return { input_tokens: options.count ?? 8_000 };
        },
      },
    };
    return { client, requests };
  }
  const run = (client: AnthropicClientLike, pay = true, budgetUsd = 1) => {
    const budget = new PilotBudget(budgetUsd);
    return runPilotCalls({ client, budget, analyzer, analysisSelection: sonnet, plannerSelection: sonnet, pdf, pages: 2, profile: "A", rules, allRules: "<agent_rules>Reglas sintéticas.</agent_rules>", analysisMax: 16_000, plannerMax: 32_000, pay }).then((r) => ({ ...r, budget }));
  };

  it("camino normal: tres recuentos gratuitos y exactamente dos llamadas de pago, liquidadas con su uso real", async () => {
    const { client, requests } = fake();
    const { calls, budget, out } = await run(client);
    expect(requests.map((r) => `${r.kind}:${r.native ? "native" : "prompted"}`)).toEqual(["count:prompted", "count:native", "message:prompted", "count:native", "message:native"]);
    expect(calls.filter((c) => c.kind === "message")).toHaveLength(2);
    expect(budget.stopReason).toBeNull();
    const actual = (6_000 * 2 + 4_000 * 10 + 40_000 * 2 + 3_000 * 10) / 1_000_000;
    expect(budget.committedUsd).toBeCloseTo(actual, 6);
    expect(out.plan).toBeDefined();
  });

  it("solo recuento: ninguna llamada de pago", async () => {
    const { client, requests } = fake();
    await run(client, false);
    expect(requests.every((r) => r.kind === "count")).toBe(true);
  });

  it("si el análisis falla, se conserva su reserva completa y no se llama al planificador", async () => {
    const { client, requests } = fake({ analysis: "error" });
    const { budget } = await run(client);
    expect(requests.filter((r) => r.kind === "message")).toHaveLength(1);
    expect(budget.stopReason).toMatch(/análisis/);
    expect(budget.committedUsd).toBeCloseTo(callCeilingUsd(sonnet, 8_000, 16_000), 6);
  });

  it("si la API rechaza el esquema del planificador, no hay segunda petición en modo prompted", async () => {
    const { client, requests } = fake({ planner: "too_complex" });
    const { budget } = await run(client);
    expect(requests.filter((r) => r.kind === "message")).toHaveLength(2);
    expect(budget.stopReason).toMatch(/planificador/);
  });

  it("un recuento fallido o una cota por encima del límite seguro detienen antes de pagar", async () => {
    const failed = fake({ count: "fail" });
    expect((await run(failed.client)).budget.stopReason).toMatch(/recuento fallido/);
    expect(failed.requests.filter((r) => r.kind === "message")).toHaveLength(0);
    const huge = fake({ count: 400_000 });
    expect((await run(huge.client)).budget.stopReason).toMatch(/límite seguro/);
    expect(huge.requests.filter((r) => r.kind === "message")).toHaveLength(0);
  });
});
