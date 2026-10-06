import { describe, expect, it } from "vitest";
import { buildReview, checkOf, mergeAiChecks, verdictOf, deterministicChecks } from "@/lib/adaptation/review";
import { allBlocks } from "@/lib/schemas/material-document";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { PROFILES } from "../../evals/adaptation/scenarios";
import { adapted, allPreserved, contextFor, decision, documentOf, firstActivityBlock, mutate, planOf, segment, statusOf } from "./adaptation-helpers";

const geo = geographyAnalysis();
const bach = argumentationAnalysis();
const frac = fractionsAnalysis();

describe("a literal document (nothing changed) passes every deterministic check", () => {
  it("copies the original faithfully: data, conditions, answer areas, admin labels; no inferred answer anywhere", () => {
    const ctx = contextFor(geo, PROFILES.language);
    const plan = planOf(geo, ctx, []);
    const doc = documentOf(geo, plan, ctx);
    const review = buildReview({ analysis: geo, plan, context: ctx, document: doc });
    for (const c of review.checks.filter((x) => x.method === "deterministic" && x.check !== "functional_supports_applied")) expect(c.status, `${c.check}: ${c.detail}`).toBe("PASS");
    expect(doc.admin_fields).toEqual([{ type: "student_name", label: "Nombre y apellidos" }, { type: "date", label: "Fecha" }]);
    expect(doc.answer_key).toEqual([]);
    expect(firstActivityBlock(doc, "act_5")).toMatchObject({ response: { kind: "lines", lines: 5 } });
  });

  it("chart series names from the analysis are never shown automatically (they may be inferred)", () => {
    const ctx = contextFor(geo, PROFILES.language);
    const charts = allBlocks(documentOf(geo, planOf(geo, ctx, []), ctx)).filter((b) => b.type === "chart");
    expect(charts).toHaveLength(2);
    expect(charts.flatMap((c) => (c.type === "chart" ? c.series.map((s) => s.label) : []))).toEqual([null, null]);
  });
});

describe("answers are never revealed", () => {
  const ctx = contextFor(geo, PROFILES.executive);
  const plan = planOf(geo, ctx, [decision({ target: "act_1", action: "add_support", strategies: ["working_memory_support"], dimensions: ["working_memory_support"], supports: [{ kind: "reminder", uses_task_data: false }] })]);
  const withHelp = (text: string) =>
    documentOf(geo, plan, ctx, segment("act_1", "dec_1", [{ id: "h", type: "help_box", variant: "reminder", text, trace: { origin: "support", source_refs: ["act_1"], decision_ids: ["dec_1"] } }]));

  it("4/16 · a support that contains the inferred answer FAILS answers_not_leaked and blocks delivery", () => {
    const leaked = withHelp("Pista: la población creció en 7.100 habitantes.");
    const review = buildReview({ analysis: geo, plan, context: ctx, document: leaked });
    expect(checkOf(review, "answers_not_leaked")).toMatchObject({ status: "FAIL" });
    expect(review.verdict).toBe("blocked");
    expect(review.blocks_to_revise).toHaveLength(1);
  });

  it("the same number written another way, or a percentage of the answer, is also caught", () => {
    expect(statusOf(geo, plan, ctx, withHelp("Recuerda que 7100 personas son muchas."), "answers_not_leaked").status).toBe("FAIL");
    expect(statusOf(geo, plan, ctx, withHelp("Alrededor del 15.7 %."), "answers_not_leaked").status).toBe("FAIL");
  });

  it("data printed in the material are not a leak (the table values may be repeated in a reminder)", () => {
    expect(statusOf(geo, plan, ctx, withHelp("Usa los datos de 2012 (45.200) y 2022 (52.300)."), "answers_not_leaked").status).toBe("PASS");
  });

  it("the inferred answer of a percentage-point difference is caught (28 and «10 puntos»)", () => {
    const plan3 = planOf(geo, ctx, [decision({ target: "act_3", action: "add_support", strategies: ["working_memory_support"], dimensions: ["working_memory_support"], supports: [{ kind: "reminder", uses_task_data: false }] })]);
    const doc = documentOf(geo, plan3, ctx, segment("act_3", "dec_1", [{ id: "h", type: "help_box", variant: "tip", text: "A pie y bicicleta suman 28 %.", trace: { origin: "support", source_refs: ["act_3"], decision_ids: ["dec_1"] } }]));
    expect(statusOf(geo, plan3, ctx, doc, "answers_not_leaked").status).toBe("FAIL");
  });

  it("a fraction answer (3/5) in a worked example is a leak; an analogous example is not", () => {
    const fctx = contextFor(frac, { ...PROFILES.reading, supports: { worked_examples: "high" } });
    const fplan = planOf(frac, fctx, [decision({ target: "act_3", action: "add_support", strategies: ["worked_example"], dimensions: ["worked_examples"], supports: [{ kind: "worked_example", uses_task_data: false }] })]);
    const doc = (result: string) =>
      documentOf(frac, fplan, fctx, segment("act_3", "dec_1", [{ id: "w", type: "worked_example", problem: "Calcula 1/7 + 3/7.", steps: ["Se suman los numeradores."], result, trace: { origin: "support", source_refs: ["act_3"], decision_ids: ["dec_1"] } }]));
    // No leak found; the ordering answer (1/4, 1/2, 3/4) only has numbers already printed on the sheet, so it cannot be excluded by matching.
    expect(statusOf(frac, fplan, fctx, doc("4/7"), "answers_not_leaked")).toMatchObject({ status: "WARN", needs_semantic_review: true });
    expect(statusOf(frac, fplan, fctx, doc("3/5"), "answers_not_leaked").status).toBe("FAIL");
  });
});

describe("data, conditions and units survive the generation", () => {
  const ctx = contextFor(geo, PROFILES.executive);
  const seg4 = decision({ target: "act_4", action: "segment", strategies: ["task_sequencing"], dimensions: ["instruction_chunking"], preserves: allPreserved(geo, "act_4") });
  const plan = planOf(geo, ctx, [seg4]);
  const act4 = (prompt: string, steps: string[], requirements?: string[]) =>
    documentOf(geo, plan, ctx, segment("act_4", "dec_1", [{ id: "a", type: "activity", label: "4", prompt, steps, requirements, response: { kind: "lines", lines: 3 }, trace: adapted("act_4", "dec_1") }]));

  it("3 · segmenting into steps keeps every condition → PASS", () => {
    const doc = act4("El ayuntamiento quiere reducir el uso del coche en 8 puntos porcentuales.", ["Condición: sin reducir el número total de desplazamientos.", "Propón una medida concreta.", "Explica qué dato de los documentos la apoya."]);
    expect(statusOf(geo, plan, ctx, doc, "constraints_preserved").status).toBe("PASS");
    expect(statusOf(geo, plan, ctx, doc, "instructions_complete").status).toBe("PASS");
  });

  it("15 · losing «sin reducir el número total de desplazamientos» FAILS (the problem changes)", () => {
    const doc = act4("El ayuntamiento quiere reducir el uso del coche en 8 puntos porcentuales.", ["Propón una medida concreta.", "Explica qué dato de los documentos la apoya."]);
    const c = statusOf(geo, plan, ctx, doc, "constraints_preserved");
    expect(c.status).toBe("FAIL");
    expect(c.detail).toMatch(/sin reducir/);
  });

  it("losing the 8 points of the target FAILS too (a datum of the statement)", () => {
    const doc = act4("El ayuntamiento quiere reducir el uso del coche.", ["Sin reducir el número total de desplazamientos.", "Propón una medida concreta y explica qué dato de los documentos la apoya."]);
    expect(statusOf(geo, plan, ctx, doc, "instructions_complete").status).toBe("FAIL");
  });

  it("5 · a changed table cell FAILS required_data_preserved", () => {
    const literal = documentOf(geo, planOf(geo, ctx, []), ctx);
    const altered = mutate(literal, (b) => b.type === "table", (b) => (b.type === "table" ? { ...b, rows: [["Habitantes", "45.200", "48.900", "52.000"]] } : b));
    expect(statusOf(geo, planOf(geo, ctx, []), ctx, altered, "required_data_preserved").status).toBe("FAIL");
  });

  it("6 · replacing «puntos porcentuales» by «por ciento» FAILS (the magnitude is what is assessed)", () => {
    const plan3 = planOf(geo, ctx, [decision({ target: "act_3", action: "rephrase", strategies: ["instruction_clarification"], dimensions: ["instruction_chunking"], preserves: allPreserved(geo, "act_3") })]);
    const doc = documentOf(geo, plan3, ctx, segment("act_3", "dec_1", [{ id: "a", type: "activity", label: "3", prompt: "Compara el uso del coche con la movilidad activa (a pie + bicicleta). ¿Qué diferencia hay, en por ciento?", response: { kind: "lines", lines: 2 }, trace: adapted("act_3", "dec_1") }]));
    expect(statusOf(geo, plan3, ctx, doc, "constraints_preserved").status).toBe("FAIL");
  });

  it("7 · a necessary chart missing from the document FAILS protected and required-data checks", () => {
    const literal = documentOf(geo, planOf(geo, ctx, []), ctx);
    const noChart = mutate(literal, (b) => b.type === "chart" && b.trace.source_refs.includes("vis_2"), () => null);
    expect(statusOf(geo, planOf(geo, ctx, []), ctx, noChart, "required_data_preserved").status).toBe("FAIL");
    expect(statusOf(geo, planOf(geo, ctx, []), ctx, noChart, "protected_elements_preserved").status).toBe("FAIL");
  });
});

describe("writing requirements and extension", () => {
  const ctx = contextFor(bach, PROFILES.executive);
  const plan = planOf(bach, ctx, [decision({ target: "act_5", action: "segment", strategies: ["task_sequencing"], dimensions: ["instruction_chunking"], preserves: allPreserved(bach, "act_5") })]);
  const act5 = (steps: string[]) =>
    documentOf(bach, plan, ctx, segment("act_5", "dec_1", [{ id: "a", type: "activity", label: "5", prompt: "Redacta un texto argumentativo de 150-180 palabras sobre esta cuestión: «¿Deberían las bibliotecas abrir también por la noche?».", steps, response: { kind: "lines", lines: 12 }, trace: adapted("act_5", "dec_1") }]));

  it("17 · losing «al menos dos argumentos» FAILS; keeping it (even as «como mínimo 2») passes", () => {
    expect(statusOf(bach, plan, ctx, act5(["Escribe tu tesis.", "Escribe una conclusión."]), "constraints_preserved").status).toBe("FAIL");
    expect(statusOf(bach, plan, ctx, act5(["Escribe tu tesis.", "Da como mínimo 2 argumentos.", "Cierra con una conclusión."]), "constraints_preserved").status).toBe("PASS");
  });

  it("2 · an evaluated writing task turned into a choice FAILS response_format_appropriate", () => {
    const literal = documentOf(bach, planOf(bach, ctx, []), ctx);
    const closed = mutate(literal, (b) => b.type === "activity" && b.trace.source_refs.includes("act_5"), (b) => (b.type === "activity" ? { ...b, response: { kind: "choice", options: [{ id: "a", text: "Sí" }, { id: "b", text: "No" }], multiple: false } } : b));
    expect(statusOf(bach, planOf(bach, ctx, []), ctx, closed, "response_format_appropriate").status).toBe("FAIL");
  });

  it("18 · an essential extension changed by an authorised decision is a WARN; changed without one, a FAIL", () => {
    const strict = structuredClone(frac);
    strict.protected_elements = strict.protected_elements.map((p) => (p.value === "Explicar en 3 líneas" ? { ...p, importance: "essential" as const } : p));
    const fctx = contextFor(strict, PROFILES.writingReduction);
    const authorised = planOf(strict, fctx, [decision({ target: "act_5", action: "change_response_format", strategies: ["writing_load_reduction"], dimensions: ["writing_amount"], response_target: "write_text_short", preserves: allPreserved(strict, "act_5") })]);
    const shorter = (plan: typeof authorised, decisionId: string | null) =>
      decisionId
        ? documentOf(strict, plan, fctx, segment("act_5", decisionId, [{ id: "a", type: "activity", label: "5", prompt: "Explica en 1 línea cómo sabes que 2/4 y 1/2 son equivalentes.", response: { kind: "lines", lines: 1 }, trace: adapted("act_5", decisionId) }]))
        : mutate(documentOf(strict, plan, fctx), (b) => b.type === "activity" && b.trace.source_refs.includes("act_5"), (b) => (b.type === "activity" ? { ...b, prompt: "Explica en 1 línea cómo sabes que 2/4 y 1/2 son equivalentes." } : b));
    expect(statusOf(strict, authorised, fctx, shorter(authorised, "dec_1"), "constraints_preserved").status).toBe("WARN");
    const none = planOf(strict, fctx, []);
    expect(statusOf(strict, none, fctx, shorter(none, null), "constraints_preserved").status).toBe("FAIL");
  });

  it("15 · an essential protected reference (the connector «No obstante») removed from its activity FAILS", () => {
    const literal = documentOf(bach, planOf(bach, ctx, []), ctx);
    const lost = mutate(literal, (b) => b.type === "activity" && b.trace.source_refs.includes("act_3"), (b) => (b.type === "activity" ? { ...b, prompt: "Explica qué relación introduce el conector del tercer párrafo." } : b));
    expect(statusOf(bach, planOf(bach, ctx, []), ctx, lost, "protected_elements_preserved").status).toBe("FAIL");
  });

  it("12 · a paraphrased source text FAILS required_data_preserved; segmenting it literally passes", () => {
    const rctx = contextFor(bach, PROFILES.reading);
    const segPlan = planOf(bach, rctx, [decision({ target: "ctt_1", action: "segment", strategies: ["text_segmentation"], dimensions: ["reading_chunk_size"], preserves: allPreserved(bach, "ctt_1") })]);
    const paragraphs = bach.texts[0]!.text.split(/\n\s*\n/);
    const literal = documentOf(bach, segPlan, rctx, segment("ctt_1", "dec_1", [{ id: "t", type: "reading_text", paragraphs, literal: true, segment_labels: paragraphs.map((_, i) => `Parte ${i + 1}`), trace: adapted("ctt_1", "dec_1") }]));
    expect(statusOf(bach, segPlan, rctx, literal, "required_data_preserved").status).toBe("PASS");
    const summary = documentOf(bach, segPlan, rctx, segment("ctt_1", "dec_1", [{ id: "t", type: "reading_text", paragraphs: ["Las bibliotecas siguen siendo útiles en la era digital."], literal: false, trace: adapted("ctt_1", "dec_1") }]));
    expect(statusOf(bach, segPlan, rctx, summary, "required_data_preserved").status).toBe("FAIL");
  });
});

describe("load, supports and age", () => {
  it("9 · a visual-load profile removes decoration from the document and the load check passes", () => {
    const ctx = contextFor(geo, PROFILES.visualLoad);
    const plan = planOf(geo, ctx, []);
    const doc = documentOf(geo, plan, ctx);
    expect(ctx.presentation).toMatchObject({ decoration: "none", spacing: "wide" });
    expect(allBlocks(doc).some((b) => b.type === "image" && b.source.kind === "original" && b.source.visual_ref === "vis_4")).toBe(false);
    expect(statusOf(geo, plan, ctx, doc, "visual_load_reasonable").status).toBe("PASS");
  });

  it("8 · keeping a decorative image against a visual-load need is a WARN", () => {
    const ctx = contextFor(geo, PROFILES.visualLoad);
    const loose = { ...ctx, presentation: { ...ctx.presentation, decoration: "reduced" as const } };
    const plan = planOf(geo, loose, []);
    expect(statusOf(geo, plan, loose, documentOf(geo, plan, loose), "visual_load_reasonable").status).toBe("WARN");
  });

  it("13 · Bachillerato: condescending wording or emojis FAIL; a childish illustration is a WARN; Primaria only warns", () => {
    const ctx = contextFor(bach, PROFILES.executive);
    const plan = planOf(bach, ctx, [decision({ target: "document", action: "add_support", strategies: ["self_regulation"], dimensions: ["checklist_support"], supports: [{ kind: "self_check", uses_task_data: false }] })]);
    const docWith = (block: Record<string, unknown>) => documentOf(bach, plan, ctx, segment("document", "dec_1", [{ id: "x", trace: { origin: "support", source_refs: [], decision_ids: ["dec_1"] }, ...block } as never]));
    expect(statusOf(bach, plan, ctx, docWith({ type: "help_box", variant: "tip", text: "¡Muy bien, campeón! Sigue así 😊" }), "no_infantilization").status).toBe("FAIL");
    expect(statusOf(bach, plan, ctx, docWith({ type: "image", source: { kind: "requested", decision_id: "dec_1", purpose: "Motivar", style: "illustration" }, alt_text: "Dibujo" }), "no_infantilization").status).toBe("WARN");
    expect(statusOf(bach, plan, ctx, docWith({ type: "checklist", items: ["Mi tesis está en el primer párrafo.", "Doy al menos dos argumentos."] }), "no_infantilization").status).toBe("PASS");
    const fctx = contextFor(frac, PROFILES.executive);
    const fplan = planOf(frac, fctx, [decision({ target: "document", action: "add_support", strategies: ["self_regulation"], dimensions: ["checklist_support"], supports: [{ kind: "self_check", uses_task_data: false }] })]);
    const fdoc = documentOf(frac, fplan, fctx, segment("document", "dec_1", [{ id: "x", type: "help_box", variant: "tip", text: "¡Muy bien, campeón!", trace: { origin: "support", source_refs: [], decision_ids: ["dec_1"] } }]));
    expect(statusOf(frac, fplan, fctx, fdoc, "no_infantilization").status).toBe("WARN");
  });

  it("instructions longer than the profile's word limit are a reading-load WARN", () => {
    const ctx = contextFor(geo, { ...PROFILES.executive, limits: { max_instruction_words: 8 } });
    const plan = planOf(geo, ctx, []);
    expect(statusOf(geo, plan, ctx, documentOf(geo, plan, ctx), "reading_load_reasonable").status).toBe("WARN");
  });
});

describe("19 · traceability: original → decision → block", () => {
  const ctx = contextFor(geo, PROFILES.executive);
  const plan = planOf(geo, ctx, [decision({ target: "act_5", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], supports: [{ kind: "planner", uses_task_data: false }] })]);
  const doc = documentOf(geo, plan, ctx, segment("act_5", "dec_1", [{ id: "p", type: "planner", slots: [{ label: "Idea principal", lines: 2 }], trace: { origin: "support", source_refs: ["act_5"], decision_ids: ["dec_1"] } }]));

  it("a complete document passes; every block points to the analysis or to a decision", () => {
    expect(statusOf(geo, plan, ctx, doc, "traceability_complete").status).toBe("PASS");
    expect(allBlocks(doc).every((b) => b.trace.origin === "structure" || b.trace.source_refs.length > 0 || b.trace.decision_ids.length > 0)).toBe(true);
  });

  it("a support without its decision, or a missing activity, FAILS; a decision without blocks is a WARN", () => {
    const orphan = mutate(doc, (b) => b.type === "planner", (b) => ({ ...b, trace: { origin: "support", source_refs: ["act_5"], decision_ids: [] } }));
    expect(statusOf(geo, plan, ctx, orphan, "traceability_complete").status).toBe("FAIL");
    const missing = mutate(doc, (b) => b.type === "activity" && b.trace.source_refs.includes("act_2"), () => null);
    expect(statusOf(geo, plan, ctx, missing, "traceability_complete").status).toBe("FAIL");
    expect(statusOf(geo, plan, ctx, mutate(doc, (b) => b.type === "planner", () => null), "traceability_complete").status).toBe("WARN");
  });

  it("a support block written for an activity traces back to it even if the generator forgot the source", () => {
    const forgot = documentOf(geo, plan, ctx, segment("act_5", "dec_1", [{ id: "p", type: "planner", slots: [{ label: "Idea", lines: 2 }], trace: { origin: "support", source_refs: [], decision_ids: [] } }]));
    expect(allBlocks(forgot).find((b) => b.type === "planner")!.trace).toMatchObject({ source_refs: ["act_5"], decision_ids: ["dec_1"] });
  });
});

describe("AI review never softens a deterministic result", () => {
  const ctx = contextFor(geo, PROFILES.language);
  const plan = planOf(geo, ctx, []);
  const doc = documentOf(geo, plan, ctx);
  const input = { analysis: geo, plan, context: ctx, document: doc };

  it("fills the AI checks, adds its findings to hybrid ones, ignores attempts on deterministic ones", () => {
    const merged = mergeAiChecks(deterministicChecks(input), {
      checks: [
        { check: "age_appropriate", status: "PASS", targets: [], detail: "Adecuado a 3.º ESO" },
        { check: "no_infantilization", status: "WARN", targets: [], detail: "Un tono algo condescendiente" },
      ],
    });
    expect(merged.find((c) => c.check === "age_appropriate")).toMatchObject({ method: "ai", status: "PASS" });
    expect(checkOf({ checks: merged }, "no_infantilization").status).toBe("WARN");
    expect(checkOf({ checks: merged }, "answers_not_leaked").status).toBe("PASS");
  });

  it("verdict: blocking FAIL → blocked; other FAIL → needs_revision; WARN → approved_with_warnings; a teacher override is honoured", () => {
    const base = deterministicChecks(input).map((c) => ({ ...c, status: "PASS" as const }));
    expect(verdictOf(base)).toBe("approved");
    expect(verdictOf(base.map((c) => (c.check === "answers_not_leaked" ? { ...c, status: "FAIL" } : c)))).toBe("blocked");
    expect(verdictOf(base.map((c) => (c.check === "reading_load_reasonable" ? { ...c, status: "FAIL" } : c)))).toBe("needs_revision");
    expect(verdictOf(base.map((c) => (c.check === "visual_load_reasonable" ? { ...c, status: "WARN" } : c)))).toBe("approved_with_warnings");
    expect(verdictOf(base.map((c) => (c.check === "visual_load_reasonable" ? { ...c, status: "WARN", teacher_override: { accepted: true } } : c)))).toBe("approved");
  });
});
