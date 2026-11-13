import { describe, expect, it } from "vitest";
import { reliableAnswerParts } from "@/lib/adaptation/assessment-safety";
import { resolveWithheldAutonomously } from "@/lib/adaptation/autonomous-resolution";
import { resolveAutomatically } from "@/lib/adaptation/automatic-resolution";
import { planRepair } from "@/lib/adaptation/orchestration/orchestrator";
import { SUBSTITUTION_REASON, applySupportGuard, coverageOf, isActionable, kindServes, kindsOfBlock, planSubstitution, priorGuard, recordOf, revealDeclines, servesAll } from "@/lib/adaptation/support-substitution";
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
    expect(record).toEqual({ decision_id: "dec_6", activity_id: "act_3", block_ids: ["blk_1"], trigger: "literal_answer", codes: ["direct_answer_part"], mode: "on", action: "substituted", from: ["glossary"], to: p.to, option: "guiding_questions", dimensions: decision("dec_6").dimensions, coverage: "same_activity", uncovered: [], semantic_review: "pending_2_3" });
    expect(JSON.stringify(record)).not.toMatch(/cadena|alimentaria|flechas|algas|garzas/i);
    expect(SUBSTITUTION_REASON.length).toBeLessThanOrEqual(160);
  });

  it("kindsOfBlock traduce el bloque al tipo de apoyo de su decisión", () => {
    expect(kindsOfBlock({ type: "vocabulary" } as never, decision("dec_6"))).toEqual(["glossary"]);
    expect(kindsOfBlock({ type: "list" } as never, { supports: [{ kind: "guiding_questions", uses_task_data: false }] })).toEqual(["guiding_questions"]);
  });
});

describe("evidencia léxica (C): restricción previa, nunca una llamada ni un cambio de decisión", () => {
  const guarded = (planner: "v2" | "v3", mode: "on" | "dry_run" | "off") => {
    const k = pondCase(planner);
    const resolution = resolveAutomatically(k.plan, k.analysis, k.context);
    return { ...applySupportGuard(resolution.review, k.plan, k.analysis, mode), before: resolution.review, outcomes: resolution.outcomes };
  };

  it("estanque 3a (activado): el glosario recibe, desde la primera generación, qué NO definir; sigue aplicado y su necesidad cubierta", () => {
    const { review, guarded: ids, outcomes } = guarded("v2", "on");
    expect(ids).toEqual(["dec_6"]);
    const entry = review.entries.find((e) => e.decision_id === "dec_6")!;
    expect(entry.action).toBe("approved");
    expect(entry.restrictions).toHaveLength(1);
    expect(entry.restrictions![0]).toMatch(/No definas ni expliques lo que evalúa la actividad/);
    expect(entry.restrictions![0]!.length).toBeLessThanOrEqual(200);
    expect(outcomes.find((o) => o.decision_id === "dec_6")).toMatchObject({ kind: "applied", uncovered: [] });
  });

  it("ensayo: lista lo que haría y NO toca la revisión (ni una restricción); apagado: no hace nada", () => {
    const dry = guarded("v2", "dry_run");
    expect(dry.guarded).toEqual(["dec_6"]);
    expect(dry.review).toBe(dry.before);
    const off = guarded("v2", "off");
    expect(off.guarded).toEqual([]);
    expect(off.review).toBe(off.before);
  });

  it("solo ese: los ejemplos, listas de comprobación y recordatorios legítimos no reciben ninguna restricción", () => {
    expect(guarded("v2", "on").review.entries.filter((e) => e.restrictions && e.restrictions.length > 0).map((e) => e.decision_id)).toEqual(["dec_6"]);
  });

  it("con el planificador V2.2 (v3) es la misma decisión y la misma guarda", () => {
    expect(guarded("v3", "on").review.entries.map((e) => [e.decision_id, e.restrictions ?? []])).toEqual(guarded("v2", "on").review.entries.map((e) => [e.decision_id, e.restrictions ?? []]));
  });

  it("conserva las restricciones que la decisión ya traía y no se añade si ya no caben las seis; una decisión dejada fuera no se toca", () => {
    const k = pondCase("v2");
    const base = resolveAutomatically(k.plan, k.analysis, k.context).review;
    const withOwn = { ...base, entries: base.entries.map((e) => (e.decision_id === "dec_6" ? { ...e, restrictions: ["Una restricción de seguridad previa."] } : e)) };
    const kept = applySupportGuard(withOwn, k.plan, k.analysis, "on").review.entries.find((e) => e.decision_id === "dec_6")!.restrictions!;
    expect(kept[0]).toBe("Una restricción de seguridad previa.");
    expect(kept).toHaveLength(2);
    const full = { ...base, entries: base.entries.map((e) => (e.decision_id === "dec_6" ? { ...e, restrictions: ["1", "2", "3", "4", "5", "6"] } : e)) };
    expect(applySupportGuard(full, k.plan, k.analysis, "on").review.entries.find((e) => e.decision_id === "dec_6")!.restrictions).toEqual(["1", "2", "3", "4", "5", "6"]);
    const left = { ...base, entries: base.entries.map((e) => (e.decision_id === "dec_6" ? { decision_id: "dec_6", action: "rejected" as const, reason: "fuera" } : e)) };
    expect(applySupportGuard(left, k.plan, k.analysis, "on").guarded).toEqual([]);
  });

  it("la guarda mira los apoyos que la decisión llevará tras una edición (la variante segura de V2.2 sin glosario no la recibe)", () => {
    const k = pondCase("v2");
    const base = resolveAutomatically(k.plan, k.analysis, k.context).review;
    const edited = { ...base, entries: base.entries.map((e) => (e.decision_id === "dec_6" ? { decision_id: "dec_6", action: "edited" as const, reason: "variante segura", edits: { supports: [{ kind: "checklist" as const, uses_task_data: false }] } } : e)) };
    expect(applySupportGuard(edited, k.plan, k.analysis, "on").guarded).toEqual([]);
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

describe("cobertura real de una necesidad cuando un apoyo se deja fuera (coverageOf)", () => {
  const dec = (over: Partial<ReturnType<typeof decision>>) => ({ ...decision("dec_6"), ...over });
  const ctx = (level: "low" | "medium" | "high") => withNeed("working_memory_support", level);
  const mine = dec({ id: "dec_m", target: "act_3", dimensions: ["working_memory_support" as const] });

  it("misma actividad: otra decisión de esa dimensión sobre la MISMA actividad", () => {
    const other = dec({ id: "dec_o", target: "act_3", dimensions: ["working_memory_support" as const] });
    expect(coverageOf(mine, [mine, other], ctx("high"), c.analysis)).toEqual({ coverage: "same_activity", uncovered: [], essential: false });
  });

  it("recurso accesible: la decisión está sobre un recurso que esa actividad usa, o sobre el documento entero", () => {
    const onFigure = dec({ id: "dec_f", target: "vis_2", dimensions: ["working_memory_support" as const] });
    expect(coverageOf(mine, [mine, onFigure], ctx("high"), c.analysis)).toMatchObject({ coverage: "reachable_resource", uncovered: [] });
    const onSheet = dec({ id: "dec_d", target: "document", dimensions: ["working_memory_support" as const] });
    expect(coverageOf(mine, [mine, onSheet], ctx("medium"), c.analysis)).toMatchObject({ coverage: "reachable_resource", uncovered: [] });
  });

  it("la misma dimensión en OTRA actividad no cubre ésta, sea cual sea el nivel: sin cobertura (y solo una necesidad alta es esencial)", () => {
    const elsewhere = dec({ id: "dec_e", target: "act_5", dimensions: ["working_memory_support" as const] });
    expect(coverageOf(mine, [mine, elsewhere], ctx("low"), c.analysis)).toEqual({ coverage: "none", uncovered: ["working_memory_support"], essential: false });
    expect(coverageOf(mine, [mine, elsewhere], ctx("medium"), c.analysis)).toMatchObject({ coverage: "none", essential: false });
    expect(coverageOf(mine, [mine, elsewhere], ctx("high"), c.analysis)).toMatchObject({ coverage: "none", essential: true });
  });

  it("lo que resuelve la presentación se registra como tal; con varias dimensiones manda la peor", () => {
    const paged = dec({ id: "dec_p", target: "act_3", dimensions: ["number_of_visible_tasks" as const, "working_memory_support" as const] });
    const onlyPaged = coverageOf({ ...paged, dimensions: ["number_of_visible_tasks" as const] }, [paged], c.context, c.analysis);
    expect(onlyPaged.uncovered).toEqual([]);
    expect(coverageOf(paged, [paged], ctx("high"), c.analysis)).toMatchObject({ coverage: "none", uncovered: ["working_memory_support"] });
  });
});

describe("planRepair · la sustitución cambia solo el apoyo (ediciones, restricciones y peticiones previas se conservan)", () => {
  const k = pondCase("v2");
  const raw = k.plan;
  const loaded = { analysis: k.analysis, context: k.context } as never;
  const asks = new Map<string, Array<string | null>>([["dec_6", [null]]]);
  const flag = { decisionId: "dec_6", activityId: "act_3", blockIds: ["blk_x"], kinds: ["glossary" as const], trigger: "literal_answer" as const, codes: ["direct_answer_part" as const] };
  const support = () => ({ mode: "on" as const, flags: new Map([["dec_6", flag]]), structural: new Map(), alreadySubstituted: new Set<string>(), trace: [] as ReturnType<typeof recordOf>[] });
  const review = (entry: Record<string, unknown>) => ({ ...resolveAutomatically(raw, k.analysis, k.context).review, entries: resolveAutomatically(raw, k.analysis, k.context).review.entries.map((e) => (e.decision_id === "dec_6" ? { decision_id: "dec_6", ...entry } : e)) }) as never;

  it("una decisión YA EDITADA: su acción, su intensidad, su nota, sus restricciones de seguridad y sus peticiones de apoyo siguen ahí", () => {
    const previous = review({ action: "edited", reason: "Alternativa de una resolución anterior", restrictions: ["Restricción de seguridad previa."], support_requests: [{ kind: "glossary", min_items: 1 }], edits: { intensity: "light", note: "nota previa", supports: [{ kind: "glossary", uses_task_data: false }] } });
    const s = support();
    const out = planRepair(raw, previous, loaded, asks, "motivo", s)!;
    const entry = out.review.entries.find((e) => e.decision_id === "dec_6")!;
    expect(entry.action).toBe("edited");
    expect(entry.reason).toBe("Alternativa de una resolución anterior");
    expect(entry.restrictions![0]).toBe("Restricción de seguridad previa.");
    expect(entry.restrictions!.length).toBeGreaterThan(1);
    expect(entry.support_requests).toEqual([{ kind: "glossary", min_items: 1 }]);
    expect(entry.edits).toMatchObject({ intensity: "light", note: "nota previa" });
    expect(entry.edits!.supports!.map((x) => x.kind).sort()).toEqual(["glossary", "guiding_questions"]);
    expect(s.trace).toEqual([expect.objectContaining({ decision_id: "dec_6", action: "substituted" })]);
    expect(out.restricted).toEqual(["dec_6"]);
  });

  it("una decisión aprobada sin ediciones pasa a editada SOLO en sus apoyos, con el motivo de la sustitución", () => {
    const out = planRepair(raw, review({ action: "approved", reason: "Sin avisos" }), loaded, asks, "motivo", support())!;
    const entry = out.review.entries.find((e) => e.decision_id === "dec_6")!;
    expect(entry).toMatchObject({ action: "edited", reason: SUBSTITUTION_REASON });
    expect(Object.keys(entry.edits!)).toEqual(["supports"]);
  });

  it("una resolución autónoma de V2.2 (variante segura de una decisión retenida): se sustituye el apoyo y se conserva la variante segura", () => {
    const decisionWithHint = { ...decision("dec_6"), supports: [{ kind: "checklist" as const, uses_task_data: true }, { kind: "glossary" as const, uses_task_data: false }] };
    const plan = { ...raw, decisions: raw.decisions.map((d) => (d.id === "dec_6" ? decisionWithHint : d)) };
    const base = resolveAutomatically(plan, k.analysis, k.context).review;
    const declarations = { rules: null, decisions: { dec_6: { status: "active", question: null, hint_yes: [], precedents: [], withheld: true } }, teacher_questions: [], residual_barriers: [], issues: [{ decision_id: "dec_6", code: "blocking_hint", message: "pista" }] } as never;
    const autonomous = resolveWithheldAutonomously(base, plan, declarations, k.analysis, k.context);
    const entry0 = autonomous.review.entries.find((e) => e.decision_id === "dec_6")!;
    expect(entry0).toMatchObject({ action: "edited" });
    expect(entry0.edits!.supports!.map((x) => x.kind)).toEqual(["glossary"]);
    const out = planRepair(plan, autonomous.review, loaded, asks, "motivo", support());
    const entry = out!.review.entries.find((e) => e.decision_id === "dec_6")!;
    expect(entry.reason).toBe(entry0.reason);
    expect(entry.edits!.supports!.map((x) => x.kind).sort()).toEqual(["glossary", "guiding_questions"]);
    // Nada más cambió: las demás decisiones, tal cual.
    expect(out!.review.entries.filter((e) => e.decision_id !== "dec_6")).toEqual(autonomous.review.entries.filter((e) => e.decision_id !== "dec_6"));
  });

  it("si las restricciones ya no caben (seis), NO se sustituye pisando ninguna: la decisión sigue el escalón siguiente (dejarla fuera solo si hay cobertura)", () => {
    const previous = review({ action: "approved", reason: "Sin avisos", restrictions: ["1", "2", "3", "4", "5", "6"] });
    const s = support();
    const out = planRepair(raw, previous, loaded, asks, "motivo", s);
    expect(s.trace.map((r) => r.action)).not.toContain("substituted");
    // El glosario es lo único que atiende el vocabulario y el conocimiento previo de 3a (necesidades bajas): sin otra decisión que las alcance, queda registrado como sin cubrir y se entrega.
    expect(s.trace).toEqual([expect.objectContaining({ action: "omitted", coverage: "none", uncovered: expect.arrayContaining(["vocabulary_support"]) })]);
    expect(out!.review.entries.find((e) => e.decision_id === "dec_6")).toMatchObject({ action: "rejected" });
  });

  it("una sustitución nunca se repite: con una anterior registrada se pasa a dejarla fuera", () => {
    const s = { ...support(), alreadySubstituted: new Set(["dec_6"]) };
    planRepair(raw, review({ action: "approved", reason: "Sin avisos" }), loaded, asks, "motivo", s);
    expect(s.trace.map((r) => r.action)).toEqual(["omitted"]);
  });
});
