import { describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { normalizeActivityComprehension } from "@/lib/analysis/activity-comprehension";
import { directPedagogy, type DirectorInput } from "@/lib/recreation/director";
import { emptyFunctionalProfile, FunctionalProfileSchema, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import { emptyPedagogicalProfile, type ObservedAbility } from "@/lib/schemas/pedagogical-profile";
import type { DirectorActivityProposal } from "@/lib/schemas/pedagogical-direction";
import { pedagogicalOriginalDraft } from "../support/pedagogical-original";

const ACCESS = { version: 1, type: "accessibility" };
const METHOD = { version: 1, type: "methodological" };
const MATH_GOAL = "Planificar operaciones y justificar el procedimiento";
const READING_GOAL = "Inferir una causa y fundamentarla con evidencia textual";

function learner(
  supports: FunctionalProfile["supports"],
  options: { abilities?: ObservedAbility[]; knows?: string[]; needs?: string[]; oral?: boolean } = {},
): FunctionalProfile {
  return FunctionalProfileSchema.parse({
    ...emptyFunctionalProfile(), schema_version: 3, supports,
    pedagogy: {
      ...emptyPedagogicalProfile(),
      areas: [{
        subject: "matematicas", reference_grade: null, abilities: options.abilities ?? [], knows: options.knows ?? [], needs: options.needs ?? [],
      }],
      response_preferences: options.oral ? ["oral", "select"] : [],
      ...(options.oral ? { short_responses_with_support: true as const } : {}),
      adaptation_preferences: ["curricular"],
    },
  });
}

function scenario(
  profile = learner({}),
  draft = pedagogicalOriginalDraft(),
  options?: Partial<Omit<DirectorInput, "profile" | "analysis">>,
): DirectorInput {
  return {
    profile,
    analysis: normalizeActivityComprehension(draft, { pageCount: 2 }).stored,
    originalSha256: "a".repeat(64),
    verifiedSubject: "matematicas",
    education: { stage: "primaria", grade: "5-primaria" },
    authorization: ACCESS,
    ...options,
  };
}

function direct(input: DirectorInput, activities?: DirectorActivityProposal[]) {
  const run = directPedagogy(input, activities && { version: 1, activities });
  if (!run.ok) throw new Error(run.code);
  return run.direction;
}

function shortOpenDraft() {
  const source = pedagogicalOriginalDraft();
  const activity = source.activities[1]!;
  activity.instruction += " Puedes decirlo o escribirlo.";
  activity.answer_lines = 3;
  activity.comprehension.response_format_role = { kind: "access", evidence: { source_ref: "a2", quote: "Puedes decirlo o escribirlo" } };
  return source;
}

describe("director pedagógico 3A (núcleo interno)", () => {
  it("facilita la lectura sin bajar la competencia demostrada ni anticipar cómo resolver", () => {
    const input = scenario(learner({ decoding_support: "high" }, {
      abilities: [{ statement: MATH_GOAL, autonomy: "independent" }],
    }));
    const result = direct(input);
    const math = result.activities[0]!;
    expect(math).toMatchObject({
      activity_id: "act_1", page: 1, decision: "facilitate", status: "design_candidate", equivalence: "pending",
      changes: [{ kind: "segment_instruction", need: "decoding_support" }],
      needs: [{ dimension: "decoding_support", level: "high" }],
      learning: { autonomy: [{ objective_id: "obj_1", observation_index: 0, autonomy: "independent" }] },
    });
    expect(math.obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "objective", value: "obj_1", evidence: expect.objectContaining({ source_ref: "act_1" }) }),
      expect.objectContaining({ kind: "operation", value: "choose_procedure" }),
      expect.objectContaining({ kind: "student_decision", value: "order_steps" }),
      expect.objectContaining({ kind: "condition", value: "required_data", evidence: expect.objectContaining({ quote: "Hay 150 plazas" }) }),
    ]));
    expect(math.retains).toEqual(math.obligations.map(({ ref }) => ref));
    expect(math.fabrication.requirements).toEqual(expect.arrayContaining(["split_instruction_verbatim", "semantic_review"]));
    expect(result.analysis_fingerprint).toBe(fingerprint(input.analysis));
    expect(direct(input)).toEqual(result);
  });

  it("ofrece espacio para planificar al alumno que calcula solo, sin darle la secuencia académica", () => {
    const draft = pedagogicalOriginalDraft();
    draft.intent.objectives.push({ id: "calculate", text: "Calcular plazas libres" });
    const math = draft.activities[0]!;
    math.objectives.push("calculate");
    math.comprehension.objectives.push({
      objective_ref: "calculate", basis: "interpreted", evidence: { source_ref: "a1", quote: "¿Cuántas quedan?" },
    });
    math.comprehension.operations.push({ kind: "calculate", evidence: { source_ref: "a1", quote: "¿Cuántas quedan?" } });
    const result = direct(scenario(learner({ planning_support: "high" }, {
      abilities: [{ statement: "Calcular plazas libres", autonomy: "independent" }, { statement: MATH_GOAL, autonomy: "with_help" }],
    }), draft)).activities[0]!;
    expect(result).toMatchObject({ decision: "facilitate", changes: [{ kind: "blank_workspace", need: "planning_support" }] });
    expect(result.fabrication.requirements).toContain("unlabelled_workspace");
    expect(result.fabrication.requirements).toContain("check_fit_to_declared_learning");
    expect(result.learning.autonomy).toEqual([
      { objective_id: "obj_1", observation_index: 1, autonomy: "with_help" },
      { objective_id: "obj_6", observation_index: 0, autonomy: "independent" },
    ]);
    expect(result.obligations.filter(({ kind }) => kind === "student_decision").map(({ value }) => value)).toEqual(["choose_procedure", "order_steps"]);
    expect(result.prohibition).toContain("solve_for_student");
  });

  it("protege justificación y redacción frente a cambios a una respuesta cerrada o a una respuesta oral", () => {
    const input = scenario(learner({ alternative_response: "high", writing_amount: "high" }, { oral: true }), pedagogicalOriginalDraft(), { authorization: METHOD });
    const writing = direct(input).activities[2]!;
    expect(writing).toMatchObject({
      decision: "keep", status: "needs_evidence", issues: [{ code: "profile_support_unresolved", ref: null }],
    });
    expect(writing.prohibition).toContain("change_response_format");
    expect(writing.obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "operation", value: "compose" }),
      expect.objectContaining({ kind: "operation", value: "justify" }),
      expect.objectContaining({ kind: "condition", evidence: expect.objectContaining({ quote: "con dos argumentos" }) }),
    ]));
    const proposal = { activity_id: writing.activity_id, decision: "transform" as const, retains: writing.retains };
    const oral = direct(input, [{ ...proposal, changes: [{ kind: "oral_response", need: "alternative_response" }] }]).activities[2]!;
    expect(oral).toMatchObject({ status: "rejected", equivalence: "not_assessed" });
    expect(oral.issues).toContainEqual({ code: "response_protected", ref: "oral_response" });
    expect(directPedagogy(input, { version: 1, activities: [{ ...proposal, changes: [{ kind: "select", need: "alternative_response" }] }] }))
      .toEqual({ ok: false, code: "invalid_proposal" });
  });

  it("ofrece una guía visual de navegación en lectura sin señalar la frase que resuelve la inferencia", () => {
    const input = scenario(learner({ visual_support: "high" }));
    const reading = direct(input).activities[1]!;
    expect(reading).toMatchObject({
      decision: "facilitate", status: "design_candidate", equivalence: "pending", changes: [{ kind: "visual_navigation", need: "visual_support" }],
    });
    expect(reading.fabrication.requirements).toEqual(expect.arrayContaining(["original_resources", "navigation_without_clues", "semantic_review"]));
    expect(reading.obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "resource", value: "ctt_1" }),
      expect.objectContaining({ kind: "operation", value: "infer" }),
      expect.objectContaining({ kind: "student_decision", value: "select_evidence" }),
    ]));
    const unsupported = direct(input, [{
      activity_id: reading.activity_id, decision: "facilitate", retains: reading.retains,
      changes: [{ kind: "new_illustration", need: "visual_support" }],
    }]).activities[1]!;
    expect(unsupported).toMatchObject({ status: "rejected", issues: [{ code: "fabrication_unavailable", ref: "new_illustration" }] });
    expect(directPedagogy(input, { version: 1, activities: [{
      activity_id: reading.activity_id, decision: "facilitate", retains: reading.retains,
      changes: [{ kind: "visual_navigation", need: "visual_support", mark_answer: true }],
    }] })).toEqual({ ok: false, code: "invalid_proposal" });
  });

  it("mantiene un registro de Secundaria con apoyos altos aunque el nivel competencial declarado sea de Primaria", () => {
    const profile = learner({ large_print: "high" });
    profile.pedagogy!.areas[0]!.reference_grade = "3-primaria";
    const result = direct(scenario(profile, pedagogicalOriginalDraft(), { education: { stage: "eso", grade: "2-eso" } }));
    expect(result.audience_register).toBe("adolescent");
    expect(result.activities[0]).toMatchObject({ decision: "facilitate", changes: [{ kind: "change_presentation", need: "large_print" }] });
    expect(result.activities[0]!.prohibition).toContain("infantilize");
    expect(result.activities[0]!.fabrication.requirements).toContain("age_appropriate_layout");
  });

  it("conserva el historial sin autonomía inventada y no toma competencias de un área sin verificar", () => {
    const profile = learner({}, { knows: [MATH_GOAL], abilities: [{ statement: READING_GOAL, autonomy: "not_yet" }] });
    const input = scenario(profile);
    const known = direct(input).activities;
    expect(known[0]).toMatchObject({ decision: "keep", status: "unchanged", learning: {
      autonomy: [{ objective_id: "obj_1", observation_index: 0, autonomy: "unassessed" }],
    } });
    expect(known[1]).toMatchObject({ decision: "keep", status: "needs_evidence", learning: {
      autonomy: [{ objective_id: "obj_2", observation_index: 1, autonomy: "not_yet" }],
    }, issues: [{ code: "profile_support_unresolved", ref: null }] });
    expect(direct({ ...input, verifiedSubject: null }).activities[0]?.learning.autonomy).toEqual([]);
    expect(direct({ ...input, verifiedSubject: "lengua" }).activities[1]?.learning.autonomy).toEqual([]);
    expect(JSON.stringify(direct(input))).not.toContain('"statement"');
  });

  it("mantiene la consigna ambigua sin fabricar y conserva la lectura histórica fuera del director", () => {
    const input = scenario(learner({ instruction_chunking: "high" }));
    const output = direct(input).activities[5]!;
    expect(output).toMatchObject({
      decision: "keep", status: "needs_evidence", equivalence: "not_assessed", changes: [], original_uncertainty_ids: ["unc_1"],
    });
    expect(output.issues).toContainEqual({ code: "source_uncertain", ref: null });
    expect(output.fabrication.requirements).not.toContain("check_rendered_output");
    const base = (input.analysis as { base: unknown }).base;
    expect(directPedagogy({ ...input, analysis: base })).toEqual({ ok: false, code: "v4_required" });
    expect(directPedagogy({ ...input, profile: { ...emptyFunctionalProfile(), schema_version: 1 } }).ok).toBe(true);

    const illegible = pedagogicalOriginalDraft();
    illegible.quality.readability = "poor";
    expect(direct(scenario(input.profile, illegible)).activities[0]).toMatchObject({
      decision: "keep", status: "needs_evidence", issues: [{ code: "source_uncertain", ref: null }],
    });
  });

  it("admite el cambio oral previsto por el original con preferencia, necesidad y autorización metodológica", () => {
    const input = scenario(learner({ alternative_response: "high" }, { oral: true }), shortOpenDraft(), { authorization: METHOD });
    const oral = direct(input).activities[1]!;
    expect(oral).toMatchObject({ decision: "transform", status: "design_candidate", equivalence: "pending",
      changes: [{ kind: "oral_response", need: "alternative_response" }],
    });
    expect(oral.retains).not.toContain(oral.obligations.find(({ kind }) => kind === "response")!.ref);
    expect(oral.fabrication.requirements).toContain("oral_response_space");
    const restricted = direct({ ...input, authorization: ACCESS }, [{
      activity_id: oral.activity_id, decision: oral.decision, changes: oral.changes, retains: oral.retains,
    }]).activities[1]!;
    expect(restricted).toMatchObject({ status: "rejected" });
    expect(restricted.issues).toContainEqual({ code: "scope_forbids_change", ref: null });
    expect(direct({ ...input, profile: learner({ alternative_response: "high" }) }).activities[1]!.decision).toBe("keep");
  });

  it("rechaza una sustitución que elimina la inferencia y solo deja una alternativa íntegra como candidata", () => {
    const input = scenario(learner({ decoding_support: "medium" }), shortOpenDraft(), { authorization: METHOD });
    const original = direct(input).activities[1]!;
    const inference = original.obligations.find(({ kind, value }) => kind === "operation" && value === "infer")!;
    const replacement: DirectorActivityProposal = {
      activity_id: original.activity_id, decision: "substitute", retains: original.retains,
      changes: [{ kind: "replacement", need: "decoding_support", executor: "short_answer" }],
    };
    const bad = direct(input, [{ ...replacement, retains: replacement.retains.filter((ref) => ref !== inference.ref) }]).activities[1]!;
    expect(bad).toMatchObject({ status: "rejected", equivalence: "not_assessed" });
    expect(bad.issues).toContainEqual({ code: "retention_missing", ref: inference.ref });
    const allowed = direct(input, [replacement]).activities[1]!;
    expect(allowed).toMatchObject({ status: "design_candidate", equivalence: "pending", issues: [] });
    expect(allowed.fabrication.requirements).toEqual(expect.arrayContaining(["recreation_executor", "semantic_review"]));
  });

  it("protege también los elementos del grafo base y rechaza cambios de objetivos fuera del alcance", () => {
    const draft = shortOpenDraft();
    draft.protected.push({ type: "response_constraint", importance: "essential", value: "Con una frase del texto.", activities: ["a2"], resources: ["story"] });
    const input = scenario(learner({ alternative_response: "high" }, { oral: true }), draft, { authorization: METHOD });
    const baseline = direct(input).activities[1]!;
    expect(baseline.decision).toBe("keep");
    const protectedElement = baseline.obligations.find(({ kind }) => kind === "protected")!;
    const objective = baseline.obligations.find(({ kind }) => kind === "objective")!;
    const attempt = direct(input, [{
      activity_id: baseline.activity_id, decision: "substitute",
      changes: [{ kind: "replacement", need: "alternative_response", executor: "short_answer" }],
      retains: baseline.retains.filter((ref) => ref !== protectedElement.ref && ref !== objective.ref),
    }]).activities[1]!;
    expect(attempt.issues).toEqual(expect.arrayContaining([
      { code: "retention_missing", ref: protectedElement.ref }, { code: "retention_missing", ref: objective.ref },
    ]));
    const { base } = input.analysis as { base: unknown };
    const authorized = { version: 1, type: "curricular", objective_ids: ["obj_2"], analysis_fingerprint: fingerprint(base) };
    expect(directPedagogy({ ...input, authorization: authorized })).toEqual({ ok: false, code: "scope_unavailable" });
    expect(directPedagogy({ ...input, authorization: { ...authorized, analysis_fingerprint: "b".repeat(64) } }))
      .toEqual({ ok: false, code: "invalid_authorization" });
    expect(directPedagogy({ ...input, authorization: null })).toEqual({ ok: false, code: "invalid_authorization" });
  });
});
