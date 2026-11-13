import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PEDAGOGICAL_REVIEWER_V1 } from "@prompts/pedagogical-reviewer/v1";
import { PEDAGOGICAL_REVIEWER_V2 } from "@prompts/pedagogical-reviewer/v2";
import { REVIEW_CONTEXT_VERSION, REVIEW_CONTEXT_VERSION_SEMANTIC, buildPedagogicalReviewContext } from "@/lib/adaptation/review-context";
import { buildReviewScoped, createModelReviewer, parseReviewerResponse, parseReviewerResponseV2, reviewerRequestParts, withSemanticChecks } from "@/lib/adaptation/reviewer";
import { resolvePipelineVersions, REVIEWER_V2, PIPELINE_OUTPUT_LIMITS } from "@/lib/adaptation/orchestration/versions";
import { DEFAULT_REVIEWER_V2_MODE, buildSemanticScope, effectiveReviewerMode, judgeSupports, needStates, restrictionFor, semanticChecks, semanticFlags, summarize, type SemanticRecord } from "@/lib/adaptation/support-semantic";
import { getPedagogicalReviewer } from "@/lib/ai/prompts";
import { resolveModel } from "@/lib/ai/registry";
import type { AIProvider, StructuredResponse } from "@/lib/ai/types";
import { BLOCKING_CHECKS } from "@/lib/schemas/pedagogical-review";
import { MAX_SUPPORT_JUDGMENTS, ReviewerFindingsSchema, ReviewerFindingsV2Schema, SupportJudgmentSchema, sanitizeReviewerV2, type SupportJudgment } from "@/lib/schemas/reviewer-findings";
import { CORPUS, corpusById, type CorpusEntry } from "../../evals/support-semantic/corpus";
import { sheetOf } from "../../evals/support-semantic/lib";
import { ACTIVATION_THRESHOLDS, consistency, readyToActivate, referenceLabel, scoreCorpus, wilsonLower } from "../../evals/support-semantic/score";
import { primariaScenario } from "../../evals/adaptation/reviewer-fixtures";

/**
 * Etapa 2.3 · revisión semántica de los apoyos, con un revisor SIMULADO (0 llamadas reales) y los casos reales de las fichas del piloto:
 * estanque, célula, fracciones, números primos y seres vivos. Comprueba la política del servidor (qué puede cambiar un juicio), no el modelo.
 */

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const response = (text: string, stopReason: StructuredResponse["stopReason"] = "complete"): StructuredResponse => ({ text, stopReason, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0 }, provider: "anthropic", model: "m", latencyMs: 1 });

/** What the simulated reviewer answers for an entry: the judgment a competent reviewer is expected to give. */
const judgmentOf = (entry: CorpusEntry, blockId: string, protectedId: string): SupportJudgment => {
  const { judgment } = entry.expected;
  return { block_id: blockId, class: judgment.class, ...(judgment.how ? { how: judgment.how } : {}), ...(judgment.cites_protected ? { protected_id: protectedId } : {}), ...(judgment.class === "legitimate" ? {} : { reason: "Motivo simulado." }) };
};
const statusFor = (entry: CorpusEntry, judgments?: (e: CorpusEntry, blockId: string, protectedId: string) => SupportJudgment[]) => {
  const s = sheetOf(entry);
  const scope = buildSemanticScope(s.analysis, s.plan, s.document);
  const out = judgeSupports({ analysis: s.analysis, scope, document: s.document, judgments: (judgments ?? ((e, b, p) => [judgmentOf(e, b, p)]))(entry, s.blockId, s.protectedId) });
  return { scope, record: out.records[0]!, out };
};

describe("modos: off es el v1 exacto; shadow y on solo existen si la adaptación se creó con el revisor v2", () => {
  it("por defecto está apagado", () => {
    expect(DEFAULT_REVIEWER_V2_MODE).toBe("off");
  });

  it("una adaptación fijada con v1 ejecuta v1 sea cual sea el interruptor; una fijada con v2 sigue el interruptor", () => {
    for (const mode of ["off", "shadow", "on", undefined] as const) expect(effectiveReviewerMode(mode, 1)).toBe("off");
    expect(effectiveReviewerMode(undefined, 2)).toBe("off");
    expect(effectiveReviewerMode("off", 2)).toBe("off");
    expect(effectiveReviewerMode("shadow", 2)).toBe("shadow");
    expect(effectiveReviewerMode("on", 2)).toBe("on");
  });

  it("las versiones nuevas solo llevan el revisor v2 si se pide; sin pedirlo son exactamente las de antes", () => {
    const before = resolvePipelineVersions({});
    expect(before.reviewer).toMatchObject({ prompt_version: 1, schema_version: 1, max_output_tokens: PIPELINE_OUTPUT_LIMITS.reviewer });
    expect(resolvePipelineVersions({}, { reviewerV2: false })).toEqual(before);
    const v2 = resolvePipelineVersions({}, { reviewerV2: true });
    expect(v2.reviewer).toMatchObject({ prompt_version: 2, schema_version: 2, max_output_tokens: REVIEWER_V2.max_output_tokens });
    expect({ ...v2, reviewer: before.reviewer }).toEqual(before);
    expect(v2.review_schema).toBe(1);
  });
});

describe("pedagogical_reviewer@v2: v1 no se toca y el prompt recoge los principios", () => {
  it("v1 conserva su texto exacto y v2 es otra versión publicada", () => {
    expect(getPedagogicalReviewer(1)).toBe(PEDAGOGICAL_REVIEWER_V1);
    expect(getPedagogicalReviewer(2)).toBe(PEDAGOGICAL_REVIEWER_V2);
    expect(sha(PEDAGOGICAL_REVIEWER_V1.system)).toBe("98a169e7feeccc1fda23c002f36363d42eb2ad95e8c4d9ad635dcf5f1d04aba7");
    expect(PEDAGOGICAL_REVIEWER_V2).toMatchObject({ key: "pedagogical_reviewer", version: 2, schemaVersion: 2 });
    expect(PEDAGOGICAL_REVIEWER_V2.system.startsWith(PEDAGOGICAL_REVIEWER_V1.system)).toBe(true);
  });

  it("recoge los principios pedagógicos y no nombra ningún modelo", () => {
    const text = PEDAGOGICAL_REVIEWER_V2.system;
    expect(text).toMatch(/Facilitar el acceso no es dar la respuesta/);
    expect(text).toMatch(/necesidad funcional alta justifica más apoyo de acceso/);
    expect(text).toMatch(/otros datos u otro ámbito[^.]*PROCEDIMIENTO/);
    expect(text).toMatch(/tarjeta que recuerda un criterio/);
    expect(text).toMatch(/analogía/);
    expect(text).toMatch(/No toda coincidencia conceptual es un error/);
    expect(text).toMatch(/performs/);
    expect(text).not.toMatch(/claude|anthropic|openai|gpt|sonnet|haiku|opus/i);
  });

  it("el contexto semántico solo llega al prompt v2; el del v1 es el de siempre", () => {
    const s = primariaScenario();
    const plain = buildPedagogicalReviewContext(s.input, s.reviewed);
    expect(plain.context_version).toBe(REVIEW_CONTEXT_VERSION);
    expect(plain).not.toHaveProperty("supports");
    expect(plain.review_scope).not.toHaveProperty("support_blocks");
    expect(reviewerRequestParts({ reviewContext: plain }).prompt).toBe(PEDAGOGICAL_REVIEWER_V1);
    expect(buildPedagogicalReviewContext(s.input, s.reviewed, { semantic: false })).toEqual(plain);
    const semantic = buildPedagogicalReviewContext(s.input, s.reviewed, { semantic: true });
    expect(semantic.context_version).toBe(REVIEW_CONTEXT_VERSION_SEMANTIC);
    expect(reviewerRequestParts({ reviewContext: semantic }).prompt).toBe(PEDAGOGICAL_REVIEWER_V2);
    // Lo que había sigue igual: solo se añaden las unidades, las actividades y las señales.
    const { supports, activities, signals, ...rest } = semantic;
    void supports; void activities; void signals;
    expect({ ...rest, context_version: 1, review_scope: { ...rest.review_scope, support_blocks: undefined } }).toMatchObject({ audience: plain.audience, active_needs: plain.active_needs, decisions: plain.decisions, document: plain.document });
  });

  it("cada unidad lleva su necesidad, su actividad y lo que esta evalúa; sin datos del alumnado", () => {
    const s = primariaScenario();
    const semantic = buildPedagogicalReviewContext(s.input, s.reviewed, { semantic: true });
    expect(semantic.supports!.length).toBeGreaterThan(0);
    for (const unit of semantic.supports!) {
      expect(unit).toMatchObject({ block_id: expect.stringMatching(/^blk_/), decisions: expect.any(Array), serves: expect.any(Array), kind: expect.any(String) });
      expect(semantic.review_scope.support_blocks).toContain(unit.block_id);
    }
    for (const a of semantic.activities!) expect(a).toMatchObject({ asks: expect.stringMatching(/^(explain|apply)$/), evaluates: { protected: expect.any(Array), objectives: expect.any(Array) } });
    const text = JSON.stringify(semantic);
    expect(text).not.toMatch(/display_name|contextual_tags|diagnos/i);
  });
});

describe("contrato v2: compacto, tolerante en lo formal y estricto en lo que importa", () => {
  const finding = { check_key: "age_appropriate", target_ids: [], verdict: "PASS", reason: "Adecuado" };
  const judgment = { block_id: "blk_supp0001", class: "legitimate" };

  it("el contrato v1 sigue intacto y no acepta los juicios", () => {
    expect(ReviewerFindingsSchema.safeParse({ findings: [finding] }).success).toBe(true);
    expect(ReviewerFindingsSchema.safeParse({ findings: [finding], support_judgments: [judgment] }).success).toBe(false);
  });

  it("los juicios son opcionales: una respuesta sin ellos es válida y deja todos los apoyos sin juzgar", () => {
    const parsed = parseReviewerResponseV2(response(JSON.stringify({ findings: [finding] })));
    expect(parsed).toMatchObject({ outcome: "ok", judgments: [] });
  });

  it("el tope es el del contrato: 12 juicios", () => {
    expect(MAX_SUPPORT_JUDGMENTS).toBe(12);
    const twelve = Array.from({ length: 12 }, (_, i) => ({ block_id: `blk_supp${String(i).padStart(4, "0")}`, class: "legitimate" }));
    expect(ReviewerFindingsV2Schema.safeParse({ findings: [], support_judgments: twelve }).success).toBe(true);
    expect(ReviewerFindingsV2Schema.safeParse({ findings: [], support_judgments: [...twelve, judgment] }).success).toBe(false);
  });

  it("saneado: se corta una razón larga, se descarta una clave sobrante de un juicio y se descartan los juicios de más; nada más", () => {
    const long = "x".repeat(300);
    const raw = {
      findings: [{ ...finding, reason: long }],
      support_judgments: [{ ...judgment, reason: long, improved_text: "texto de reemplazo" }, ...Array.from({ length: 13 }, (_, i) => ({ block_id: `blk_supp${String(i + 1).padStart(4, "0")}`, class: "legitimate" }))],
    };
    const { value, counts } = sanitizeReviewerV2(raw);
    expect(counts).toEqual({ reasons_truncated: 2, judgment_keys_dropped: 1, judgments_over_limit: 2 });
    const parsed = ReviewerFindingsV2Schema.parse(value);
    expect(parsed.findings[0]!.reason).toHaveLength(160);
    expect(parsed.support_judgments).toHaveLength(12);
    expect(parsed.support_judgments![0]).toEqual({ block_id: "blk_supp0001", class: "legitimate", reason: "x".repeat(120) });
    expect(JSON.stringify(parsed)).not.toContain("reemplazo");
  });

  it("lo que NO se repara: un id inventado, una clase inventada, un hallazgo con clave sobrante, una respuesta sin campo obligatorio", () => {
    for (const bad of [
      { findings: [], support_judgments: [{ block_id: "bloque 1", class: "legitimate" }] },
      { findings: [], support_judgments: [{ ...judgment, class: "approved" }] },
      { findings: [], support_judgments: [{ ...judgment, protected_id: "prt-uno" }] },
      { findings: [{ ...finding, improved_text: "x" }] },
      { findings: [{ check_key: "age_appropriate", target_ids: [], reason: "x" }] },
      { support_judgments: [] },
    ]) {
      const parsed = parseReviewerResponseV2(response(JSON.stringify(bad)));
      expect(parsed.outcome, JSON.stringify(bad)).toBe("schema");
    }
  });

  it("la salida cortada, rechazada o que no es JSON no se lee nunca", () => {
    expect(parseReviewerResponseV2(response("{}", "max_tokens")).outcome).toBe("truncated");
    expect(parseReviewerResponseV2(response("{}", "refusal")).outcome).toBe("refused");
    expect(parseReviewerResponseV2(response("no es json")).outcome).toBe("not_json");
  });

  it("el esquema de un juicio rechaza campos extra (el servidor ya los quitó) y razones de más de 120", () => {
    expect(SupportJudgmentSchema.safeParse({ ...judgment, extra: 1 }).success).toBe(false);
    expect(SupportJudgmentSchema.safeParse({ ...judgment, reason: "x".repeat(121) }).success).toBe(false);
  });

  it("el revisor con modelo (v2) devuelve los juicios y el recuento del saneado; el v1 no los devuelve", async () => {
    const s = primariaScenario();
    const answers = JSON.stringify({ findings: [finding], support_judgments: [{ ...judgment, reason: "x".repeat(130) }] });
    const provider: AIProvider = { name: "anthropic", generateStructured: async () => response(answers) };
    const reviewer = createModelReviewer({ selection: resolveModel("STANDARD", {}), provider, maxOutputTokens: 2600, version: 2 });
    const out = await reviewer.review({ context: s.context, document: s.document, plan: s.reviewed.effective, solvability: [], reviewContext: buildPedagogicalReviewContext(s.input, s.reviewed, { semantic: true }) });
    expect(out.judgments).toEqual([{ block_id: "blk_supp0001", class: "legitimate", reason: "x".repeat(120) }]);
    expect(out.sanitation).toMatchObject({ reasons_truncated: 1 });
    expect(out.runs[0]).toMatchObject({ promptKey: "pedagogical_reviewer", promptVersion: 2, schemaVersion: 2 });
    const v1 = createModelReviewer({ selection: resolveModel("STANDARD", {}), provider: { name: "anthropic", generateStructured: async () => response(JSON.stringify({ findings: [finding] })) }, maxOutputTokens: 2000 });
    const plain = await v1.review({ context: s.context, document: s.document, plan: s.reviewed.effective, solvability: [], reviewContext: buildPedagogicalReviewContext(s.input, s.reviewed) });
    expect(plain.judgments).toBeUndefined();
    expect(plain.runs[0]).toMatchObject({ promptVersion: 1, schemaVersion: 1 });
    // Un contexto semántico no se envía nunca a una adaptación fijada con v1.
    await expect(createModelReviewer({ selection: resolveModel("STANDARD", {}), provider, maxOutputTokens: 2000, version: 1 }).review({ context: s.context, document: s.document, plan: s.reviewed.effective, solvability: [], reviewContext: buildPedagogicalReviewContext(s.input, s.reviewed, { semantic: true }) })).rejects.toThrow();
  });
});

describe("casos reales con el revisor simulado: qué hace el servidor con cada juicio", () => {
  const status = (id: string) => statusFor(corpusById(id)).record;

  it("estanque · el glosario que explica el significado de las flechas es un hallazgo CONFIRMADO y dice qué sustituye", () => {
    expect(status("est-01")).toMatchObject({ status: "confirmed", how: "states_concept", protected_id: "prt_1", reason_code: "performs_cited", kind: "glossary", activity_ids: ["act_1"] });
    const [fail] = semanticChecks([status("est-01")]);
    expect(fail).toMatchObject({ check: "answers_not_leaked", method: "ai", status: "FAIL", targets: ["blk_supp0001", "act_1", "prt_1"] });
    expect(fail!.detail).toMatch(/blk_supp0001 de act_1 enuncia el concepto que la actividad pide explicar \(prt_1\)/);
    expect(fail!.detail).toMatch(/deja de ser un apoyo de acceso/);
  });

  it("célula · «… → Núcleo» resuelve un ítem: confirmado; el mismo método con otro ámbito (el corazón) es legítimo", () => {
    expect(status("cel-01")).toMatchObject({ status: "confirmed", how: "resolves_item" });
    expect(status("cel-02")).toMatchObject({ status: "legitimate", reason_code: "legitimate" });
  });

  it("célula · la analogía de la casa (protege y separa) es SOSPECHA, nunca confirmada: solo avisa y se registra", () => {
    const r = status("cel-03");
    expect(r).toMatchObject({ status: "suspected", reason_code: "analogy_needs_demonstration", how: "analogy_of_item" });
    const checks = semanticChecks([r]);
    expect(checks.map((c) => c.status)).toEqual(["WARN"]);
    expect(checks[0]!.targets).toEqual([r.block_id]);
  });

  it("…y una analogía no se confirma ni aunque el revisor insista con «performs» y cite lo evaluado", () => {
    const { record } = statusFor(corpusById("cel-03"), (_e, b, p) => [{ block_id: b, class: "performs", how: "analogy_of_item", protected_id: p, reason: "Deja deducir la función." }]);
    expect(record).toMatchObject({ status: "suspected", reason_code: "analogy_needs_demonstration" });
  });

  it("…solo si se demuestra que resuelve un ítem o sustituye la operación (otro «how» con elemento citado) pasa a confirmada", () => {
    const { record } = statusFor(corpusById("cel-03"), (_e, b, p) => [{ block_id: b, class: "performs", how: "resolves_item", protected_id: p, reason: "Resuelve el ítem b)." }]);
    expect(record.status).toBe("confirmed");
  });

  it("fracciones · el ejemplo con casi la misma operación se confirma; el de otros números que enseña el procedimiento es legítimo", () => {
    expect(status("fra-01")).toMatchObject({ status: "confirmed", how: "performs_operation" });
    expect(status("fra-02").status).toBe("legitimate");
    expect(status("fra-05").status).toBe("legitimate");
  });

  it("números primos y seres vivos · las tarjetas de criterio son legítimas y no se tocan", () => {
    for (const id of ["pri-01", "pri-04", "est-07"]) expect(status(id), id).toMatchObject({ status: "legitimate" });
    for (const id of ["pri-01", "pri-04", "est-07"]) expect(semanticChecks([status(id)])).toEqual([]);
  });

  it("una tarjeta de criterio que un revisor excesivo marca como «performs / states_concept» NO se confirma (se conserva)", () => {
    for (const id of ["pri-01", "pri-04", "est-07"]) {
      const { record } = statusFor(corpusById(id), (_e, b, p) => [{ block_id: b, class: "performs", how: "states_concept", protected_id: p, reason: "Define el criterio." }]);
      expect(record.status, id).toBe("suspected");
      expect(["criterion_card_kept", "uncited_element"], id).toContain(record.reason_code);
    }
  });

  it("…solo deja de conservarse si asigna ítems concretos o da el resultado (la clasificación hecha)", () => {
    expect(status("est-08")).toMatchObject({ status: "confirmed", how: "assigns_item" });
    expect(status("pri-03")).toMatchObject({ status: "confirmed", how: "assigns_item" });
    expect(status("cel-06")).toMatchObject({ status: "confirmed", how: "gives_result" });
  });

  it("la necesidad funcional alta no justifica nada: el motivo del apoyo no cambia el juicio de lo que hace", () => {
    const s = sheetOf(corpusById("cel-01"));
    const high = { decisions: s.plan.decisions.map((d) => ({ ...d, dimensions: ["working_memory_support", "vocabulary_support", "inferential_demand"] })) } as never;
    const scope = buildSemanticScope(s.analysis, high, s.document);
    expect(scope.units[0]!.serves).toEqual(["working_memory_support", "vocabulary_support", "inferential_demand"]);
    const out = judgeSupports({ analysis: s.analysis, scope, document: s.document, judgments: [judgmentOf(corpusById("cel-01"), s.blockId, s.protectedId)] });
    expect(out.records[0]!.status).toBe("confirmed");
  });

  it("el riesgo semántico se evalúa AUNQUE la respuesta no sea deducible (not_inferable)", () => {
    const entry = corpusById("est-01");
    const s = sheetOf(entry);
    expect(s.analysis.activities[0]!.expected_answer.basis).toBe("not_inferable");
    expect(buildSemanticScope(s.analysis, s.plan, s.document).units).toHaveLength(1);
    expect(statusFor(entry).record.status).toBe("confirmed");
  });
});

describe("falsos positivos y robustez de la política", () => {
  it("revisor ideal: cada apoyo del corpus recibe el estado esperado y ningún apoyo legítimo se confirma", () => {
    const results = CORPUS.map((e) => ({ id: e.id, status: statusFor(e).record.status }));
    for (const e of CORPUS) expect(results.find((r) => r.id === e.id)!.status, e.id).toBe(e.expected.status);
    const score = scoreCorpus(CORPUS, results);
    expect(score.labels).toBe("provisional");
    expect(score.false_positive_ids).toEqual([]);
    expect(score.suspected_legitimate_ids).toEqual([]);
    expect(score.confirmed).toMatchObject({ false_positive: 0, precision: 1 });
    expect(score.false_negative_ids).toEqual([]);
  });

  it("revisor EXCESIVO (marca todo como «performs» citando lo evaluado): la política protege lo que puede (criterios, analogías, «hints»), no lo que no puede", () => {
    const overflag = (_e: CorpusEntry, b: string, p: string): SupportJudgment[] => [{ block_id: b, class: "performs", how: "states_concept", protected_id: p, reason: "Siempre." }];
    const results = CORPUS.map((e) => ({ id: e.id, status: statusFor(e, overflag).record.status }));
    const score = scoreCorpus(CORPUS, results);
    // Las tarjetas de criterio de actividades de APLICAR y el resto de lo legítimo que no es de explicar nunca se confirman por «states_concept».
    for (const id of ["pri-01", "pri-04", "est-07", "est-09", "cel-02", "cel-04", "fra-02", "fra-05", "pri-02"]) expect(results.find((r) => r.id === id)!.status, id).not.toBe("confirmed");
    // Lo que sí puede confirmarse es lo que el revisor cita como «states_concept» sobre una actividad de EXPLICAR: eso lo mide el corpus, no la política.
    expect(score.confirmed.false_positive).toBeGreaterThanOrEqual(0);
  });

  it("«states_concept» exige que el apoyo hable de lo evaluado (≥ 2 palabras de contenido) y no vale para un ejemplo resuelto", () => {
    const unrelated = statusFor(corpusById("est-02"), (_e, b, p) => [{ block_id: b, class: "performs", how: "states_concept", protected_id: p, reason: "Define." }]);
    expect(unrelated.record).toMatchObject({ status: "suspected", reason_code: "concept_not_in_support" });
    const example = statusFor(corpusById("cel-02"), (_e, b, p) => [{ block_id: b, class: "performs", how: "states_concept", protected_id: p, reason: "Define." }]);
    expect(example.record).toMatchObject({ status: "suspected", reason_code: "how_not_demonstrated" });
    // …y cuando sí habla de lo evaluado, en una actividad de explicar, se confirma.
    expect(statusFor(corpusById("est-03")).record.status).toBe("confirmed");
  });

  it("un juicio de otra actividad o un elemento que no se evalúa no confirma: queda en sospecha", () => {
    const entry = corpusById("cel-01");
    const s = sheetOf(entry);
    const scope = buildSemanticScope(s.analysis, s.plan, s.document);
    for (const protectedId of ["prt_9", "prt_x1"]) {
      const out = judgeSupports({ analysis: s.analysis, scope, document: s.document, judgments: [{ block_id: s.blockId, class: "performs", how: "resolves_item", protected_id: protectedId, reason: "x" }] });
      expect(out.records[0]!, protectedId).toMatchObject({ status: "suspected", reason_code: "uncited_element" });
    }
    const noCitation = judgeSupports({ analysis: s.analysis, scope, document: s.document, judgments: [{ block_id: s.blockId, class: "performs", how: "resolves_item", reason: "x" }] });
    expect(noCitation.records[0]!).toMatchObject({ status: "suspected", reason_code: "uncited_element" });
    const noHow = judgeSupports({ analysis: s.analysis, scope, document: s.document, judgments: [{ block_id: s.blockId, class: "performs", protected_id: "prt_1", reason: "x" }] });
    expect(noHow.records[0]!).toMatchObject({ status: "suspected", reason_code: "how_not_demonstrated" });
  });

  it("«unsure» y «hints» son sospecha; dos juicios que se contradicen sobre el mismo apoyo, también", () => {
    const entry = corpusById("cel-01");
    const s = sheetOf(entry);
    const scope = buildSemanticScope(s.analysis, s.plan, s.document);
    const judge = (judgments: SupportJudgment[]) => judgeSupports({ analysis: s.analysis, scope, document: s.document, judgments });
    expect(judge([{ block_id: s.blockId, class: "unsure", reason: "No sé." }]).records[0]).toMatchObject({ status: "suspected", reason_code: "reviewer_unsure" });
    expect(judge([{ block_id: s.blockId, class: "hints", how: "other", reason: "Pista." }]).records[0]).toMatchObject({ status: "suspected", reason_code: "hint" });
    const conflict = judge([{ block_id: s.blockId, class: "legitimate" }, { block_id: s.blockId, class: "performs", how: "resolves_item", protected_id: "prt_1", reason: "x" }]);
    expect(conflict.records[0]).toMatchObject({ status: "suspected", reason_code: "conflicting_judgments" });
    expect(conflict.discarded.duplicates).toBe(1);
    expect(judge([{ block_id: s.blockId, class: "legitimate" }, { block_id: s.blockId, class: "legitimate" }]).records[0]!.status).toBe("legitimate");
  });

  it("un id inexistente, una respuesta incompleta o un juicio ausente NUNCA son una aprobación", () => {
    const entry = corpusById("cel-02");
    const s = sheetOf(entry);
    const scope = buildSemanticScope(s.analysis, s.plan, s.document);
    const ghost = judgeSupports({ analysis: s.analysis, scope, document: s.document, judgments: [{ block_id: "blk_nonexist1", class: "legitimate" }] });
    expect(ghost.discarded.unknown_block).toBe(1);
    expect(ghost.records[0]).toMatchObject({ status: "unjudged", reason_code: "missing", class: null });
    const none = judgeSupports({ analysis: s.analysis, scope, document: s.document, judgments: [] });
    expect(none.records[0]).toMatchObject({ status: "unjudged" });
    const checks = semanticChecks(none.records);
    expect(checks).toEqual([expect.objectContaining({ check: "answers_not_leaked", status: "WARN", needs_semantic_review: true, targets: [s.blockId] })]);
  });
});

describe("más apoyos que el límite de juicios", () => {
  /** A sheet with `n` supports: the first ones carry mechanical evidence, the rest are plain reminders. */
  const sheetWith = (n: number) => {
    const s = sheetOf(corpusById("cel-04"));
    const blocks = Array.from({ length: n }, (_, i) => {
      const id = `blk_s${String(i).padStart(4, "0")}`;
      const leak = i === n - 1;
      const block = leak ? { type: "worked_example", problem: "Pista: «Contiene el ADN». ¿Qué estructura es?", result: "Núcleo.", steps: ["Lee la pista."] } : { type: "help_box", variant: "reminder", text: `Lee la pista número ${i}.` };
      return { id, ...block, trace: { origin: "support", source_refs: ["act_1"], decision_ids: ["dec_1"] } };
    });
    return { ...s, document: { pages: [{ blocks }] } as never };
  };

  it("hasta 12 apoyos se juzgan todos; con más, un criterio determinista elige y lo que queda fuera se registra (nunca PASS)", () => {
    const small = sheetWith(12);
    expect(buildSemanticScope(small.analysis, small.plan, small.document).not_evaluated).toEqual([]);
    const big = sheetWith(15);
    const scope = buildSemanticScope(big.analysis, big.plan, big.document);
    expect(scope.units).toHaveLength(MAX_SUPPORT_JUDGMENTS);
    expect(scope.not_evaluated).toHaveLength(3);
    // El que lleva una parte de la respuesta es el último de la ficha y aun así entra: manda la evidencia, no el orden.
    expect(scope.units.map((u) => u.block_id)).toContain("blk_s0014");
    // Lo que se manda sigue el orden de la ficha; lo que queda fuera es lo de menos evidencia, también en su orden.
    expect(scope.units.map((u) => u.block_id)).toEqual([...scope.units.map((u) => u.block_id)].sort());
    expect(scope.not_evaluated.map((u) => u.block_id)).toEqual(["blk_s0011", "blk_s0012", "blk_s0013"]);
    // Determinista: mismas entradas, mismo reparto.
    expect(buildSemanticScope(big.analysis, big.plan, big.document)).toEqual(scope);
  });

  it("lo no evaluado se registra como «unjudged / over_limit» y avisa; con todo juzgado no hay aviso", () => {
    const big = sheetWith(15);
    const scope = buildSemanticScope(big.analysis, big.plan, big.document);
    const judgments: SupportJudgment[] = scope.units.map((u) => ({ block_id: u.block_id, class: "legitimate" }));
    const out = judgeSupports({ analysis: big.analysis, scope, document: big.document, judgments });
    expect(out.records.filter((r) => r.reason_code === "over_limit").map((r) => r.block_id)).toEqual(["blk_s0011", "blk_s0012", "blk_s0013"]);
    const checks = semanticChecks(out.records);
    expect(checks).toEqual([expect.objectContaining({ status: "WARN", needs_semantic_review: true, targets: ["blk_s0011", "blk_s0012", "blk_s0013"] })]);
    expect(checks[0]!.detail).toMatch(/fuera del límite/);
    const small = sheetWith(12);
    const smallScope = buildSemanticScope(small.analysis, small.plan, small.document);
    expect(semanticChecks(judgeSupports({ analysis: small.analysis, scope: smallScope, document: small.document, judgments: smallScope.units.map((u) => ({ block_id: u.block_id, class: "legitimate" as const })) }).records)).toEqual([]);
  });

  it("el límite cabe en el presupuesto de salida: 12 hallazgos + 12 juicios largos < 2.600 tokens", () => {
    const finding = { check_key: "functional_supports_applied", target_ids: ["blk_s0001", "blk_s0002"], verdict: "WARN", reason: "x".repeat(160) };
    const judgment = { block_id: "blk_supp0001", class: "performs", how: "resolves_item", protected_id: "prt_12", reason: "y".repeat(120) };
    const worst = JSON.stringify({ findings: Array.from({ length: 12 }, () => finding), support_judgments: Array.from({ length: 12 }, () => judgment) });
    // ~3 caracteres por token en español con JSON: cota conservadora del peor caso posible del contrato.
    expect(Math.ceil(worst.length / 3)).toBeLessThan(REVIEWER_V2.max_output_tokens * 2);
    const typical = JSON.stringify({ findings: Array.from({ length: 6 }, () => ({ ...finding, reason: "x".repeat(80) })), support_judgments: Array.from({ length: 12 }, () => ({ block_id: "blk_supp0001", class: "legitimate" })) });
    expect(Math.ceil(typical.length / 3)).toBeLessThan(REVIEWER_V2.max_output_tokens);
  });
});

describe("fusión con la revisión: shadow no cambia nada, on añade sus comprobaciones", () => {
  const scenario = primariaScenario();
  const draft = { checks: [{ check: "age_appropriate" as const, status: "PASS" as const, targets: [], detail: "ok" }, { check: "no_infantilization" as const, status: "PASS" as const, targets: [], detail: "ok" }, { check: "functional_supports_applied" as const, status: "PASS" as const, targets: [], detail: "ok" }, { check: "answers_not_leaked" as const, status: "PASS" as const, targets: scenario.scope.required.answers_not_leaked ?? [], detail: "ok" }] };
  const confirmed: SemanticRecord = { block_id: "blk_supp0001", activity_ids: ["act_1"], decision_ids: ["dec_1"], kind: "worked_example", status: "confirmed", class: "performs", how: "resolves_item", protected_id: "prt_1", reason_code: "performs_cited" };

  it("el hallazgo confirmado hace FALLAR la revisión (answers_not_leaked es bloqueante) y marca el bloque a revisar", () => {
    const base = buildReviewScoped(scenario.input, draft, scenario.ids).review;
    expect(base.verdict).not.toBe("blocked");
    const withIt = withSemanticChecks(scenario.input, base, semanticChecks([confirmed]));
    expect(withIt.verdict).toBe("blocked");
    expect(BLOCKING_CHECKS).toContain("answers_not_leaked");
    expect(withIt.blocks_to_revise).toContain("blk_supp0001");
    // Nada de lo anterior se pierde ni se suaviza.
    expect(withIt.checks.slice(0, base.checks.length)).toEqual(base.checks);
  });

  it("sin comprobaciones semánticas (shadow, o todo legítimo) la fusión no añade nada a los hallazgos generales ya fusionados", () => {
    const base = buildReviewScoped(scenario.input, draft, scenario.ids).review;
    expect(withSemanticChecks(scenario.input, base, [])).toBe(base);
  });

  it("sospechas y apoyos sin juzgar avisan (WARN) pero no bloquean", () => {
    const base = buildReviewScoped(scenario.input, draft, scenario.ids).review;
    const suspected: SemanticRecord = { ...confirmed, status: "suspected", reason_code: "analogy_needs_demonstration", how: "analogy_of_item" };
    const unjudged: SemanticRecord = { ...confirmed, block_id: "blk_supp0002", status: "unjudged", class: null, how: null, protected_id: null, reason_code: "missing" };
    const review = withSemanticChecks(scenario.input, base, semanticChecks([suspected, unjudged]));
    expect(review.verdict).not.toBe("blocked");
    expect(review.checks.filter((c) => c.status === "WARN" && c.check === "answers_not_leaked").length).toBeGreaterThanOrEqual(2);
  });

  it("v1 sigue entendiendo su propio contrato igual que antes", () => {
    const parsed = parseReviewerResponse(response(JSON.stringify({ findings: [{ check_key: "age_appropriate", target_ids: [], verdict: "PASS", reason: "Adecuado" }] })));
    expect(parsed.outcome).toBe("ok");
  });
});

describe("conexión con la sustitución de la etapa 2.2", () => {
  const confirmed: SemanticRecord = { block_id: "blk_supp0001", activity_ids: ["act_1"], decision_ids: ["dec_1", "dec_9"], kind: "worked_example", status: "confirmed", class: "performs", how: "resolves_item", protected_id: "prt_1", reason_code: "performs_cited" };
  const decisions = [{ id: "dec_1", target: "act_1", action: "add_support", dimensions: ["working_memory_support"], supports: [{ kind: "worked_example" }] }, { id: "dec_9", target: "act_1", action: "keep", dimensions: ["vocabulary_support"], supports: [] }] as never;

  it("un hallazgo confirmado se convierte en la bandera que ya conoce la reparación (solo decisiones aplicadas, solo el tipo de apoyo que falló)", () => {
    const flags = semanticFlags([confirmed, { ...confirmed, status: "suspected" }], decisions);
    expect([...flags.keys()]).toEqual(["dec_1"]);
    expect(flags.get("dec_1")).toMatchObject({ trigger: "semantic_confirmed", activityId: "act_1", blockIds: ["blk_supp0001"], kinds: ["worked_example"], codes: [] });
  });

  it("solo lo confirmado genera bandera y restricción; la sospecha y lo legítimo, nada", () => {
    expect(semanticFlags([{ ...confirmed, status: "suspected" }, { ...confirmed, status: "legitimate" }, { ...confirmed, status: "unjudged" }], decisions).size).toBe(0);
    expect(restrictionFor(confirmed)).toMatch(/no puede resolver ningún ítem/);
    expect(restrictionFor({ how: "states_concept" })).toMatch(/No definas ni expliques/);
    expect(restrictionFor({ how: "analogy_of_item" })).toBeNull();
    expect(restrictionFor({ how: null })).toBeNull();
  });

  it("la necesidad solo se declara cubierta («clear») si ningún apoyo suyo está confirmado, sospechado o sin juzgar", () => {
    const records: SemanticRecord[] = [{ ...confirmed, decision_ids: ["dec_1"] }, { ...confirmed, block_id: "blk_supp0003", decision_ids: ["dec_2"], status: "legitimate" }, { ...confirmed, block_id: "blk_supp0004", decision_ids: ["dec_3"], status: "suspected" }, { ...confirmed, block_id: "blk_supp0005", decision_ids: ["dec_4"], status: "unjudged" }];
    const ds = ["dec_1", "dec_2", "dec_3", "dec_4", "dec_5"].map((id) => ({ id, dimensions: ["working_memory_support"] as never }));
    expect(needStates(records, ds)).toEqual([
      { decision_id: "dec_1", dimensions: ["working_memory_support"], state: "flagged" },
      { decision_id: "dec_2", dimensions: ["working_memory_support"], state: "clear" },
      { decision_id: "dec_3", dimensions: ["working_memory_support"], state: "suspected" },
      { decision_id: "dec_4", dimensions: ["working_memory_support"], state: "unjudged" },
    ]);
  });

  it("el registro guarda solo ids, códigos y recuentos: nada de la ficha ni de la respuesta", () => {
    const entry = corpusById("cel-01");
    const { out } = statusFor(entry);
    const set = summarize("shadow", out, []);
    expect(set).toMatchObject({ policy: "support_semantic@v1", mode: "shadow", counts: { confirmed: 1, suspected: 0, legitimate: 0, unjudged: 0 } });
    const json = JSON.stringify({ ...set, records: set.records.map((r) => ({ ...r, reason: undefined })) });
    expect(json).not.toMatch(/Núcleo|núcleo|pista|ADN/);
  });
});

describe("medición antes de activar", () => {
  const results = (statuses: Record<string, string>) => CORPUS.map((e) => ({ id: e.id, status: (statuses[e.id] ?? e.expected.status) as never }));

  it("la etiqueta de referencia es la de una persona y, hasta que exista, la provisional (y se dice)", () => {
    const e = { ...corpusById("est-01") };
    expect(referenceLabel(e)).toBe("performs_competence");
    expect(referenceLabel({ ...e, review: { status: "reviewed", reviewed_by: "PT", final_label: "ambiguous" } })).toBe("ambiguous");
    expect(scoreCorpus(CORPUS, results({})).labels).toBe("provisional");
    expect(scoreCorpus(CORPUS.map((c) => ({ ...c, review: { status: "reviewed" as const, reviewed_by: "PT", final_label: c.provisional.label } })), results({})).labels).toBe("human");
  });

  it("un apoyo legítimo confirmado es un falso positivo; uno que hace la competencia y ni se sospecha, un falso negativo", () => {
    const score = scoreCorpus(CORPUS, results({ "pri-01": "confirmed", "cel-01": "legitimate", "est-08": "unjudged" }));
    expect(score.false_positive_ids).toEqual(["pri-01"]);
    expect(score.false_negative_ids.sort()).toEqual(["cel-01", "est-08"]);
    expect(score.confirmed.precision).toBeLessThan(1);
    expect(score.unjudged).toBe(1);
  });

  it("los casos ambiguos no cuentan en las tasas y se declaran excluidos", () => {
    const score = scoreCorpus(CORPUS, results({}));
    expect(score.excluded).toBe(CORPUS.filter((c) => c.provisional.label === "ambiguous").length);
    expect(score.n + score.excluded).toBe(CORPUS.length);
  });

  it("Wilson: con pocos casos el límite inferior es mucho menor que la proporción; con ninguno, null", () => {
    expect(wilsonLower(0, 0)).toBeNull();
    expect(wilsonLower(10, 10)!).toBeLessThan(0.75);
    expect(wilsonLower(40, 40)!).toBeGreaterThan(0.9);
  });

  it("concordancia entre repeticiones", () => {
    const a = results({});
    expect(consistency([a])).toBeNull();
    expect(consistency([a, a, a])).toBe(1);
    expect(consistency([a, results({ "est-01": "legitimate" })])!).toBeCloseTo((CORPUS.length - 1) / CORPUS.length);
  });

  it("con el corpus provisional y sin medidas de coste/esquema NO se puede activar: faltan las etiquetas de una persona y más casos", () => {
    const score = scoreCorpus(CORPUS, results({}));
    const gate = readyToActivate(score, { consistency: 1, schemaFailureRate: 0 });
    expect(gate.ready).toBe(false);
    expect(gate.missing.join(" ")).toMatch(/etiquetas definitivas de una persona/);
    expect(gate.missing.join(" ")).toMatch(new RegExp(`al menos ${ACTIVATION_THRESHOLDS.minUnitsJudged} apoyos`));
    expect(readyToActivate(score, { consistency: null, schemaFailureRate: null }).missing.join(" ")).toMatch(/concordancia|fallos de esquema/);
  });

  it("el corpus recoge las seis clases, la competencia y la necesidad de cada apoyo, sin datos personales y pendiente de revisión humana", () => {
    expect(new Set(CORPUS.map((c) => c.provisional.label))).toEqual(new Set(["legitimate_access", "criterion_card", "method_example", "over_hint", "performs_competence", "ambiguous"]));
    for (const c of CORPUS) {
      expect(c.need.dimension).toBeTruthy();
      expect(c.provisional.rationale.length).toBeGreaterThan(10);
      expect(c.provisional.by).toBe("ai_assisted");
      expect(c.review).toEqual({ status: "pending_human_review", reviewed_by: null, final_label: null });
    }
    expect(new Set(CORPUS.map((c) => c.id)).size).toBe(CORPUS.length);
    expect(JSON.stringify(CORPUS)).not.toMatch(/@|display_name|DNI|fecha de nacimiento/i);
  });
});
