import { describe, expect, it } from "vitest";
import { reliableAnswerParts } from "@/lib/adaptation/assessment-safety";
import { resolveAutomatically } from "@/lib/adaptation/automatic-resolution";
import { SUBSTITUTION_REASON, isActionable, kindServes, kindsOfBlock, planSubstitution, priorGuard, recordOf, revealDeclines, servesAll } from "@/lib/adaptation/support-substitution";
import { assessSupports } from "@/lib/adaptation/assessment-safety";
import { pondCase } from "../support/pond-plan";

/**
 * Etapa 2.2 · la sustitución funcional, pura: qué apoyo puede reemplazar a otro (el mismo NECESIDAD, nunca otra función), cuándo la
 * evidencia es literal y fiable, y que el registro lleva solo códigos e identificadores.
 */

const c = pondCase("v2");
const decision = (id: string) => c.plan.decisions.find((d) => d.id === id)!;
const activity = (id: string) => c.analysis.activities.find((a) => a.id === id)!;
const withNeed = (dimension: string, level: "low" | "medium" | "high") => {
  const context = structuredClone(c.context);
  context.needs.push({ ...context.needs[0]!, dimension, level } as never);
  return context;
};
const plan = (id: string, flagged: Parameters<typeof planSubstitution>[0]["flagged"], act: string, context = c.context) => planSubstitution({ raw: c.plan, decision: decision(id), flagged, analysis: c.analysis, context, activity: activity(act) });

describe("qué necesidad sirve cada tipo de apoyo (nunca equivalentes si sirven necesidades distintas)", () => {
  it("el glosario sirve el vocabulario; la pregunta guía, el conocimiento previo; el recordatorio, la memoria de trabajo", () => {
    expect(kindServes("glossary", "vocabulary_support")).toBe(true);
    expect(kindServes("guiding_questions", "background_knowledge_support")).toBe(true);
    expect(kindServes("reminder", "working_memory_support")).toBe(true);
  });

  it("…y no al revés: una pregunta guía no sirve el vocabulario, un recordatorio no sirve los ejemplos resueltos", () => {
    expect(kindServes("guiding_questions", "vocabulary_support")).toBe(false);
    expect(kindServes("reminder", "worked_examples")).toBe(false);
    expect(kindServes("glossary", "worked_examples")).toBe(false);
    expect(servesAll(["reminder"], ["worked_examples"], c.context)).toBe(false);
  });
});

describe("planSubstitution · estanque 3a (el glosario que define la relación)", () => {
  it("sustituye el glosario por vocabulario secundario MÁS una pregunta guía: sigue sirviendo el vocabulario Y el conocimiento previo", () => {
    const p = plan("dec_6", ["glossary"], "act_3")!;
    expect(p.option).toBe("guiding_questions");
    expect(p.to.sort()).toEqual(["glossary", "guiding_questions"]);
    // Ninguna de las dos necesidades queda sin servir.
    expect(servesAll(p.to, decision("dec_6").dimensions, c.context)).toBe(true);
    // Lo que se le pide al generador no contiene la respuesta: nombra lo evaluado para que NO lo defina.
    expect(p.restrictions.length).toBeGreaterThan(0);
    expect(p.restrictions.every((r) => r.length <= 200)).toBe(true);
  });

  it("solo se editan los apoyos: ni el objetivo, ni las dimensiones, ni lo que se conserva", () => {
    const p = plan("dec_6", ["glossary"], "act_3")!;
    expect(Object.keys(p.edits)).toEqual(["supports"]);
    expect(p.edits.supports!.every((s) => s.uses_task_data === false)).toBe(true);
  });
});

describe("planSubstitution · otras decisiones", () => {
  it("un recordatorio de memoria de trabajo se sustituye por un recordatorio del procedimiento (la misma necesidad)", () => {
    const context = withNeed("working_memory_support", "high");
    const reminder = { ...decision("dec_8"), id: "dec_x", target: "act_5", dimensions: ["working_memory_support" as const], strategies: ["working_memory_support" as const], supports: [{ kind: "reminder" as const, uses_task_data: false }] };
    const p = planSubstitution({ raw: { ...c.plan, decisions: [...c.plan.decisions, reminder] }, decision: reminder, flagged: ["reminder"], analysis: c.analysis, context, activity: activity("act_5") });
    expect(p).toMatchObject({ option: "method_reminder", to: ["reminder"] });
  });

  it("un ejemplo resuelto solo puede sustituirse por otro ejemplo (otro ámbito): ningún otro apoyo sirve «ejemplos resueltos»", () => {
    const p = plan("dec_4", ["worked_example"], "act_2")!;
    expect(p).toMatchObject({ option: "other_domain_example", to: ["worked_example"] });
    expect(p.restrictions[0]).toMatch(/otro ámbito/);
  });

  it("si ningún apoyo sirve la misma necesidad, NO hay sustitución (no se llama alternativa a lo que no la cubre)", () => {
    // Un tipo de apoyo sin alternativa definida (unos comienzos de frase) no se sustituye por «lo que haya»: se registra y se sigue la escalera.
    const starters = { ...decision("dec_6"), dimensions: ["background_knowledge_support" as const], supports: [{ kind: "sentence_starters" as const, uses_task_data: false }] };
    expect(planSubstitution({ raw: { ...c.plan, decisions: c.plan.decisions.map((d) => (d.id === "dec_6" ? starters : d)) }, decision: starters, flagged: ["sentence_starters"], analysis: c.analysis, context: c.context, activity: activity("act_3") })).toBeNull();
  });

  it("la elección depende de la actividad y del perfil: explicar prefiere la pregunta guía; con memoria de trabajo alta, el recordatorio de método", () => {
    const keyIdea = { ...decision("dec_6"), id: "dec_k", dimensions: ["background_knowledge_support" as const], strategies: ["comprehension_support" as const], supports: [{ kind: "key_idea" as const, uses_task_data: false }] };
    const raw = { ...c.plan, decisions: [...c.plan.decisions, keyIdea] };
    const on = (act: string) => planSubstitution({ raw, decision: { ...keyIdea, target: act }, flagged: ["key_idea"], analysis: c.analysis, context: c.context, activity: activity(act) });
    expect(on("act_3")?.option).toBe("guiding_questions");
    // Una actividad de cálculo (aplicar un procedimiento) prefiere recordar el método; la necesidad sigue servida.
    const application = on("act_5")!;
    expect(application.option).toBe("method_reminder");
    expect(servesAll(application.to, ["background_knowledge_support"], c.context)).toBe(true);
  });
});

describe("evidencia literal y fiable (lo único que puede empezar una reparación)", () => {
  const withAnswer = (basis: "source" | "inferred", value: string, ground = "") => {
    const analysis = structuredClone(c.analysis);
    const act = analysis.activities.find((a) => a.id === "act_2")!;
    act.expected_answer = { basis, value };
    if (ground) analysis.texts.find((t) => t.id === "ctt_3")!.text = ground;
    return analysis;
  };

  it("una respuesta que da la propia hoja es fiable; una deducida solo lo es si el material la contiene", () => {
    const parts = (analysis: ReturnType<typeof withAnswer>) => reliableAnswerParts(analysis, analysis.activities.find((a) => a.id === "act_2")!);
    expect(parts(withAnswer("source", "Garzas; Algas"))).toEqual(["Garzas", "Algas"]);
    expect(parts(withAnswer("inferred", "Garzas; Cometas"))).toEqual(["Garzas"]);
    expect(parts(withAnswer("inferred", "Cometas"))).toEqual([]);
  });

  it("un apoyo con una parte NO fiable (deducida y sin apoyo en el material) avisa pero no es accionable: ante la duda se conserva", () => {
    const analysis = withAnswer("inferred", "Cometas");
    const document = structuredClone(c.document);
    document.pages[0]!.blocks.push({ id: "blk_x", type: "help_box", variant: "reminder", text: "Piensa en los cometas del cielo.", trace: { origin: "support", source_refs: ["act_2"], decision_ids: ["dec_4"] } });
    const { findings } = assessSupports(analysis, document);
    expect(findings.filter((f) => f.block_id === "blk_x").map((f) => [f.code, f.literal])).toEqual([["direct_answer_part", undefined]]);
    expect(findings.filter(isActionable)).toEqual([]);
  });

  it("con una parte fiable sí: la hoja la da (source) → accionable", () => {
    const analysis = withAnswer("source", "Cometas");
    const document = structuredClone(c.document);
    document.pages[0]!.blocks.push({ id: "blk_x", type: "help_box", variant: "reminder", text: "Piensa en los cometas del cielo.", trace: { origin: "support", source_refs: ["act_2"], decision_ids: ["dec_4"] } });
    expect(assessSupports(analysis, document).findings.filter(isActionable).map((f) => f.code)).toEqual(["direct_answer_part"]);
  });
});

describe("apoyo declinado por revelar la respuesta", () => {
  it("se reconoce el rechazo estructurado del generador (v1 «blocked», v2 «skipped»), solo si la decisión quedó sin bloque", () => {
    const issues = [
      { code: "model_blocked", decision_id: "dec_1", detail: "would_reveal_answer: nota" },
      { code: "skipped_support", decision_id: "dec_2", detail: "glossary: would_reveal_answer" },
      { code: "skipped_support", decision_id: "dec_3", detail: "glossary: already_visible" },
      { code: "model_blocked", decision_id: "dec_4", detail: "would_reveal_answer: nota" },
    ];
    expect(revealDeclines({ declined: ["dec_1", "dec_2", "dec_3"], issues })).toEqual(["dec_1", "dec_2"]);
  });
});

describe("trazabilidad: códigos e identificadores, nunca texto", () => {
  it("el registro lleva decisión, actividad, bloques, riesgo, acción, tipos, necesidades y cobertura, y marca la revisión semántica pendiente", () => {
    const p = plan("dec_6", ["glossary"], "act_3")!;
    const record = recordOf({ decisionId: "dec_6", activityId: "act_3", blockIds: ["blk_1"], kinds: ["glossary"], trigger: "literal_answer", codes: ["direct_answer_part"] }, decision("dec_6"), "on", "substituted", { to: p.to, option: p.option, coverage: "same_activity" });
    expect(record).toEqual({ decision_id: "dec_6", activity_id: "act_3", block_ids: ["blk_1"], trigger: "literal_answer", codes: ["direct_answer_part"], mode: "on", action: "substituted", from: ["glossary"], to: p.to, option: "guiding_questions", dimensions: decision("dec_6").dimensions, coverage: "same_activity", semantic_review: "pending_2_3" });
    expect(JSON.stringify(record)).not.toMatch(/cadena|alimentaria|flechas|algas|garzas/i);
    expect(SUBSTITUTION_REASON.length).toBeLessThanOrEqual(160);
  });

  it("kindsOfBlock traduce el bloque al tipo de apoyo de su decisión", () => {
    expect(kindsOfBlock({ type: "vocabulary" } as never, decision("dec_6"))).toEqual(["glossary"]);
    expect(kindsOfBlock({ type: "list" } as never, { supports: [{ kind: "guiding_questions", uses_task_data: false }] })).toEqual(["guiding_questions"]);
  });
});

describe("evidencia léxica (C): restricción previa, nunca una llamada ni un cambio de decisión", () => {
  const resolved = (planner: "v2" | "v3") => {
    const k = pondCase(planner);
    return resolveAutomatically(k.plan, k.analysis, k.context);
  };

  it("estanque 3a: el glosario recibe, desde la primera generación, qué NO definir; sigue aplicado y su necesidad cubierta", () => {
    const { review, outcomes } = resolved("v2");
    const entry = review.entries.find((e) => e.decision_id === "dec_6")!;
    expect(entry.action).toBe("approved");
    expect(entry.restrictions).toHaveLength(1);
    expect(entry.restrictions![0]).toMatch(/No definas ni expliques lo que evalúa la actividad/);
    expect(entry.restrictions![0]!.length).toBeLessThanOrEqual(200);
    expect(outcomes.find((o) => o.decision_id === "dec_6")).toMatchObject({ kind: "applied", uncovered: [] });
  });

  it("solo ese: los ejemplos, listas de comprobación y recordatorios legítimos no reciben ninguna restricción", () => {
    const { review } = resolved("v2");
    expect(review.entries.filter((e) => e.restrictions && e.restrictions.length > 0).map((e) => e.decision_id)).toEqual(["dec_6"]);
  });

  it("con el planificador V2.2 (v3) es la misma decisión y la misma guarda", () => {
    expect(resolved("v3").review.entries.map((e) => [e.decision_id, e.restrictions ?? []])).toEqual(resolved("v2").review.entries.map((e) => [e.decision_id, e.restrictions ?? []]));
  });

  it("no hay guarda donde no hay nada en juego: actividad de aplicar un procedimiento, o sin concepto protegido", () => {
    const k = pondCase("v2");
    expect(priorGuard({ target: "act_2", supports: [{ kind: "glossary", uses_task_data: false }] }, k.analysis)).toEqual([]);
    const bare = structuredClone(k.analysis);
    bare.protected_elements = [];
    expect(priorGuard({ target: "act_3", supports: [{ kind: "glossary", uses_task_data: false }] }, bare)).toEqual([]);
    expect(priorGuard({ target: "act_3", supports: [{ kind: "checklist", uses_task_data: false }] }, k.analysis)).toEqual([]);
  });

  it("el aviso léxico del glosario de 3a existe pero NO es accionable: por sí solo no provoca ninguna reparación", () => {
    const k = pondCase("v2");
    const { findings } = assessSupports(k.analysis, k.document);
    expect(findings.map((f) => f.code)).toEqual(["defines_evaluated_concept"]);
    expect(findings.filter(isActionable)).toEqual([]);
  });
});
