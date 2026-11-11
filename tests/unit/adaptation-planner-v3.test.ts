import { describe, expect, it, vi } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { sequentialIds } from "@/lib/adaptation/document";
import { createMockGenerator, createMockReviewer, mockPlanDraftV2 } from "@/lib/adaptation/mock";
import { createMockPlannerV3, mockPlanDraftV3 } from "@/lib/adaptation/mock-v3";
import { runAdaptation } from "@/lib/adaptation/pipeline";
import { normalizePlanV2 } from "@/lib/adaptation/plan-v2";
import { normalizePlanV3, withholdForTeacher, withoutDeclarations, type RulesUse } from "@/lib/adaptation/plan-v3";
import { createModelPlanner, plannerRequestParts } from "@/lib/adaptation/planner";
import { auditAdaptation } from "@/lib/adaptation/v22/audit";
import type { RulesBlock } from "@/lib/agent-rules/prompt-block";
import type { AIProvider, StructuredRequest, StructuredResponse } from "@/lib/ai/types";
import { ADAPTATION_PLANNER_V2 } from "@prompts/adaptation-planner/v2";
import { ADAPTATION_PLANNER_V3 } from "@prompts/adaptation-planner/v3";
import { DraftAdaptationPlanV3Schema } from "@/lib/schemas/adaptation-plan-draft-v3";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { PlanReview } from "@/lib/schemas/plan-review";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { V22_PROFILES } from "./fixtures/v22-profiles";

/**
 * adaptation_planner@v3 (ADR-045) with mock models and a SYNTHETIC rules block: no provider is called over the network and the
 * private rules are not needed. What is checked: the contract, what the model would receive, that the canonical plan v1 does not
 * change, and that what the method declares conditional is never applied without the teacher.
 */
const RULES: RulesBlock = {
  text: `<agent_rules version="v9.9" sha256="${"a".repeat(64)}">\nREGLAS SINTÉTICAS DE PRUEBA\n</agent_rules>`,
  version: "v9.9",
  package_sha256: "a".repeat(64),
  block_sha256: "b".repeat(64),
  selection: { resources: ["espacios"], included: [{ id: "D900-E01", reason: "mandatory" }], excluded: [] },
};
const USE: RulesUse = { version: "v9.9", package_sha256: "a".repeat(64), block_sha256: "b".repeat(64), included: ["D900-E01"] };

const contextOf = (profile: FunctionalProfile, analysis = fractionsAnalysis()) => buildAdaptationContext({ profile, education: { stage: "primaria", grade: null, subject: null }, analysis, adaptationType: "accessibility" }).context;
// need_1 of profile B is its strongest need (fine_motor_demand), served by «response_format».
const decision = (over: Record<string, unknown> = {}) => ({ target: "act_2", action: "add_support", strategies: ["response_format"], need_refs: ["need_1"], intensity: "light", supports: [{ kind: "checklist", uses_task_data: false }], status: "active", hint_yes: [], ...over });

describe("contrato DraftAdaptationPlan v3", () => {
  it("acepta un plan con las declaraciones del método", () => {
    expect(DraftAdaptationPlanV3Schema.safeParse({ decisions: [decision()], summary: [] }).success).toBe(true);
  });

  it("una declaración ausente o incoherente NO es un fallo del contrato: retiene la decisión (sin reparación de pago)", () => {
    const analysis = fractionsAnalysis();
    const context = contextOf(V22_PROFILES.A, analysis);
    const USE: RulesUse = { version: "v9.9", package_sha256: "a".repeat(64), block_sha256: "b".repeat(64), included: ["D900-E01"] };
    for (const over of [{ hint_yes: undefined }, { status: "conditional" }, { status: "conditional", question: "q_4" }]) {
      expect(DraftAdaptationPlanV3Schema.safeParse({ decisions: [decision(over)], summary: [] }).success).toBe(true);
    }
    const missing = normalizePlanV3({ decisions: [decision({ hint_yes: undefined }), decision({ target: "act_3", status: "conditional" })], summary: [] }, analysis, context, USE).declarations;
    expect(Object.values(missing.decisions).map((d) => d.withheld)).toEqual([true, true]);
    expect(missing.issues.filter((i) => i.code === "declaration_missing")).toHaveLength(2);
    // A decision that is not a resource needs no hint test.
    expect(normalizePlanV3({ decisions: [decision({ action: "rephrase", hint_yes: undefined, strategies: ["instruction_clarification"] })], summary: [] }, analysis, context, USE).declarations.issues.some((i) => i.code === "declaration_missing")).toBe(false);
  });

  it("un campo declarado como null se trata como ausente (corrección sin llamada)", async () => {
    const { fixDraftV2 } = await import("@/lib/adaptation/planner-draft");
    const { draft, fixes } = fixDraftV2({ decisions: [{ ...decision(), question: null, hint_yes: null, precedents: null }], summary: [], teacher_questions: null, residual_barriers: null });
    expect(fixes).toHaveLength(5);
    expect(DraftAdaptationPlanV3Schema.safeParse(draft).success).toBe(true);
  });

  it("un precedente con formato inválido sí se rechaza", () => {
    const result = DraftAdaptationPlanV3Schema.safeParse({ decisions: [decision({ precedents: ["D9-X"] })], summary: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.includes("precedents"))).toBe(true);
  });
});

describe("petición al modelo", () => {
  const analysis = fractionsAnalysis();
  const context = contextOf(V22_PROFILES.A, analysis);

  it("el texto publicado de v3 queda fijado: un cambio es una versión nueva", async () => {
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(ADAPTATION_PLANNER_V3.system).digest("hex")).toBe("ae6e0171f24facdab0d310776518c7e4992352f9037c5d201be74b721bf7cf28");
  });

  it("sin reglas verificadas, v3 no se ejecuta", () => {
    expect(() => plannerRequestParts({ analysis, context, version: 3 })).toThrow(/reglas pedagógicas verificadas/);
  });

  it("primero las reglas; después el contexto y el material no confiable, igual que v2; el sistema es el de v2 más el método", () => {
    const { prompt, parts } = plannerRequestParts({ analysis, context, version: 3, rules: RULES });
    const v2 = plannerRequestParts({ analysis, context, version: 2 });
    expect(prompt.version).toBe(3);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: RULES.text });
    expect(parts[1]).toEqual(v2.parts[0]);
    expect(ADAPTATION_PLANNER_V3.system.startsWith(ADAPTATION_PLANNER_V2.system)).toBe(true);
    expect(ADAPTATION_PLANNER_V3.system).not.toContain("REGLAS SINTÉTICAS");
    // The model-facing material carries no inferred answer (same guarantee as v2).
    expect(JSON.stringify(parts)).not.toContain("1/4, 1/2, 3/4");
  });
});

describe("normalización: plan v1 sin cambios y declaraciones aparte", () => {
  const analysis = fractionsAnalysis();
  const context = contextOf(V22_PROFILES.B, analysis);

  it("el plan v1 es el mismo que produce v2 con las mismas decisiones", () => {
    const v3 = mockPlanDraftV3(analysis, context, USE);
    const shared = { decisions: v3.decisions.map(withoutDeclarations), summary: v3.summary };
    expect(normalizePlanV3(v3, analysis, context, USE).plan).toEqual(normalizePlanV2(shared, analysis, context));
  });

  it("retiene lo condicionado y lo que el propio planificador marca como pista; P7 solo se registra", () => {
    const draft = {
      decisions: [decision({ status: "conditional", question: "q_1" }), decision({ target: "act_3", hint_yes: ["P8"] }), decision({ target: "act_4", hint_yes: ["P7"] }), decision({ target: "act_5", precedents: ["D900-E01", "D999-A01"] })],
      summary: [],
      teacher_questions: [{ id: "q_1", text: "¿Responde en la ficha o en el cuaderno?" }],
    };
    const { declarations } = normalizePlanV3(draft, analysis, context, USE);
    expect(Object.fromEntries(Object.entries(declarations.decisions).map(([k, v]) => [k, v.withheld]))).toEqual({ dec_1: true, dec_2: true, dec_3: false, dec_4: false });
    expect(declarations.issues.map((i) => i.code).sort()).toEqual(["blocking_hint", "conditional", "precedent_not_sent"]);
    expect(declarations.teacher_questions).toEqual([{ id: "q_1", text: "¿Responde en la ficha o en el cuaderno?", decision_ids: ["dec_1"] }]);
  });

  it("una pregunta o una nota que revela una respuesta inferida no se muestra", () => {
    const draft = {
      decisions: [decision({ status: "conditional", question: "q_1" })],
      summary: [],
      // act_3's inferred answer is 3/5, a number the sheet never prints: it can be recognised in any free text.
      teacher_questions: [{ id: "q_1", text: "¿Le basta con saber que el resultado es 3/5?" }],
      residual_barriers: [{ target: "act_5", need_refs: ["need_1"], note: "Se mantiene la escritura a mano." }],
    };
    const { declarations } = normalizePlanV3(draft, analysis, context, USE);
    expect(declarations.teacher_questions[0]?.text).toBeNull();
    expect(declarations.residual_barriers[0]?.note).toBe("Se mantiene la escritura a mano.");
    expect(declarations.issues.map((i) => i.code)).toContain("question_withheld");
  });

  it("una revisión automática rechaza lo retenido; la del docente queda como la dejó", () => {
    const { plan, declarations } = normalizePlanV3({ decisions: [decision({ status: "conditional", question: "q_1" }), decision({ target: "act_3" })], summary: [], teacher_questions: [{ id: "q_1", text: "¿Puede usar teclado?" }] }, analysis, context, USE);
    const review = (kind: "auto" | "teacher"): PlanReview => ({ schema_version: 1, plan_fingerprint: "c".repeat(64), reviewer: { kind }, reviewed_at: "2026-11-04", entries: plan.decisions.map((d) => ({ decision_id: d.id, action: "approved" as const, reason: "Sin avisos" })) });
    expect(withholdForTeacher(review("auto"), declarations).entries.map((e) => e.action)).toEqual(["rejected", "approved"]);
    expect(withholdForTeacher(review("teacher"), declarations)).toEqual(review("teacher"));
  });
});

describe("pipeline con planificador v3 simulado", () => {
  const run = (profile: FunctionalProfile, analysis = fractionsAnalysis(), rules: RulesUse | null = USE) =>
    runAdaptation({ profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" }, { planner: createMockPlannerV3(analysis, rules), generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds(), plannerVersion: 3 });

  it("B: la respuesta con teclado sin permiso se propone condicionada y no se aplica; queda con su pregunta en el registro", async () => {
    // Argumentation: short answers (act_2–act_4) and evaluated writing (act_1, act_5), so both declarations appear.
    const result = await run(V22_PROFILES.B, argumentationAnalysis());
    const conditional = result.reviewed.raw.decisions.find((d) => d.response_target === "keyboard")!;
    expect(conditional).toBeDefined();
    expect(result.plan.decisions.some((d) => d.id === conditional.id)).toBe(false);
    expect(result.reviewed.decisions.find((d) => d.id === conditional.id)?.outcome).toBe("rejected");
    const { ledger } = auditAdaptation({ plan: result.reviewed.raw, validation: result.validation, context: result.context, analysis: argumentationAnalysis(), document: result.document, declarations: result.declarations });
    const entry = ledger.decisions.find((d) => d.id === conditional.id)!;
    expect(entry).toMatchObject({ status: "teacher_validation", declared: { status: "conditional", question: "q_1", withheld: true } });
    expect(ledger.declarations?.teacher_questions[0]?.text).toBe("¿Puede responder con teclado en esta actividad?");
    expect(ledger.declarations?.residual_barriers).toEqual([{ activity: "act_1", dimensions: ["fine_motor_demand"], note: "Se mantiene la escritura a mano porque es lo que se evalúa.", status: "pending_review" }]);
    expect(ledger.declarations?.rules).toEqual({ version: "v9.9", package_sha256: "a".repeat(64), block_sha256: "b".repeat(64), precedents_sent: 1 });
    // Proven residual barriers and declared ones stay apart.
    expect(ledger.residual_barriers.every((b) => b.evidence !== undefined)).toBe(true);
  });

  it("C: ninguna decisión, ninguna pregunta, ninguna barrera declarada", async () => {
    const result = await run(V22_PROFILES.C);
    expect(result.reviewed.raw.decisions).toEqual([]);
    expect(result.declarations).toMatchObject({ teacher_questions: [], residual_barriers: [], issues: [] });
  });

  it("v1 y v2 no cambian: sin declaraciones y con la misma revisión automática", async () => {
    const analysis = fractionsAnalysis();
    const v2 = await runAdaptation({ profile: V22_PROFILES.A, education: { stage: "primaria", grade: null, subject: null }, analysis, adaptationType: "accessibility" }, { planner: { plan: async ({ context }) => ({ draft: mockPlanDraftV2(analysis, context), runs: [] }) }, generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds(), plannerVersion: 2 });
    expect(v2.declarations).toBeNull();
    const v3 = await run(V22_PROFILES.A);
    // Same decisions for A (nothing conditional): the same effective plan and the same sheet.
    expect(v3.plan).toEqual(v2.plan);
    expect(v3.document).toEqual(v2.document);
  });
});

describe("planificador de modelo v3 con un proveedor de prueba (sin red)", () => {
  const analysis = fractionsAnalysis();
  const context = contextOf(V22_PROFILES.B, analysis);
  const provider = (text: string) => {
    const generateStructured = vi.fn<(request: StructuredRequest) => Promise<StructuredResponse>>(async () => ({ text, stopReason: "complete" as const, usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, cacheCreationInputTokens: 0 }, provider: "mock" as const, model: "default", latencyMs: 1 }));
    return { provider: { name: "mock", generateStructured } satisfies AIProvider, generateStructured };
  };
  const selection = { alias: "STANDARD" as const, provider: "mock" as const, model: "default", effort: "medium" as const };

  it("envía las reglas, guarda solo su huella y devuelve qué precedentes se enviaron", async () => {
    const { provider: p, generateStructured } = provider(JSON.stringify(mockPlanDraftV3(analysis, context, USE)));
    const planner = createModelPlanner({ analysis, selection, provider: p, maxOutputTokens: 4000, version: 3, rulesFor: async () => RULES });
    const result = await planner.plan({ context, material: {} as never });
    const request = generateStructured.mock.calls[0]![0];
    expect(request.messages[0]!.content[0]).toEqual({ type: "text", text: RULES.text });
    expect(result.runs[0]).toMatchObject({ promptVersion: 3, rulesSha256: "a".repeat(64) });
    expect(result.rules).toEqual(USE);
    expect(JSON.stringify(result.runs)).not.toContain("REGLAS SINTÉTICAS");
  });

  it("sin origen de reglas no llega a llamar al proveedor", async () => {
    const { provider: p, generateStructured } = provider("{}");
    const planner = createModelPlanner({ analysis, selection, provider: p, maxOutputTokens: 4000, version: 3 });
    await expect(planner.plan({ context, material: {} as never })).rejects.toMatchObject({ code: "not_configured" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("una respuesta que no cumple el contrato v3 se rechaza como salida inválida", async () => {
    const { provider: p } = provider(JSON.stringify({ decisions: [decision({ precedents: ["D9-X"] })], summary: [] }));
    const planner = createModelPlanner({ analysis, selection, provider: p, maxOutputTokens: 4000, version: 3, rulesFor: async () => RULES });
    await expect(planner.plan({ context, material: {} as never })).rejects.toMatchObject({ code: "invalid_output" });
  });
});

describe("regresión A/B/C con el planificador v3 simulado", () => {
  const SHEETS = [["fracciones", fractionsAnalysis], ["argumentación", argumentationAnalysis], ["geografía", () => geographyAnalysis()]] as const;

  it.each(SHEETS)("%s: lo retenido nunca se aplica, C no recibe nada, los visuales necesarios siguen y el resultado es estable", async (_, sheet) => {
    for (const [who, profile] of Object.entries(V22_PROFILES)) {
      const analysis = sheet();
      const go = () => runAdaptation({ profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" }, { planner: createMockPlannerV3(analysis, USE), generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds(), plannerVersion: 3 });
      const result = await go();
      const withheld = Object.entries(result.declarations!.decisions).filter(([, v]) => v.withheld).map(([k]) => k);
      for (const id of withheld) expect(result.plan.decisions.some((d) => d.id === id), `${who} ${id}`).toBe(false);
      if (who === "C") expect(result.reviewed.raw.decisions).toEqual([]);
      // Only active needs: never one marked «no necesita», never one left unassessed.
      for (const d of result.reviewed.raw.decisions) for (const dim of d.dimensions) expect(profile.supports[dim] ?? "unassessed", `${who} usa ${dim}`).toMatch(/low|medium|high/);
      for (const vis of analysis.visuals.filter((v) => v.role === "required")) expect(result.document.pages.some((p) => p.blocks.some((b) => b.trace.source_refs.includes(vis.id))), vis.id).toBe(true);
      expect(["approved", "approved_with_warnings"]).toContain(result.review.verdict);
      const again = await go();
      expect(again.declarations).toEqual(result.declarations);
      expect(again.plan).toEqual(result.plan);
    }
  });
});

const PRIVATE_DIR = process.env.AGENT_RULES_PRIVATE_DIR;
describe.skipIf(!PRIVATE_DIR)("cadena completa con las reglas V2.2 reales y un modelo simulado (solo con copia privada local)", () => {
  it("carga verificada → bloque → petición v3 → borrador → plan v1 y declaraciones", async () => {
    vi.doMock("server-only", () => ({}));
    const { directoryRulesSource } = await import("@/lib/agent-rules/sources");
    const { loadAgentRules } = await import("@/lib/agent-rules/loader");
    const { AGENT_RULES_V22 } = await import("@/lib/agent-rules/manifest-v22");
    const { buildRulesBlock } = await import("@/lib/agent-rules/prompt-block");
    const rules = await loadAgentRules(await directoryRulesSource(PRIVATE_DIR!), AGENT_RULES_V22);
    const analysis = argumentationAnalysis();
    const context = contextOf(V22_PROFILES.B, analysis);
    const block = await buildRulesBlock(rules, analysis, context);
    const generateStructured = vi.fn<(request: StructuredRequest) => Promise<StructuredResponse>>(async () => ({ text: JSON.stringify(mockPlanDraftV3(analysis, context, null)), stopReason: "complete" as const, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 }, provider: "mock" as const, model: "default", latencyMs: 1 }));
    const planner = createModelPlanner({ analysis, selection: { alias: "STANDARD", provider: "mock", model: "default", effort: "medium" }, provider: { name: "mock", generateStructured }, maxOutputTokens: 32000, version: 3, rulesFor: async () => block });
    const result = await planner.plan({ context, material: {} as never });
    expect(result.runs[0]?.rulesSha256).toBe(AGENT_RULES_V22.package_sha256);
    const { plan, declarations } = normalizePlanV3(result.draft, analysis, context, result.rules ?? null);
    expect(plan.decisions.length).toBeGreaterThan(0);
    expect(declarations.rules?.included.length).toBe(block.selection.included.length);
    // Size only, never the text: the request carries the full verified block.
    expect((generateStructured.mock.calls[0]![0].messages[0]!.content[0] as { text: string }).text.length).toBe(block.text.length);
  });
});

describe("activación", () => {
  it("v3 no es la versión activa ni la del pipeline general: solo la elige la puerta del piloto (ADR-046)", async () => {
    const { ACTIVE_ADAPTATION_PROMPT_VERSIONS } = await import("@/lib/ai/prompts");
    const { EXPERIMENTAL_PIPELINE, resolvePipelineVersions } = await import("@/lib/adaptation/orchestration/versions");
    expect(ACTIVE_ADAPTATION_PROMPT_VERSIONS.adaptation_planner).toBe(1);
    expect(EXPERIMENTAL_PIPELINE.planner).toBe(2);
    expect(resolvePipelineVersions({}).planner.prompt_version).toBe(2);
  });

  it("el orquestador lee un borrador v3 con su contrato: inválido es «schema», válido trae plan y declaraciones", async () => {
    const { checkPlanDraft } = await import("@/lib/adaptation/planner-draft");
    const analysis = fractionsAnalysis();
    const context = contextOf(V22_PROFILES.A, analysis);
    expect(checkPlanDraft(3, {}, analysis, context)).toMatchObject({ ok: false, kind: "schema" });
    const checked = checkPlanDraft(3, mockPlanDraftV3(analysis, context, null), analysis, context);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.declarations).not.toBeNull();
      expect(Object.keys(checked.declarations!.decisions)).toEqual(checked.plan.decisions.map((d) => d.id));
    }
    // Every other version carries no declarations.
    expect(checkPlanDraft(2, mockPlanDraftV2(analysis, context), analysis, context)).toMatchObject({ ok: true, declarations: null });
  });
});

describe("salidas estructuradas (output_config.format)", () => {
  it("el contrato v3 que se envía cumple los límites documentados y v3 usa la decodificación restringida, con respaldo", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const { checkStructuredLimits, STRUCTURED_OUTPUT_LIMITS } = await import("@/lib/ai/structured-limits");
    const { AnthropicProvider, resetOutputModes } = await import("@/lib/ai/providers/anthropic");
    const sent = zodOutputFormat(DraftAdaptationPlanV3Schema).schema as Record<string, unknown>;
    const report = checkStructuredLimits(sent);
    expect(report.problems).toEqual([]);
    expect(report.optionalParameters).toBeLessThanOrEqual(STRUCTURED_OUTPUT_LIMITS.optionalParameters);
    expect(report.unionParameters).toBeLessThanOrEqual(STRUCTURED_OUTPUT_LIMITS.unionParameters);
    expect(ADAPTATION_PLANNER_V3.output.delivery).toBe("auto");

    resetOutputModes();
    const seen: Array<Record<string, unknown>> = [];
    const message = { model: "claude-sonnet-5-5", content: [{ type: "text", text: "{}", citations: null }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
    const client = { messages: { stream: (params: Record<string, unknown>) => (seen.push(params), { finalMessage: async () => message }) } };
    await new AnthropicProvider(client as never).generateStructured({ selection: { alias: "STANDARD", provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" }, system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], output: ADAPTATION_PLANNER_V3.output, maxOutputTokens: 100, timeoutMs: 1000 });
    const format = (seen[0]!.output_config as { format?: { type: string; schema: unknown } }).format;
    expect(format?.type).toBe("json_schema");
    expect(format?.schema).toEqual(sent);
    resetOutputModes();
  });

});
