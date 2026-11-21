import { describe, expect, it, vi } from "vitest";
import { directPedagogy } from "@/lib/recreation/director";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { allBlocks, type Block } from "@/lib/schemas/material-document";
import { runDirectedRecreation, type DirectedPilotResult } from "@/lib/recreation/directed-pilot";
import { printDirectedRecreation } from "@/lib/recreation/directed-print";
import type { DirectedPlan } from "@/lib/recreation/directed-plan";
import { candidateFor, completeOriginal, directorFixture, echoPlan, PRIVATE_STATEMENT, readPlannerRequest, replacementPlan, shortOriginal } from "../support/directed-recreation";
import { pedagogicalOriginalDraft } from "../support/pedagogical-original";

function resultOf(result: DirectedPilotResult) {
  if (result.status === "blocked") throw new Error(JSON.stringify({ issues: result.issues, direction: result.direction?.activities.filter((row) => row.issues.length).map(({ activity_id, issues, uncertainties }) => ({ activity_id, issues, uncertainties })) }));
  return result;
}

function activity(result: ReturnType<typeof resultOf>, originalId: string) {
  const id = result.trace.find(({ original_id }) => original_id === originalId)?.block_id;
  const block = allBlocks(result.document).find((b): b is Extract<Block, { type: "activity" }> => b.id === id && b.type === "activity");
  if (!block) throw new Error(`No se fabricó ${originalId}`);
  return block;
}

describe("dirección conectada al planificador y fabricada", () => {
  it("fabrica apoyos literales y neutros con trazabilidad y mantiene las actividades excluidas del planificador", async () => {
    const { input, original } = await directorFixture();
    const keep = [candidateFor(input, "act_3"), candidateFor(input, "act_5")];
    const fixture = vi.fn((request: Parameters<typeof echoPlan>[0]) => {
      const { direction, text } = readPlannerRequest(request);
      expect(direction.activities.map(({ activity_id }) => activity_id)).not.toContain("act_3");
      expect((direction.activities.find(({ activity_id }) => activity_id === "act_1"))?.changes.map(({ kind }) => kind))
        .toEqual(expect.arrayContaining(["blank_workspace", "segment_instruction"]));
      expect(text).toContain("order_steps");
      expect(text).toContain("<untrusted_material>");
      expect(text).not.toMatch(/observation_index|profile_fingerprint|original_sha256|expected_answer/);
      expect(text).not.toContain(PRIVATE_STATEMENT);
      return echoPlan(request);
    });
    const output = resultOf(await runDirectedRecreation(input, { original, plannerFixture: fixture, candidate: { version: 1, activities: keep } }));
    expect(fixture).toHaveBeenCalledTimes(1);
    expect(output.document.meta.stage).toBe("eso");
    expect(activity(output, "act_1")).toMatchObject({ prompt: expect.stringContaining("orden.\n\nJustifica"), response: { kind: "lines", lines: 5 } });
    expect(activity(output, "act_1").prompt).toContain("Se han reservado 75 por la mañana y 32 por la tarde");
    expect(activity(output, "act_3")).toMatchObject({ trace: { origin: "original" }, prompt: expect.stringContaining("con dos argumentos") });
    expect(allBlocks(output.document)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "help_box", title: "Orientación", trace: expect.objectContaining({ source_refs: ["act_2"] }) }),
      expect.objectContaining({ type: "chart", categories: ["Marzo", "Abril"], series: [{ label: null, values: [12, 20] }] }),
      expect.objectContaining({ type: "reading_text", literal: true }),
    ]));
    expect(output.trace.map(({ original_id, result_id }) => ({ original_id, result_id }))).toEqual(
      [1, 2, 3, 4, 5].map((n) => ({ original_id: `act_${n}`, result_id: `act_${n}` })),
    );
    expect(output.provenance.document).toBe(fingerprint(output.document));
    expect(output.checks).toMatchObject({ fabrication: "passed", pdf: "pending", semantic: "pending" });
  });

  it("conserva toda la ficha sin pedir un plan si no hay cambios justificados", async () => {
    const { input, original } = await directorFixture({ supports: {} });
    const planner = vi.fn(echoPlan);
    const output = resultOf(await runDirectedRecreation(input, { original, plannerFixture: planner }));
    expect(planner).not.toHaveBeenCalled();
    expect(output.direction.activities.map(({ status }) => status)).toEqual(Array(5).fill("unchanged"));
    expect(allBlocks(output.document).filter(({ type }) => type === "activity").map(({ trace }) => trace.origin)).toEqual(Array(5).fill("original"));
  });

  it("rechaza cualquier pérdida de razonamiento o condición declarada en los enlaces", async () => {
    const { input, original } = await directorFixture();
    const direction = directRows(input);
    for (const originalId of ["act_1", "act_3"]) {
      const target = direction.find(({ activity_id }) => activity_id === originalId)!;
      const kind = originalId === "act_1" ? "student_decision" : "condition";
      const missing = target.obligations.find((item) => item.kind === kind)!.ref;
      const output = await runDirectedRecreation(input, { original, plannerFixture: (request) => {
        const plan = echoPlan(request);
        const link = plan.links.find(({ original_id }) => original_id === originalId)!;
        link.retains = link.retains.filter((ref) => ref !== missing);
        return plan;
      } });
      expect(output).toMatchObject({ status: "blocked", issues: [{ code: "obligation_missing", original_id: originalId, ref: missing }] });
      expect(output).not.toHaveProperty("document");
    }
  });

  it("bloquea división, fusión, omisión y cambio no autorizado, aun cuando el enunciado coincida", async () => {
    const { input, original } = await directorFixture();
    const runs: Array<[(plan: DirectedPlan) => void, string]> = [
      [(plan) => plan.links.push({ ...plan.links[0]!, result_id: "ra_1" }), "unexpected_activity_link"],
      [(plan) => { plan.links[1]!.result_id = plan.links[0]!.result_id; }, "unexpected_activity_link"],
      [(plan) => { plan.links.shift(); }, "activity_link_missing"],
      [(plan) => { plan.links[0]!.changes.push("oral_response"); }, "change_not_authorized"],
    ];
    for (const [tamper, code] of runs) {
      const output = await runDirectedRecreation(input, { original, plannerFixture: (request) => {
        const plan = echoPlan(request);
        tamper(plan);
        return plan;
      } });
      expect(output).toMatchObject({ status: "blocked", issues: expect.arrayContaining([expect.objectContaining({ code })]) });
    }
  });

  it("bloquea antes de planificar si el original es otro, hay evidencia pendiente o el director rechazó la sustitución", async () => {
    const fixture = vi.fn(echoPlan);
    const uncertain = await directorFixture({ draft: pedagogicalOriginalDraft() });
    expect(await runDirectedRecreation(uncertain.input, { original: uncertain.original, plannerFixture: fixture }))
      .toMatchObject({ status: "blocked", issues: [{ code: "needs_evidence", original_id: "act_6" }] });
    const { input, original } = await directorFixture({ draft: shortOriginal() });
    const candidate = candidateFor(input, "act_2", true);
    const obligation = directRows(input)[1]!.obligations.find(({ kind }) => kind === "operation")!.ref;
    candidate.retains = candidate.retains.filter((ref) => ref !== obligation);
    expect(await runDirectedRecreation(input, { original, plannerFixture: fixture, candidate: { version: 1, activities: [candidate] } }))
      .toMatchObject({ status: "blocked", issues: [{ code: "rejected", original_id: "act_2" }] });
    expect(await runDirectedRecreation(input, { original: new Uint8Array([42]), plannerFixture: fixture }))
      .toMatchObject({ status: "blocked", issues: [{ code: "original_hash_mismatch" }] });
    expect(fixture).not.toHaveBeenCalled();
  });

  it("fabrica una sustitución abierta en el compilador existente y verifica sus criterios, objetivos, operaciones y datos", async () => {
    const { input, original } = await directorFixture({ draft: shortOriginal() });
    const candidate = { version: 1, activities: [candidateFor(input, "act_2", true)] };
    const good = resultOf(await runDirectedRecreation(input, { original, candidate, plannerFixture: replacementPlan }));
    expect(good.trace[1]).toMatchObject({ original_id: "act_2", result_id: "ra_1" });
    expect(activity(good, "act_2")).toMatchObject({
      prompt: expect.stringContaining("Tu compañero busca"), response: { kind: "lines", lines: 3 },
      trace: { source_refs: ["act_2"], origin: "adapted" },
    });
    expect(good.checks.legacy_replacement).toBe("passed");
    expect(good.checks.semantic).toBe("pending");
    const cases: Array<[(plan: NonNullable<DirectedPlan["replacement"]>) => void, string]> = [
      [(plan) => { plan.activities[0]!.prompt = "¿A qué sitio del relato tiene que ir?"; }, "condition_or_data_missing"],
      [(plan) => { plan.activities[0]!.objective_ids = ["obj_3"]; }, "objectives_changed"],
      [(plan) => { plan.activities[0]!.operations = ["classify"]; }, "operation_missing"],
      [(plan) => {
        const executor = plan.activities[0]!.executor;
        if (executor.kind === "short_answer") executor.criteria = ["Mostrar lo aprendido"];
      }, "evaluation_criterion_missing"],
      [(plan) => { plan.facts.push({ id: "f_1", kind: "statement", source_ref: "ctt_1", quote: "Una frase inexistente" }); }, "legacy_fact_not_in_source"],
    ];
    for (const [tamper, code] of cases) {
      const result = await runDirectedRecreation(input, { original, candidate, plannerFixture: (request) => {
        const plan = replacementPlan(request);
        tamper(plan.replacement!);
        return plan;
      } });
      expect(result).toMatchObject({ status: "blocked", issues: expect.arrayContaining([expect.objectContaining({ code })]) });
      expect(result).not.toHaveProperty("document");
    }
  });

  it("declara la capacidad que falta para sustituir una actividad que exige inferir", async () => {
    const draft = completeOriginal();
    const reading = draft.activities[1]!;
    reading.instruction += " Puedes decirlo o escribirlo.";
    reading.answer_lines = 3;
    reading.comprehension.response_format_role = { kind: "access", evidence: { source_ref: "a2", quote: "Puedes decirlo o escribirlo" } };
    const { input, original } = await directorFixture({ draft });
    const result = await runDirectedRecreation(input, { original,
      candidate: { version: 1, activities: [candidateFor(input, "act_2", true)] }, plannerFixture: replacementPlan,
    });
    expect(result).toMatchObject({ status: "blocked", issues: expect.arrayContaining([
      expect.objectContaining({ code: "operation_executor_unavailable", original_id: "act_2" }),
      expect.objectContaining({ code: "student_decision_executor_unavailable", original_id: "act_2" }),
    ]) });
  });

  it("usa la respuesta oral existente si el alcance y el perfil lo autorizan", async () => {
    const { input, original } = await directorFixture({ draft: shortOriginal(), supports: { alternative_response: "high" }, oral: true });
    const draft = shortOriginal();
    draft.activities = [draft.activities[1]!];
    const single = await directorFixture({ draft, supports: { alternative_response: "high" }, oral: true });
    const result = resultOf(await runDirectedRecreation(single.input, { original: single.original, plannerFixture: echoPlan }));
    expect(activity(result, "act_1").response).toEqual({ kind: "oral_or_alternative", mode: "oral", lines: 0 });
    const denied = await runDirectedRecreation({ ...input, authorization: { version: 1, type: "accessibility" } }, { original, plannerFixture: echoPlan });
    expect(denied.status).toBe("blocked");
  });

  it("detecta una propuesta o un documento desactualizados", async () => {
    const { input, original } = await directorFixture();
    const stale = await runDirectedRecreation(input, { original, plannerFixture: (request) => ({
      ...echoPlan(request), request_fingerprint: "a".repeat(64),
    }) });
    expect(stale).toMatchObject({ status: "blocked", issues: [{ code: "stale_plan" }] });
    const product = resultOf(await runDirectedRecreation(input, { original, plannerFixture: echoPlan }));
    activity(product, "act_1").prompt = "Un dato cambiado después de la revisión.";
    const engine = { name: "unused", render: vi.fn() };
    expect(await printDirectedRecreation(product, engine)).toEqual({ status: "blocked", issues: ["stale_fabrication"] });
    expect(engine.render).not.toHaveBeenCalled();
  });
});

function directRows(input: Parameters<typeof candidateFor>[0]) {
  const result = directPedagogy(input);
  if (!result.ok) throw new Error(result.code);
  return result.direction.activities;
}
