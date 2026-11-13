import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import { createAndStartAdaptation, getAdaptationVersion, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { protectedFor } from "@/lib/adaptation/facts";
import type { AdaptationPlanner } from "@/lib/adaptation/services";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import { allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { pondAnalysis } from "../support/pond-case";
import { createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedMaterial, versions } from "./orchestration-harness";

/**
 * Perfil V3 → «Hacer magia», de extremo a extremo (migraciones reales sobre PGlite; planificador, generador y revisor SIMULADOS: 0 llamadas
 * reales). Ficha «Un estanque en equilibrio» (5.º de Primaria, Conocimiento del Medio). Dos casos pedagógicos:
 *   A · dificultades lectoras, adaptación de ACCESO: mismos objetivos y misma forma de responder, apoyos donde el docente declara que hay que reforzar;
 *   B · dificultad de escritura, adaptación METODOLÓGICA: mismos objetivos, la forma de responder cambia solo a formatos que se pueden ejecutar.
 * Y la prueba curricular de 5.º a 3.º, documentada como pendiente: hoy se rechaza, nunca se simula.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(() => db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'"));

const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const SUBJECT = "conocimiento-medio";
const DECLARED_NEED = "Relaciones alimentarias y sus consecuencias en un ecosistema";
const DECLARED_KNOWS = "Distingue seres vivos de objetos";

const profileOf = (supports: FunctionalProfile["supports"], pedagogy?: FunctionalProfile["pedagogy"]): FunctionalProfile => ({ ...emptyFunctionalProfile(), schema_version: pedagogy ? 3 : 2, supports, ...(pedagogy ? { pedagogy } : {}) });
const area = { subject: SUBJECT, reference_grade: "3-primaria", knows: [DECLARED_KNOWS], needs: [DECLARED_NEED] };

/** A · lectura: decodificación alta, vocabulario e inferencias medias. */
const READING = { decoding_support: "high", vocabulary_support: "medium", inferential_demand: "medium" } as const;
/** B · escritura: cantidad de escritura alta, motricidad fina media. */
const WRITING = { writing_amount: "high", fine_motor_demand: "medium" } as const;

type PlanInput = Parameters<AdaptationPlanner["plan"]>[0];
let n = 0;
async function magic(script: { profile: FunctionalProfile; type: "accessibility" | "methodological" | "curricular"; planner?: (inner: AdaptationPlanner, call: number, input: PlanInput) => ReturnType<AdaptationPlanner["plan"]>; subject?: string | null }) {
  const u = await createUser(db, `scope-${++n}@example.com`);
  const analysis = pondAnalysis();
  const material = await seedMaterial(db, u, analysis);
  await db.query("update public.materials set subject_slug = $2, stage_slug = 'primaria', grade_slug = '5-primaria' where id = $1", [material, script.subject === undefined ? SUBJECT : script.subject]);
  const learner = (await q<{ id: string }>("insert into public.learner_profiles (workspace_id, display_name, created_by, functional_profile) values ($1, 'Alumno de prueba', $2, $3) returning id", [u.workspaceId, u.id, JSON.stringify(script.profile)]))[0]!.id;
  const spy = newSpy();
  const seen: PlanInput[] = [];
  const planner = async (inner: AdaptationPlanner, call: number, input: PlanInput) => {
    seen.push(input);
    return script.planner ? script.planner(inner, call, input) : inner.plan(input);
  };
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner }));
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, u), resolveVersions: versions };
  const actor: Actor = { userId: u.id, workspaceId: u.workspaceId, canWrite: true };
  const created = await createAndStartAdaptation(deps, actor, { materialId: material, learnerProfileId: learner, adaptationType: script.type, requestKey: `scope-${n}-${Math.random()}`, creationMode: "automatic" });
  if (!created.ok) return { created, analysis } as const;
  const id = created.data.adaptationId;
  for (let i = 0; i < 40; i++) if (!(await processAdaptationStage(orchestrator, id))) break;
  const row = (await q<{ status: string; context_snapshot: AdaptationContext; adaptation_type: string }>("select status, context_snapshot, adaptation_type from public.adaptations where id = $1", [id]))[0]!;
  const version = await getAdaptationVersion(deps, actor, id);
  const document = version.ok ? (version.data.document as MaterialDocument) : null;
  const review = (await q<{ review: PedagogicalReview | null }>("select review from public.adaptation_versions where adaptation_id = $1 order by version desc limit 1", [id]))[0]?.review ?? null;
  const outcomes = (await q<{ payload: { automatic?: { outcomes?: Array<{ decision_id: string; kind: string; reason: string }> } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'execution_report' order by created_at", [id])).flatMap((r) => r.payload.automatic?.outcomes ?? []);
  const plan = (await q<{ payload: { decisions: Array<{ id: string; target: string; action: string; response_target?: string; dimensions: string[] }> } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'plan' order by created_at desc limit 1", [id]))[0]?.payload ?? null;
  return { created, id, analysis, spy, seen, context: row.context_snapshot, status: row.status, type: row.adaptation_type, document, review, outcomes, plan } as const;
}

const activityBlocks = (doc: MaterialDocument) => allBlocks(doc).filter((b): b is Extract<Block, { type: "activity" }> => b.type === "activity");
const responseOf = (doc: MaterialDocument, activity: string) => activityBlocks(doc).find((b) => b.trace.source_refs.includes(activity))!.response;
const check = (review: PedagogicalReview | null | undefined, key: string) => review?.checks.filter((c) => c.check === key).map((c) => c.status) ?? [];
const supportsOn = (doc: MaterialDocument, activity: string) => allBlocks(doc).filter((b) => b.trace.origin === "support" && b.trace.source_refs.includes(activity));

describe("A · 5.º con dificultades lectoras, adaptación de ACCESO: mismos objetivos, apoyos donde hace falta", () => {
  it("el perfil V3 llega a la ficha: alcance de acceso, área exacta y actividades que trabajan lo que el docente declara por reforzar", async () => {
    const t = await magic({ profile: profileOf(READING, { areas: [area, { subject: "matematicas", reference_grade: "5-primaria", knows: ["Suma fracciones"], needs: ["Problemas de varias operaciones"] }], response_preferences: ["oral"], adaptation_preferences: ["accessibility"] }), type: "accessibility" });
    expect(t.status).toBe("ready");
    expect(t.context!.pedagogy).toMatchObject({ scope: "accessibility", area_matched: true });
    // Las tres actividades cuyo objetivo es «interpretar relaciones alimentarias y sus consecuencias» (3a, 3b y 4b).
    expect(t.context!.pedagogy!.focus_targets).toEqual(["act_3", "act_4", "act_6"]);
    expect(t.context!.pedagogy).not.toHaveProperty("response");
    expect(t.context!.conflicts.find((c) => c.key === "declared_learning_focus")).toMatchObject({ targets: ["act_3", "act_4", "act_6"], rule: "functional_need" });
  });

  it("…y produce decisiones observables: un apoyo en cada una de esas actividades, trazado a su decisión y a su necesidad", async () => {
    const withV3 = await magic({ profile: profileOf(READING, { areas: [area], response_preferences: [], adaptation_preferences: [] }), type: "accessibility" });
    const without = await magic({ profile: profileOf(READING), type: "accessibility" });
    for (const activity of ["act_3", "act_4", "act_6"]) {
      expect(supportsOn(withV3.document!, activity).length, activity).toBeGreaterThan(0);
      expect(supportsOn(without.document!, activity), activity).toEqual([]);
      const decision = withV3.plan!.decisions.find((d) => d.target === activity && d.action === "add_support")!;
      expect(decision.dimensions).toEqual(["decoding_support"]);
      expect(supportsOn(withV3.document!, activity)[0]!.trace.decision_ids).toEqual([decision.id]);
    }
    // Sin datos V3 el contexto es el de siempre: ni alcance ni resoluciones nuevas.
    expect(without.context!.pedagogy).toBeUndefined();
    expect(without.context!.conflicts.some((c) => c.key === "declared_learning_focus" || c.key === "access_scope_keeps_response")).toBe(false);
  });

  it("mismos objetivos y misma forma de responder: todas las actividades, sus respuestas originales y los objetivos comprobados", async () => {
    const withV3 = await magic({ profile: profileOf(READING, { areas: [area], response_preferences: ["oral", "match"], adaptation_preferences: [] }), type: "accessibility" });
    const without = await magic({ profile: profileOf(READING), type: "accessibility" });
    expect(activityBlocks(withV3.document!)).toHaveLength(withV3.analysis.activities.length);
    for (const a of withV3.analysis.activities) expect(responseOf(withV3.document!, a.id), a.id).toEqual(responseOf(without.document!, a.id));
    expect(check(withV3.review, "objectives_preserved")).toEqual(["PASS"]);
    expect(check(withV3.review, "protected_elements_preserved")).toEqual(["PASS"]);
    expect(withV3.plan!.decisions.some((d) => d.action === "change_response_format" || d.response_target)).toBe(false);
  });

  it("privacidad: ni el texto declarado, ni el nivel de referencia, ni otra área salen del servidor (ni al contexto guardado ni al planificador)", async () => {
    const t = await magic({ profile: profileOf(READING, { areas: [area, { subject: "matematicas", reference_grade: "2-primaria", knows: ["Cuenta hasta cien"], needs: ["Restas con llevadas"] }], response_preferences: ["oral"], adaptation_preferences: ["curricular"] }), type: "accessibility" });
    expect(t.created.ok).toBe(true);
    const sent = JSON.stringify(t.seen!.map((s) => ({ context: s.context, material: s.material })));
    const stored = JSON.stringify(t.context);
    for (const text of [sent, stored]) {
      expect(text).not.toContain(DECLARED_NEED);
      expect(text).not.toContain(DECLARED_KNOWS);
      expect(text).not.toMatch(/3-primaria|2-primaria|reference_grade|Restas con llevadas|Cuenta hasta cien|adaptation_preferences|curricular"/);
      expect(text).not.toMatch(/Alumno de prueba|display_name/);
    }
  });

  it("el área solo cuenta si es EXACTAMENTE la de la ficha: otra asignatura, o una ficha sin asignatura, no aportan nada", async () => {
    const other = await magic({ profile: profileOf(READING, { areas: [{ ...area, subject: "matematicas" }], response_preferences: [], adaptation_preferences: [] }), type: "accessibility" });
    expect(other.context!.pedagogy).toMatchObject({ scope: "accessibility", area_matched: false, focus_targets: [] });
    const unknown = await magic({ profile: profileOf(READING, { areas: [area], response_preferences: [], adaptation_preferences: [] }), type: "accessibility", subject: null });
    expect(unknown.context!.pedagogy).toMatchObject({ area_matched: false, focus_targets: [] });
    expect(unknown.status).toBe("ready");
  });

  it("un planificador que intente cambiar la forma de responder en una adaptación de acceso es RECHAZADO por el servidor, y la ficha se entrega con la respuesta original", async () => {
    const profile = profileOf({ ...READING, writing_amount: "medium" }, { areas: [area], response_preferences: ["oral"], adaptation_preferences: [] });
    const t = await magic({
      profile,
      type: "accessibility",
      planner: async (_inner, _call, input) => {
        const ref = (dim: string) => `need_${input.context.needs.findIndex((x) => x.dimension === dim) + 1}`;
        return { draft: { decisions: [{ target: "act_1", action: "change_response_format", strategies: ["response_format"], need_refs: [ref("writing_amount")], intensity: "moderate", preserves: protectedFor(pondAnalysis(), "act_1").map((p) => p.id), response_target: "oral_or_alternative" }], summary: ["x"] }, runs: [] } as never;
      },
    });
    // La necesidad de escribir menos sigue en el contexto, pero solo con la estrategia que no cambia la respuesta.
    expect(t.context!.needs.find((x) => x.dimension === "writing_amount")!.strategies).toEqual(["response_format"]);
    expect(t.context!.conflicts.find((c) => c.key === "access_scope_keeps_response")).toMatchObject({ dimensions: ["writing_amount"], rule: "pedagogical_integrity" });
    expect(t.outcomes!.find((o) => o.decision_id === "dec_1")).toMatchObject({ kind: "left_out_blocked" });
    expect(t.status).toBe("ready");
    expect(responseOf(t.document!, "act_1").kind).toBe("lines");
  });
});

describe("B · 5.º con dificultad de escritura, adaptación METODOLÓGICA: mismos objetivos, respuesta adaptada con formatos que existen", () => {
  const V3 = { areas: [area], response_preferences: ["oral", "match", "fill_blanks"] as const, adaptation_preferences: ["methodological"] as const };
  const pedagogy = { areas: V3.areas, response_preferences: [...V3.response_preferences], adaptation_preferences: [...V3.adaptation_preferences] };

  it("los formatos disponibles salen del perfil y de lo que se puede ejecutar: oral primero (necesidad alta y opción declarada), breve después; unir y completar, declarados pero no disponibles", async () => {
    const t = await magic({ profile: profileOf(WRITING, pedagogy), type: "methodological" });
    expect(t.type).toBe("methodological");
    expect(t.context!.pedagogy).toMatchObject({ scope: "methodological", response: { available: ["oral_or_alternative", "write_text_short"], unavailable: ["match", "fill_blanks"] } });
    const guidance = t.context!.conflicts.find((c) => c.key === "methodological_response_formats")!;
    expect(guidance.dimensions).toEqual(["writing_amount", "fine_motor_demand"]);
    expect(guidance.guidance).toMatch(/respuesta oral, respuesta escrita breve/);
    expect(guidance.guidance).toMatch(/Aún no disponibles: unir, completar/);
  });

  it("la ficha cambia de verdad: las actividades de escribir pasan a respuesta oral; la de calcular y la de clasificar en su tabla no se tocan", async () => {
    const t = await magic({ profile: profileOf(WRITING, pedagogy), type: "methodological" });
    expect(t.status).toBe("ready");
    for (const activity of ["act_1", "act_3", "act_4", "act_6", "act_7", "act_8"]) expect(responseOf(t.document!, activity), activity).toMatchObject({ kind: "oral_or_alternative", mode: "oral" });
    expect(responseOf(t.document!, "act_5").kind).not.toBe("oral_or_alternative");
    expect(responseOf(t.document!, "act_2").kind).toBe("table_cells");
    // Cada cambio está trazado a su decisión y a la necesidad funcional que lo justifica.
    const changes = t.plan!.decisions.filter((d) => d.action === "change_response_format");
    expect(changes.map((d) => d.target)).toEqual(["act_1", "act_3", "act_4", "act_6", "act_7", "act_8"]);
    expect(changes.every((d) => d.dimensions.includes("writing_amount") && d.response_target === "oral_or_alternative")).toBe(true);
  });

  it("mismos objetivos: ninguna actividad se pierde, los elementos protegidos y los objetivos se comprueban, y el proceso es autónomo (una generación)", async () => {
    const t = await magic({ profile: profileOf(WRITING, pedagogy), type: "methodological" });
    expect(activityBlocks(t.document!)).toHaveLength(t.analysis.activities.length);
    expect(check(t.review, "objectives_preserved")).toEqual(["PASS"]);
    expect(check(t.review, "protected_elements_preserved")).toEqual(["PASS"]);
    expect(t.review!.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(t.spy!.planner).toBe(1);
    expect(t.spy!.reviewer).toBe(1);
  });

  it("depende del perfil: con la necesidad media (o sin la opción oral declarada) el alumno sigue escribiendo, menos", async () => {
    const medium = await magic({ profile: profileOf({ writing_amount: "medium" }, pedagogy), type: "methodological" });
    expect(medium.context!.pedagogy!.response!.available).toEqual(["write_text_short", "oral_or_alternative"]);
    expect(responseOf(medium.document!, "act_1")).toMatchObject({ kind: "lines", lines: 2 });
    const noOral = await magic({ profile: profileOf(WRITING, { ...pedagogy, response_preferences: ["match"] }), type: "methodological" });
    expect(noOral.context!.pedagogy!.response).toEqual({ available: ["write_text_short"], unavailable: ["match"] });
    expect(responseOf(noOral.document!, "act_1").kind).toBe("lines");
  });

  it("no acepta una respuesta oral que el perfil no ha declarado, aunque la proponga el planificador", async () => {
    const t = await magic({
      profile: profileOf(WRITING, { ...pedagogy, response_preferences: [] }),
      type: "methodological",
      planner: async (_inner, _call, input) => {
        const ref = `need_${input.context.needs.findIndex((x) => x.dimension === "writing_amount") + 1}`;
        return { draft: { decisions: [{ target: "act_3", action: "change_response_format", strategies: ["writing_load_reduction"], need_refs: [ref], intensity: "substantial", preserves: protectedFor(pondAnalysis(), "act_3").map((p) => p.id), response_target: "oral_or_alternative" }], summary: ["x"] }, runs: [] } as never;
      },
    });
    expect(t.context!.pedagogy!.response!.available).toEqual(["write_text_short"]);
    expect(t.status).toBe("ready");
    expect(t.document).not.toBeNull();
    expect(responseOf(t.document!, "act_3").kind).not.toBe("oral_or_alternative");
  });

  it("un formato cerrado que el sistema no puede validar (unir) NO se promete: se sustituye por el formato disponible del perfil y queda registrado", async () => {
    const t = await magic({
      profile: profileOf(WRITING, pedagogy),
      type: "methodological",
      planner: async (_inner, _call, input) => {
        const ref = (dim: string) => `need_${input.context.needs.findIndex((x) => x.dimension === dim) + 1}`;
        return { draft: { decisions: [{ target: "act_3", action: "change_response_format", strategies: ["writing_load_reduction"], need_refs: [ref("writing_amount")], intensity: "substantial", preserves: protectedFor(pondAnalysis(), "act_3").map((p) => p.id), response_target: "match" }], summary: ["x"] }, runs: [] } as never;
      },
    });
    expect(t.outcomes!.find((o) => o.decision_id === "dec_1")).toMatchObject({ kind: "alternative" });
    expect(t.outcomes!.find((o) => o.decision_id === "dec_1")!.reason).toMatch(/oral_or_alternative/);
    expect(responseOf(t.document!, "act_3").kind).toBe("oral_or_alternative");
    expect(t.status).toBe("ready");
  });

  it("la misma ficha y el mismo perfil, como adaptación de ACCESO: la forma de responder no cambia", async () => {
    const t = await magic({ profile: profileOf(WRITING, pedagogy), type: "accessibility" });
    expect(t.context!.pedagogy).toMatchObject({ scope: "accessibility" });
    expect(t.context!.pedagogy).not.toHaveProperty("response");
    for (const a of t.analysis.activities) expect(responseOf(t.document!, a.id).kind, a.id).not.toBe("oral_or_alternative");
    expect(t.plan!.decisions.some((d) => d.action === "change_response_format")).toBe(false);
  });
});

describe("perfiles antiguos y adaptación curricular", () => {
  it("un perfil V2 con adaptación de acceso se comporta como antes: sin alcance, sin resoluciones nuevas, mismas necesidades y estrategias", async () => {
    const t = await magic({ profile: profileOf({ ...READING, writing_amount: "medium" }), type: "accessibility" });
    expect(t.context!.pedagogy).toBeUndefined();
    expect(t.context!.needs.find((x) => x.dimension === "writing_amount")!.strategies).toEqual(["writing_load_reduction", "response_format"]);
    expect(t.status).toBe("ready");
  });

  it("un perfil antiguo también puede recibir una adaptación metodológica (sin opciones declaradas: respuesta breve)", async () => {
    const t = await magic({ profile: profileOf(WRITING), type: "methodological" });
    expect(t.context!.pedagogy).toMatchObject({ scope: "methodological", area_matched: false, response: { available: ["write_text_short"], unavailable: [] } });
    expect(responseOf(t.document!, "act_1")).toMatchObject({ kind: "lines", lines: 2 });
  });

  it("la adaptación curricular se RECHAZA hoy (necesita autorización por ficha): no se crea nada ni se simula, aunque el perfil la prefiera y declare 3.º", async () => {
    const t = await magic({ profile: profileOf(READING, { areas: [area], response_preferences: [], adaptation_preferences: ["curricular"] }), type: "curricular" });
    expect(t.created).toMatchObject({ ok: false, code: "invalid" });
    expect(await q("select 1 from public.adaptations a join public.learner_profiles l on l.id = a.learner_profile_id where l.display_name = 'Alumno de prueba' and a.adaptation_type = 'curricular'")).toEqual([]);
  });

  /**
   * PRUEBA CURRICULAR PENDIENTE (no implementada; debe pasar cuando existan la autorización por ficha y la transformación curricular):
   *   Alumno escolarizado en 5.º con competencia de 3.º en Conocimiento del Medio (`reference_grade: "3-primaria"`), ficha del estanque.
   *   1. Sin autorización para ESTA ficha (objetivos concretos + huella del análisis: `checkPedagogicalScope`), la adaptación curricular no se crea.
   *   2. Con autorización de `obj_3` y `obj_5`: solo las actividades enteramente dentro de esos objetivos (3a, 3b, 4b, 5 y 6) pueden cambiar
   *      contenidos y actividades hacia el nivel de 3.º; 1, 2 y 4a conservan su objetivo de 5.º.
   *   3. La revisión enumera cada objetivo modificado con su actividad y su transformación (trazabilidad actividad–objetivo–cambio), y un
   *      objetivo no autorizado que cambie bloquea la ficha.
   *   4. El nivel de referencia solo viaja al planificador en este modo; en acceso y metodológico no se envía (probado arriba).
   */
  it.todo("5.º con competencia de 3.º en el área: con autorización por ficha, contenidos y actividades adecuados a sus aprendizajes y objetivos modificados verificados");
});
