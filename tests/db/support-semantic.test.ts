import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAndStartAdaptation, getAdaptationStatus, getAdaptationVersion, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { MAX_GENERATION_CYCLES } from "@/lib/adaptation/orchestration/status";
import { resolvePipelineVersions } from "@/lib/adaptation/orchestration/versions";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { RejectedStageOutput, rejectedRun, type MaterialGenerator, type PedagogicalReviewer, type AdaptationPlanner } from "@/lib/adaptation/services";
import type { ReviewerV2Mode, SemanticRecordSet } from "@/lib/adaptation/support-semantic";
import type { SubstitutionMode } from "@/lib/adaptation/support-substitution";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import type { SupportJudgment } from "@/lib/schemas/reviewer-findings";
import { cellDecisions, cellLeaking, cellPilotAnalysis, cellSafe, cellSafeWithReminder } from "../support/cell-pilot";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial } from "./orchestration-harness";

/**
 * Etapa 2.3 · la revisión semántica de los apoyos de extremo a extremo (migraciones reales sobre PGlite; planificador, generador y revisor
 * SIMULADOS: 0 llamadas reales). La ficha es la de la célula, con la respuesta NO deducible: lo mecánico no ve nada y solo el juicio del
 * revisor puede decir que el ejemplo «… → Núcleo» hace el ejercicio. Comprueba los modos del interruptor, su combinación con la sustitución de
 * la etapa 2.2, los ciclos, el coste en llamadas y la reanudación.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(async () => {
  await db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'");
  await db.query("delete from public.app_settings where key = 'ai.failure_budget'");
});

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
/** The record of a call the model answered (and was paid) whose answer broke the contract, as the real reviewer reports it. */
const stageRecord = { purpose: "review", attempt: 1, alias: "STANDARD", provider: "mock", model: "m", effort: "medium", promptKey: "pedagogical_reviewer", promptVersion: 2, inputTokens: 5700, outputTokens: 900, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0.03, latencyMs: 5460, status: "success", errorCode: null, schemaKey: "pedagogical_review_findings", schemaVersion: 2, callKind: "initial", reasoningTokens: null } as never;

/** La ficha de la célula con la respuesta no deducible: ningún aviso mecánico, solo el juicio semántico puede verlo. */
const notInferable = (): MaterialAnalysis => {
  const a = cellPilotAnalysis();
  for (const act of a.activities) act.expected_answer = { basis: "not_inferable", value: null };
  return a;
};

type GenInput = Parameters<MaterialGenerator["generate"]>[0];
type ReviewInput = Parameters<PedagogicalReviewer["review"]>[0];
const plannerWith = (decisions: ReturnType<typeof cellDecisions>) => async (_inner: AdaptationPlanner, _call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => {
  const ref = (dim: string) => `need_${input.context.needs.findIndex((n) => n.dimension === dim) + 1}`;
  return { draft: { decisions: decisions.map(({ dimensions, ...rest }) => ({ ...rest, need_refs: dimensions.map(ref) })), summary: ["Plan de prueba"] }, runs: [] } as never;
};

/** What the simulated reviewer says of each support: the one that names «Núcleo» performs the item; the rest are access. */
const judgesByText = (extra: (unit: { block_id: string }, text: string, protectedId: string | undefined) => SupportJudgment | null = () => null) => (context: ReviewInput["reviewContext"]): SupportJudgment[] => {
  const protectedId = context?.protected.find((p) => p.type === "concept")?.id;
  return (context?.supports ?? []).map((unit) => {
    const text = context!.document.blocks.find((b) => b.id === unit.block_id)?.text ?? "";
    return extra(unit, text, protectedId) ?? (/N[úu]cleo/.test(text) ? { block_id: unit.block_id, class: "performs" as const, how: "resolves_item" as const, protected_id: protectedId, reason: "El ejemplo resuelve un ítem." } : { block_id: unit.block_id, class: "legitimate" as const });
  });
};

interface Script {
  reviewerMode?: ReviewerV2Mode;
  substitution?: SubstitutionMode;
  pinned?: 1 | 2;
  generator: (call: number) => ReturnType<typeof cellLeaking>;
  judge?: (context: ReviewInput["reviewContext"]) => SupportJudgment[];
  reviewer?: (inner: PedagogicalReviewer, call: number, input: ReviewInput) => ReturnType<PedagogicalReviewer["review"]>;
}

let n = 0;
async function teacher(script: Script) {
  const u = await createUser(db, `semantic-${++n}@example.com`);
  const material = await seedMaterial(db, u, notInferable());
  const learner = await seedLearner(db, u);
  const spy = newSpy();
  const restrictions: string[][] = [];
  const contexts: Array<ReviewInput["reviewContext"]> = [];
  const generator = async (_inner: MaterialGenerator, call: number, input: GenInput) => {
    restrictions.push(input.reviewed.decisions.find((d) => d.id === "dec_1")?.restrictions ?? []);
    return { draft: script.generator(call), runs: [] } as never;
  };
  const judge = script.judge ?? judgesByText();
  const reviewer = script.reviewer ?? (async (inner: PedagogicalReviewer, _call: number, input: ReviewInput) => {
    contexts.push(input.reviewContext);
    const out = await inner.review(input);
    return input.reviewContext?.context_version === 2 ? { ...out, judgments: judge(input.reviewContext) } : out;
  });
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner: plannerWith(cellDecisions() as never), generator, reviewer }));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  if (script.reviewerMode) orchestrator.reviewerV2 = script.reviewerMode;
  if (script.substitution) orchestrator.supportSubstitution = script.substitution;
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: () => resolvePipelineVersions({}, { reviewerV2: (script.pinned ?? 2) === 2 }) };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `semantic-${n}-${Math.random()}`, creationMode: "automatic" });
  if (!created.ok) throw new Error(created.code);
  const id = created.data.adaptationId;
  const run = async () => {
    for (let i = 0; i < 40; i++) if (!(await processAdaptationStage(orchestrator, id))) break;
  };
  await run();
  const status = async () => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const sheet = async () => {
    const v = await getAdaptationVersion(deps, actor, id);
    if (!v.ok) throw new Error(v.code);
    return JSON.stringify(allBlocks(v.data.document as MaterialDocument));
  };
  return { id, spy, restrictions, contexts, orchestrator, status, sheet, run };
}

const semanticOf = async (id: string) =>
  (await q<{ payload: { semantic?: SemanticRecordSet & { dry_run?: Array<{ action: string; trigger: string }> }; review: PedagogicalReview } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'pedagogical_review' order by created_at", [id])).map((r) => r.payload);
const reviewRuns = (id: string) => q<{ prompt_version: number; call_kind: string; status: string }>("select prompt_version, call_kind, status from public.ai_runs where adaptation_id = $1 and purpose = 'review' order by created_at", [id]);
const trace = async (id: string) =>
  (await q<{ payload: { support_resolution?: Array<{ decision_id: string; action: string; trigger: string; semantic_review: string; mode: string; option: string | null }>; automatic?: { support_resolution?: Array<{ decision_id: string; action: string; trigger: string; semantic_review: string; mode: string; option: string | null }> } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'execution_report' order by created_at", [id])).flatMap((r) => [...(r.payload.support_resolution ?? []), ...(r.payload.automatic?.support_resolution ?? [])]);

describe("off (por defecto): el revisor v1 exactamente como antes", () => {
  it("una adaptación creada sin el revisor v2 no recibe contexto semántico, no pide juicios y no guarda nada nuevo, aunque el interruptor diga «on»", async () => {
    const t = await teacher({ pinned: 1, reviewerMode: "on", generator: () => cellLeaking() });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true });
    expect(t.spy.generator).toBe(1);
    expect(t.spy.reviewer).toBe(1);
    expect(t.contexts[0]!.context_version).toBe(1);
    expect(t.contexts[0]).not.toHaveProperty("supports");
    expect((await semanticOf(t.id)).every((p) => p.semantic === undefined)).toBe(true);
    expect((await reviewRuns(t.id)).map((r) => r.prompt_version)).toEqual([1]);
  });

  it("una adaptación fijada con v2 y el interruptor apagado (o ausente) también ejecuta v1: sin contexto semántico, sin registro", async () => {
    for (const mode of [undefined, "off" as const]) {
      const t = await teacher({ pinned: 2, ...(mode ? { reviewerMode: mode } : {}), generator: () => cellLeaking() });
      expect(await t.status()).toMatchObject({ status: "ready", delivered: true });
      expect(t.contexts[0]!.context_version).toBe(1);
      expect((await semanticOf(t.id)).every((p) => p.semantic === undefined)).toBe(true);
    }
  });
});

describe("shadow: el v2 juzga y se REGISTRA; el veredicto y las reparaciones son los del v1", () => {
  it("el ejemplo «… → Núcleo» se juzga como confirmado y queda registrado, pero la ficha se entrega igual, con UNA generación y una revisión", async () => {
    const t = await teacher({ reviewerMode: "shadow", substitution: "on", generator: () => cellLeaking() });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect(t.spy.generator).toBe(1);
    expect(t.spy.reviewer).toBe(1);
    expect(t.contexts[0]!.context_version).toBe(2);
    const [review] = await semanticOf(t.id);
    expect(review!.semantic).toMatchObject({ policy: "support_semantic@v1", mode: "shadow", counts: { confirmed: 1, legitimate: 0, suspected: 0, unjudged: 0 } });
    expect(review!.semantic!.records[0]).toMatchObject({ status: "confirmed", how: "resolves_item", kind: "worked_example", activity_ids: ["act_1"] });
    // Sin consecuencias: ni un FAIL semántico, ni restricciones, ni sustitución, ni bandera de reparación.
    expect(review!.review.checks.filter((c) => c.check === "answers_not_leaked" && c.status === "FAIL")).toEqual([]);
    expect(await trace(t.id)).toEqual([]);
    expect(t.restrictions.flat()).toEqual([]);
    expect(await t.sheet()).toContain("Núcleo.");
  });

  it("la revisión de shadow es idéntica a la de off para el mismo documento y las mismas respuestas del revisor", async () => {
    const off = await teacher({ pinned: 1, generator: () => cellLeaking() });
    const shadow = await teacher({ reviewerMode: "shadow", generator: () => cellLeaking() });
    const checks = async (id: string) => (await semanticOf(id)).at(-1)!.review.checks;
    expect(await checks(shadow.id)).toEqual(await checks(off.id));
    expect((await semanticOf(shadow.id)).at(-1)!.review.verdict).toBe((await semanticOf(off.id)).at(-1)!.review.verdict);
  });
});

describe("on + sustitución en ensayo (dry_run): la reparación semántica actúa, la sustitución solo se anota", () => {
  it("el hallazgo confirmado suspende la revisión; la regeneración recibe qué NO debe hacer el apoyo y la ficha queda limpia en dos generaciones", async () => {
    const t = await teacher({ reviewerMode: "on", substitution: "dry_run", generator: (call) => (call === 1 ? cellLeaking() : cellSafe()) });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true, generationsUsed: 2 });
    expect(t.spy.generator).toBe(2);
    expect(t.spy.reviewer).toBe(2);
    expect(t.restrictions[0]).toEqual([]);
    expect(t.restrictions[1]!.join(" ")).toMatch(/no puede resolver ningún ítem/);
    expect(await t.sheet()).not.toContain("Núcleo.");
    const [first, second] = await semanticOf(t.id);
    expect(first!.review.checks.find((c) => c.check === "answers_not_leaked" && c.status === "FAIL")).toMatchObject({ method: "ai", targets: expect.arrayContaining(["act_1", "prt_1"]) });
    expect(first!.review.verdict).toBe("blocked");
    expect(second!.review.verdict).not.toBe("blocked");
    // Nada de esto es una sustitución: está configurada en ensayo y solo se anota lo que haría.
    expect(first!.semantic!.dry_run).toEqual([expect.objectContaining({ action: "would_substitute", trigger: "semantic_confirmed" })]);
    expect((await trace(t.id)).filter((r) => r.action === "substituted")).toEqual([]);
  });

  it("si el apoyo vuelve a hacer el ejercicio, NO se sustituye en silencio: sin alternativa autorizada, parada honesta y nada entregado", async () => {
    const t = await teacher({ reviewerMode: "on", substitution: "dry_run", generator: () => cellLeaking() });
    expect(await t.status()).toMatchObject({ delivered: false });
    expect(t.spy.generator).toBeLessThanOrEqual(MAX_GENERATION_CYCLES);
    expect((await trace(t.id)).filter((r) => r.action === "substituted")).toEqual([]);
    expect(await q("select 1 from public.adaptation_entitlements where adaptation_id = $1 and consumed_at is not null", [t.id])).toEqual([]);
  });

  it("con la sustitución apagada (off) ocurre lo mismo: nunca se sustituye", async () => {
    const t = await teacher({ reviewerMode: "on", substitution: "off", generator: () => cellLeaking() });
    expect(await t.status()).toMatchObject({ delivered: false });
    expect((await trace(t.id)).filter((r) => r.action === "substituted")).toEqual([]);
  });
});

describe("on + sustitución activada: un hallazgo confirmado que se repite se sustituye UNA vez por otro apoyo de la misma necesidad", () => {
  it("restricción, repetición y sustitución en la tercera generación; un ejemplo de otro ámbito más el recordatorio sirve la misma necesidad", async () => {
    const t = await teacher({ reviewerMode: "on", substitution: "on", generator: (call) => (call <= 2 ? cellLeaking() : cellSafeWithReminder()) });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true, generationsUsed: MAX_GENERATION_CYCLES });
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
    expect(t.spy.reviewer).toBe(MAX_GENERATION_CYCLES);
    const records = (await trace(t.id)).filter((r) => r.trigger === "semantic_confirmed");
    // Primero la restricción (la misma que cualquier otro fallo de revisión), después —solo tras repetirse— UNA sustitución.
    expect(records.map((r) => r.action)).toEqual(["restricted", "substituted"]);
    expect(records.every((r) => r.semantic_review === "confirmed")).toBe(true);
    expect(records[1]).toMatchObject({ decision_id: "dec_1", option: "other_domain_example", mode: "on" });
    const text = await t.sheet();
    expect(text).not.toContain("Núcleo.");
    expect(text).toContain("Lee cada pista entera");
  });

  it("nunca pasa de tres generaciones ni de tres revisiones: si todo lo repite, parada honesta, sin cuarta llamada y sin entregar", async () => {
    const t = await teacher({ reviewerMode: "on", substitution: "on", generator: () => cellLeaking() });
    expect(await t.status()).toMatchObject({ delivered: false, generationsUsed: MAX_GENERATION_CYCLES });
    expect(t.spy.generator).toBe(MAX_GENERATION_CYCLES);
    expect(t.spy.reviewer).toBe(MAX_GENERATION_CYCLES);
    const calls = [t.spy.generator, t.spy.reviewer];
    await t.run();
    await t.run();
    expect([t.spy.generator, t.spy.reviewer]).toEqual(calls);
    expect((await q<{ c: string }>("select count(*)::text c from public.ai_runs where adaptation_id = $1 and purpose = 'review'", [t.id]))[0]!.c).toBe(String(MAX_GENERATION_CYCLES));
  });

  it("shadow con la sustitución activada: NO hay reparación semántica (se entrega con una sola generación)", async () => {
    const t = await teacher({ reviewerMode: "shadow", substitution: "on", generator: () => cellLeaking() });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect(t.spy.generator).toBe(1);
    expect(await trace(t.id)).toEqual([]);
  });
});

describe("lo legítimo no se toca (falsos positivos)", () => {
  it("un ejemplo de otro ámbito (el corazón): ninguna reparación, una generación, ficha intacta", async () => {
    const t = await teacher({ reviewerMode: "on", substitution: "on", generator: () => cellSafe() });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    expect(t.spy.generator).toBe(1);
    const [review] = await semanticOf(t.id);
    expect(review!.semantic!.counts).toMatchObject({ confirmed: 0, unjudged: 0 });
    expect(review!.review.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(await trace(t.id)).toEqual([]);
  });

  it("la analogía de la casa es SOSPECHA: avisa y se registra, no repara ni bloquea y la ficha se entrega", async () => {
    const house = () => {
      const draft = cellSafe();
      const support = draft.segments[0]!.supports[0] as { kind: string; problem: string; result: string };
      support.problem = "Pista: «Es la parte de una casa que protege y separa el interior del exterior». Escribe qué parte de la casa es.";
      support.result = "Respuesta del ejemplo: la pared.";
      return draft;
    };
    const t = await teacher({
      reviewerMode: "on",
      substitution: "on",
      generator: () => house(),
      judge: judgesByText((unit, text, protectedId) => (/casa/.test(text) ? { block_id: unit.block_id, class: "hints", how: "analogy_of_item", protected_id: protectedId, reason: "Permite deducir la función del ítem b)." } : null)),
    });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true, generationsUsed: 1 });
    const [review] = await semanticOf(t.id);
    expect(review!.semantic!.records[0]).toMatchObject({ status: "suspected", reason_code: "analogy_needs_demonstration" });
    expect(review!.semantic!.needs).toEqual([expect.objectContaining({ decision_id: "dec_1", state: "suspected" })]);
    expect(review!.review.verdict).toBe("approved_with_warnings");
    expect(await trace(t.id)).toEqual([]);
  });

  it("un juicio ausente NUNCA es una aprobación: sin juicios el apoyo queda «sin juzgar» y avisa", async () => {
    const t = await teacher({ reviewerMode: "on", generator: () => cellSafe(), judge: () => [] });
    expect(await t.status()).toMatchObject({ status: "ready", delivered: true });
    const [review] = await semanticOf(t.id);
    expect(review!.semantic!.counts).toMatchObject({ unjudged: 1, confirmed: 0, legitimate: 0 });
    expect(review!.review.checks.find((c) => c.needs_semantic_review && c.status === "WARN" && c.detail.startsWith("Sin juicio semántico"))).toBeTruthy();
  });

  it("un id inventado por el revisor se descarta y el apoyo real sigue sin juzgar (jamás aprobado)", async () => {
    const t = await teacher({ reviewerMode: "on", generator: () => cellSafe(), judge: () => [{ block_id: "blk_inventado1", class: "legitimate" }] });
    const [review] = await semanticOf(t.id);
    expect(review!.semantic!.discarded.unknown_block).toBe(1);
    expect(review!.semantic!.counts).toMatchObject({ unjudged: 1, legitimate: 0 });
  });
});

describe("coste y reanudación: ninguna llamada de más", () => {
  it("una revisión es UNA llamada del revisor v2 (la misma de siempre, ninguna independiente) y queda en ai_runs con su versión", async () => {
    const t = await teacher({ reviewerMode: "shadow", generator: () => cellSafe() });
    expect(t.spy.reviewer).toBe(1);
    expect(await reviewRuns(t.id)).toEqual([{ prompt_version: 2, call_kind: "initial", status: "success" }]);
  });

  it("un JSON v2 mal formado se vuelve a pedir UNA vez (el reintento acotado de siempre): dos llamadas como máximo y los juicios de la segunda se usan", async () => {
    const t = await teacher({
      reviewerMode: "on",
      generator: () => cellLeaking(),
      reviewer: async (inner, call, input) => {
        const out = await inner.review(input);
        if (call === 1) throw new RejectedStageOutput("invalid_output", "reviewer output rejected: schema", rejectedRun(out.runs[0] ?? stageRecord, "invalid_output"), { kind: "schema", issues: [{ path: "support_judgments.0.block_id", code: "invalid_format", rule: "formato" }], outputTokens: 900, maxOutputTokens: 2600 });
        return { ...out, judgments: judgesByText()(input.reviewContext) };
      },
    });
    expect(t.spy.reviewer).toBeGreaterThanOrEqual(2);
    const runs = await reviewRuns(t.id);
    expect(runs.filter((r) => r.status === "invalid_output")).toHaveLength(1);
    expect(runs.filter((r) => r.call_kind === "repair" && r.status === "success")).toHaveLength(1);
    const [first] = await semanticOf(t.id);
    expect(first!.semantic!.counts.confirmed).toBe(1);
  });

  it("dos respuestas mal formadas seguidas: falla como antes (reviewer_schema), sin tercera llamada y sin aprobar nada", async () => {
    const t = await teacher({
      reviewerMode: "on",
      generator: () => cellSafe(),
      reviewer: async (inner, _call, input) => {
        const out = await inner.review(input);
        throw new RejectedStageOutput("invalid_output", "reviewer output rejected: schema", rejectedRun(out.runs[0] ?? stageRecord, "invalid_output"), { kind: "schema", issues: [], outputTokens: 900, maxOutputTokens: 2600 });
      },
    });
    expect(t.spy.reviewer).toBe(2);
    expect(await t.status()).toMatchObject({ status: "failed", delivered: false });
    expect((await q<{ failure_code: string }>("select failure_code from public.adaptations where id = $1", [t.id]))[0]!.failure_code).toBe("reviewer_schema");
  });

  it("volver a visitar una adaptación ya revisada no hace ninguna llamada más (los juicios guardados se reutilizan)", async () => {
    const t = await teacher({ reviewerMode: "on", generator: (call) => (call === 1 ? cellLeaking() : cellSafe()) });
    const calls = [t.spy.generator, t.spy.reviewer];
    await t.run();
    await t.run();
    expect([t.spy.generator, t.spy.reviewer]).toEqual(calls);
  });

  it("la trazabilidad guarda ids, códigos y recuentos: ni el texto del apoyo ni la respuesta en el registro de los juicios", async () => {
    const t = await teacher({ reviewerMode: "on", substitution: "dry_run", generator: (call) => (call === 1 ? cellLeaking() : cellSafe()) });
    const [first] = await semanticOf(t.id);
    const { records, ...rest } = first!.semantic!;
    const stripped = JSON.stringify({ ...rest, records: records.map((r) => ({ ...r, reason: undefined })) });
    expect(stripped).not.toMatch(/Núcleo|ADN|dirige la actividad/);
    expect(first!.semantic!.records[0]!.reason).toBeDefined();
  });
});
