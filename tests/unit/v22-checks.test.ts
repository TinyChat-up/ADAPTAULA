import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { validatePlan } from "@/lib/adaptation/invariants";
import { approximateLeak } from "@/lib/adaptation/text";
import { auditAdaptation } from "@/lib/adaptation/v22/audit";
import { runV22Checks, type V22CheckId } from "@/lib/adaptation/v22/checks";
import type { DraftDecision } from "@/lib/schemas/adaptation-plan";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { Block, MaterialDocument } from "@/lib/schemas/material-document";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { PROFILES } from "../../evals/adaptation/scenarios";
import { allPreserved, decision, documentOf, mutate, planOf } from "./adaptation-helpers";
import { V22_PROFILES } from "./fixtures/v22-profiles";

function setup(profile: FunctionalProfile, decisions: DraftDecision[] = [], analysis: MaterialAnalysis = fractionsAnalysis()) {
  const { context, omitted } = buildAdaptationContext({ profile, education: { stage: "primaria", grade: null, subject: null }, analysis, adaptationType: "accessibility", policy: 2 });
  const plan = planOf(analysis, context, decisions);
  const document = documentOf(analysis, plan, context);
  return { analysis, context, omitted, plan, document, validation: validatePlan(plan, analysis, context) };
}

const onActivity = (ref: string) => (b: Block) => b.type === "activity" && b.trace.source_refs.includes(ref);
const withResponse = (doc: MaterialDocument, ref: string, response: Extract<Block, { type: "activity" }>["response"]) =>
  mutate(doc, onActivity(ref), (b) => (b.type === "activity" ? { ...b, response } : b));
const flagged = (findings: ReturnType<typeof runV22Checks>["findings"], check: V22CheckId) => findings.filter((f) => f.check === check && f.result === "flagged");

describe("P8 · espacios de respuesta (determinista)", () => {
  it("la ficha ensamblada actual no introduce diferencias entre espacios que el original trataba igual", () => {
    for (const p of ["A", "B", "C"] as const) {
      const s = setup(V22_PROFILES[p]);
      const p8 = runV22Checks(s).findings.filter((f) => f.check === "answer_space_homogeneity");
      expect(p8.map((f) => f.result)).toEqual(["clear"]);
    }
  });

  it("si el enunciado ya pide productos distintos (calcular frente a escribir), un espacio distinto no se marca", () => {
    const s = setup(V22_PROFILES.C);
    // act_3 calculates and act_2 writes: the original statements distinguish them, so grid vs lines is allowed.
    expect(flagged(runV22Checks(s).findings, "answer_space_homogeneity")).toEqual([]);
  });

  it("marca un tipo de espacio distinto entre actividades con el mismo espacio y el mismo producto", () => {
    const s = setup(V22_PROFILES.B);
    const document = withResponse(s.document, "act_5", { kind: "grid", rows: 6 });
    const p8 = flagged(runV22Checks({ ...s, document }).findings, "answer_space_homogeneity");
    expect(p8).toHaveLength(1);
    expect(p8[0]?.targets).toEqual(["act_2", "act_5"]);
    expect(p8[0]?.coverage).toBe("deterministic");
  });

  it("marca renglones que no conservan la proporción (sugieren la extensión esperada)", () => {
    const s = setup(V22_PROFILES.B);
    const document = withResponse(s.document, "act_2", { kind: "lines", lines: 6 });
    expect(flagged(runV22Checks({ ...s, document }).findings, "answer_space_homogeneity")[0]?.detail).toContain("proporción");
  });
});

describe("P2, P3, P4 y P7 · indicadores parciales", () => {
  it("P2: un término de glosario que el original no da se marca; uno que sí da, no", () => {
    const s = setup(V22_PROFILES.A);
    const vocab = (term: string): MaterialDocument =>
      mutate(s.document, onActivity("act_2"), (b) => ({ ...b, type: "vocabulary", items: [{ term, definition: "Definición breve de prueba." }] }) as Block);
    expect(flagged(runV22Checks({ ...s, document: vocab("denominador común") }).findings, "added_terms")).toHaveLength(1);
    const present = runV22Checks({ ...s, document: vocab("Fracciones equivalentes") }).findings.filter((f) => f.check === "added_terms");
    expect(present.map((f) => [f.result, f.coverage])).toEqual([["clear", "partial"]]);
  });

  it("P3: opciones de una misma pregunta con distinto formato", () => {
    const s = setup(V22_PROFILES.C);
    const choice = (texts: string[]) => withResponse(s.document, "act_4", { kind: "choice", multiple: false, options: texts.map((text, i) => ({ id: `o${i}`, text })) });
    expect(flagged(runV22Checks({ ...s, document: choice(["**1/4**", "1/2", "3/4"]) }).findings, "option_format")).toHaveLength(1);
    expect(flagged(runV22Checks({ ...s, document: choice(["1/4", "1/2", "3/4"]) }).findings, "option_format")).toEqual([]);
  });

  it("P4: tantos espacios como partes tiene la respuesta inferida, sin que el enunciado los pida", () => {
    const s = setup(V22_PROFILES.C);
    // «Ordena de menor a mayor» asks for one ordering; three lines reveal that there are three items to place.
    expect(flagged(runV22Checks({ ...s, document: withResponse(s.document, "act_4", { kind: "lines", lines: 3 }) }).findings, "slot_count")).toHaveLength(1);
    // «Escribe dos fracciones»: two lines are what the statement asks for, not a hint.
    expect(flagged(runV22Checks({ ...s, document: withResponse(s.document, "act_2", { kind: "lines", lines: 2 }) }).findings, "slot_count")).toEqual([]);
  });

  it("P7: un recurso añadido sobre un punto dudoso del original se marca para preguntar", () => {
    const s = setup(V22_PROFILES.A, [decision({ target: "act_2", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], preserves: allPreserved(fractionsAnalysis(), "act_2") })]);
    const context = { ...s.context, material: { ...s.context.material, ambiguous_targets: ["act_2"] } };
    expect(flagged(runV22Checks({ ...s, context }).findings, "ambiguous_target")).toHaveLength(1);
    expect(flagged(runV22Checks(s).findings, "ambiguous_target")).toEqual([]);
  });
});

describe("límite de palabras, medios y fugas aproximadas", () => {
  it("límite del perfil en cada trozo de instrucción, con la actividad afectada", () => {
    const s = setup(V22_PROFILES.A);
    const long = "Observa con mucha atención las dos tiras de fracciones del dibujo y después escribe en los renglones dos fracciones equivalentes a un medio.";
    const document = mutate(s.document, onActivity("act_2"), (b) => (b.type === "activity" ? { ...b, prompt: long } : b));
    const audit = runV22Checks({ ...s, document });
    expect(audit.overLimit).toEqual(["act_2"]);
    expect(runV22Checks(s).overLimit).toEqual([]);
  });

  it("una respuesta con teclado sin permiso, u oral, queda condicionada a medios que no constan", () => {
    const keyboard = decision({ target: "act_5", action: "change_response_format", strategies: ["response_format"], dimensions: ["writing_amount"], response_target: "keyboard", preserves: allPreserved(fractionsAnalysis(), "act_5") });
    expect(flagged(runV22Checks(setup(V22_PROFILES.B, [keyboard])).findings, "conditional_means")).toHaveLength(1);
    expect(flagged(runV22Checks(setup(PROFILES.writingReduction, [keyboard])).findings, "conditional_means")).toEqual([]);
  });

  it("una respuesta textual inferida reformulada en una nota del plan o en la ficha", () => {
    const analysis = fractionsAnalysis();
    analysis.activities[4]!.expected_answer = { basis: "inferred", value: "Ambas representan la misma parte del todo" };
    const note = "Recordar que las dos fracciones representan la misma parte: ambas cubren todo el rectángulo";
    const s = setup(V22_PROFILES.A, [decision({ target: "act_5", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], preserves: allPreserved(analysis, "act_5"), note })], analysis);
    expect(flagged(runV22Checks(s).findings, "approximate_leak").map((f) => f.targets)).toContainEqual(["act_5"]);
  });

  it("lo que ya dice el original no es una fuga; tampoco una respuesta de una sola palabra de contenido", () => {
    expect(approximateLeak("las partes son iguales en la unidad", "partes iguales", "Partes iguales de una unidad")).toBe(false);
    expect(approximateLeak("es la mitad", "mitad", "")).toBe(false);
    expect(approximateLeak("iguales son las partes de la figura", "partes iguales", "")).toBe(true);
  });
});

describe("auditoría V2.2: registro + validadores, sin cambiar nada", () => {
  it("no modifica el plan, el análisis, el contexto ni la ficha", () => {
    const s = setup(V22_PROFILES.B, [decision({ target: "act_5", action: "add_support", strategies: ["planning_support"], dimensions: ["writing_amount"] })]);
    const before = structuredClone({ plan: s.plan, analysis: s.analysis, context: s.context, document: s.document, validation: s.validation });
    auditAdaptation(s);
    expect({ plan: s.plan, analysis: s.analysis, context: s.context, document: s.document, validation: s.validation }).toEqual(before);
  });

  it("los hallazgos llegan a la prueba de pista del registro y P1, P5 y P6 siguen pendientes", () => {
    const d = decision({ target: "act_5", action: "change_response_format", strategies: ["response_format"], dimensions: ["writing_amount"], response_target: "write_text_short", preserves: allPreserved(fractionsAnalysis(), "act_5") });
    const s = setup(V22_PROFILES.B, [d]);
    const document = withResponse(s.document, "act_5", { kind: "grid", rows: 6 });
    const { ledger, not_checked } = auditAdaptation({ ...s, document, profile: V22_PROFILES.B, omitted: s.omitted });
    const hint = Object.fromEntries(ledger.decisions[0]!.hint_test.map((h) => [h.question, h.result]));
    expect(hint).toMatchObject({ P1: "pending_review", P5: "pending_review", P6: "pending_review", P8: "flagged" });
    expect(not_checked.join(" ")).toContain("P1, P5 y P6");
  });

  it("sin ficha ensamblada, lo que depende de ella se declara no comprobado", () => {
    const s = setup(V22_PROFILES.A, [decision({ target: "act_2", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], preserves: allPreserved(fractionsAnalysis(), "act_2") })]);
    const { ledger, not_checked } = auditAdaptation({ ...s, document: undefined });
    expect(not_checked.join(" ")).toContain("sin ficha ensamblada");
    expect(ledger.decisions[0]!.hint_test.find((h) => h.question === "P8")?.result).toBe("pending_review");
  });

  it("una instrucción por encima del límite queda como barrera residual demostrable", () => {
    const s = setup(V22_PROFILES.A);
    const long = "Observa con mucha atención las dos tiras de fracciones del dibujo y después escribe en los renglones dos fracciones equivalentes a un medio.";
    const document = mutate(s.document, onActivity("act_2"), (b) => (b.type === "activity" ? { ...b, prompt: long } : b));
    expect(auditAdaptation({ ...s, document }).ledger.residual_barriers).toContainEqual({ activity: "act_2", dimension: null, evidence: "instruction_over_limit", decision_id: null });
  });
});
