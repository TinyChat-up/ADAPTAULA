import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { activitiesOf, buildDecisionLedger } from "@/lib/adaptation/decision-ledger";
import { validatePlan } from "@/lib/adaptation/invariants";
import { hintTest } from "@/lib/adaptation/v22/hint-test";
import type { DraftDecision } from "@/lib/schemas/adaptation-plan";
import { DecisionLedgerSchema } from "@/lib/schemas/decision-ledger";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import { allPreserved, decision, planOf } from "./adaptation-helpers";
import { V22_PROFILES } from "./fixtures/v22-profiles";

function ledgerFor(analysis: MaterialAnalysis, profile: FunctionalProfile, decisions: DraftDecision[]) {
  const { context, omitted } = buildAdaptationContext({ profile, education: { stage: "primaria", grade: null, subject: null }, analysis, adaptationType: "accessibility" });
  const plan = planOf(analysis, context, decisions);
  const validation = validatePlan(plan, analysis, context);
  return { ledger: buildDecisionLedger({ plan, validation, context, analysis, omitted, profile }), context, plan };
}

const frac = fractionsAnalysis();

describe("registro de decisiones (ADR-044)", () => {
  it("perfil C: sin necesidades, sin decisiones y sin barreras inventadas; «sin valorar» no es «no necesita»", () => {
    const { ledger } = ledgerFor(frac, V22_PROFILES.C, []);
    expect(DecisionLedgerSchema.parse(ledger)).toEqual(ledger);
    expect(ledger.decisions).toEqual([]);
    expect(ledger.needs).toEqual([]);
    expect(ledger.activities.every((a) => a.intervention === "none" && a.needs_not_applied.length === 0)).toBe(true);
    expect(ledger.residual_barriers).toEqual([]);
    expect(ledger.residual_barriers_complete).toBe(false);
    expect(ledger.profile).toEqual({ not_needed: [], unassessed_count: 69 });
  });

  it("perfil B: separa «no necesita» de «sin valorar» y no convierte ninguno en apoyo", () => {
    const { ledger } = ledgerFor(frac, V22_PROFILES.B, []);
    expect(ledger.profile?.not_needed.sort()).toEqual(["instruction_chunking", "reading_level", "text_length", "vocabulary_complexity"]);
    expect(ledger.profile?.unassessed_count).toBe(69 - 8);
    expect(ledger.needs.map((n) => n.dimension)).not.toContain("instruction_chunking");
  });

  it("una necesidad no aplicada sin evidencia queda pendiente de revisión, nunca con un motivo inventado", () => {
    const { ledger } = ledgerFor(frac, V22_PROFILES.A, [
      decision({ target: "act_2", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], preserves: allPreserved(frac, "act_2") }),
    ]);
    const act2 = ledger.activities.find((a) => a.activity === "act_2")!;
    const act3 = ledger.activities.find((a) => a.activity === "act_3")!;
    expect(act2.intervention).toBe("changed");
    expect(act2.needs_not_applied.map((n) => n.dimension)).not.toContain("planning_support");
    expect(act3.intervention).toBe("none");
    expect(act3.needs_not_applied.length).toBeGreaterThan(0);
    for (const n of [...act2.needs_not_applied, ...act3.needs_not_applied]) expect(n).toMatchObject({ evidence: null, status: "pending_review" });
    expect(ledger.needs.find((n) => n.dimension === "planning_support")?.applied_in).toEqual(["act_2"]);
    // The builder's own reason travels as it is: this sheet has no long text to fragment.
    expect(ledger.omitted_needs).toContainEqual({ dimension: "reading_chunk_size", reason: "not_applicable" });
  });

  it("una decisión bloqueada deja una barrera residual demostrable y explica la necesidad no aplicada", () => {
    const { ledger } = ledgerFor(frac, V22_PROFILES.B, [decision({ target: "act_5", action: "remove", strategies: ["writing_load_reduction"], dimensions: ["writing_amount"] })]);
    const d = ledger.decisions[0]!;
    expect(d.status).toBe("blocked");
    expect(ledger.activities.find((a) => a.activity === "act_5")).toMatchObject({ intervention: "blocked_only" });
    expect(ledger.activities.find((a) => a.activity === "act_5")?.needs_not_applied).toContainEqual({ dimension: "writing_amount", evidence: "decision_blocked", status: "explained" });
    expect(ledger.residual_barriers).toEqual([{ activity: "act_5", dimension: "writing_amount", evidence: "decision_blocked", decision_id: d.id }]);
  });

  it("una actividad sin respuesta explica por qué no se aplican las necesidades de escritura", () => {
    const silent = structuredClone(frac);
    silent.activities[0]!.response_format = "none";
    const { ledger } = ledgerFor(silent, V22_PROFILES.B, []);
    const act1 = ledger.activities.find((a) => a.activity === "act_1")!;
    expect(act1.needs_not_applied).toContainEqual({ dimension: "fine_motor_demand", evidence: "activity_has_no_response", status: "explained" });
    expect(act1.needs_not_applied.find((n) => n.dimension === "expressive_language_support")).toMatchObject({ evidence: null, status: "pending_review" });
  });

  it("estado de cada decisión según la validación existente, sin reinterpretarla", () => {
    const { ledger } = ledgerFor(frac, V22_PROFILES.A, [
      decision({ target: "act_2", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], preserves: allPreserved(frac, "act_2") }),
      decision({ target: "act_9", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"] }),
      decision({ target: "act_3", action: "keep" }),
    ]);
    expect(ledger.decisions.map((d) => [d.target, d.status, d.origin])).toEqual([
      ["act_2", "justified", "individual"],
      ["act_9", "blocked", "individual"],
      ["act_3", "justified", "none"],
    ]);
    expect(ledger.decisions[1]?.activities).toEqual([]);
  });

  it("alcance de un destino: actividad, recurso, sección o documento", () => {
    expect(activitiesOf(frac, "act_3")).toEqual(["act_3"]);
    expect(activitiesOf(frac, "vis_2").sort()).toEqual(["act_2", "act_5"]);
    expect(activitiesOf(frac, "document")).toHaveLength(5);
    expect(activitiesOf(frac, "sec_1")).toHaveLength(5);
  });
});

describe("prueba de pista: cobertura declarada, nunca completa", () => {
  it("una decisión que no añade recurso no tiene prueba de pista", () => {
    expect(hintTest({ action: "keep", visual: undefined }).every((h) => h.result === "not_applicable")).toBe(true);
    expect(hintTest({ action: "rephrase", visual: undefined }).every((h) => h.result === "not_applicable")).toBe(true);
  });

  it("sin comprobación, todo queda pendiente; P1, P5 y P6 son siempre juicio docente", () => {
    const test = hintTest({ action: "add_support", visual: undefined }, [
      { question: "P1", result: "clear", detail: null },
      { question: "P2", result: "clear", detail: null },
      { question: "P8", result: "clear", detail: null },
    ]);
    const by = Object.fromEntries(test.map((h) => [h.question, h]));
    expect(by.P1).toMatchObject({ coverage: "teacher_judgment", result: "pending_review" });
    expect(by.P5).toMatchObject({ coverage: "teacher_judgment", result: "pending_review" });
    expect(by.P6).toMatchObject({ coverage: "teacher_judgment", result: "pending_review" });
    // A partial check that finds nothing is reported as «not detected», not as «clear».
    expect(by.P2).toMatchObject({ coverage: "partial", result: "not_detected" });
    expect(by.P8).toMatchObject({ coverage: "deterministic", result: "clear" });
    expect(by.P3).toMatchObject({ result: "pending_review" });
  });
});
