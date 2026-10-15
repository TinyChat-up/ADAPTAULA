import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adapt } from "../../evals/pedagogical-quality/adapter";
import { ReferenceSheetSchema, TeacherValidationSchema } from "../../evals/pedagogical-quality/contract";
import { evaluate } from "../../evals/pedagogical-quality/evaluate";
import { isConfirmationValid, reviewRequestFromLocator, type FigureReview } from "../../evals/pedagogical-quality/figure-review";
import { FIXTURE_CASES } from "../../evals/pedagogical-quality/fixtures";
import { runCase, summarize } from "../../evals/pedagogical-quality/metrics";
import { applyMutation } from "../../evals/pedagogical-quality/mutations";

const results = FIXTURE_CASES.map(runCase);
const byId = (id: string) => FIXTURE_CASES.find((c) => c.reference.id === id)!;

describe("referencias: nada cuenta como validado por un docente", () => {
  it("todas las referencias sintéticas son provisionales", () => {
    expect(FIXTURE_CASES.map((c) => c.reference.validation.status)).toEqual(FIXTURE_CASES.map(() => "sintetica_provisional"));
    expect(summarize(results).teacherValidatedReferences).toBe(0);
  });

  it("«aprobada por docente» exige el registro de la revisión ligado a la versión revisada", () => {
    expect(TeacherValidationSchema.safeParse({ status: "aprobada_docente" }).success).toBe(false);
    expect(TeacherValidationSchema.safeParse({ status: "aprobada_docente", reviewer: "docente", reviewedAt: "2026-10-15T10:00:00Z", comments: "" }).success).toBe(false);
    expect(TeacherValidationSchema.safeParse({ status: "revisada_docente", reviewer: "Ana", reviewedAt: "2026-10-15T10:00:00Z", referenceSha256: "a".repeat(64), comments: "" }).success).toBe(false);
  });

  it("una referencia sin barreras o sin cambios inaceptables no es válida", () => {
    const ref = byId("fx_lectura_faro").reference;
    expect(ReferenceSheetSchema.safeParse({ ...ref, barriers: [] }).success).toBe(false);
    expect(ReferenceSheetSchema.safeParse({ ...ref, unacceptableChanges: [] }).success).toBe(false);
  });
});

describe("evaluación de adaptaciones correctas", () => {
  it("ninguna adaptación correcta ni la copia literal se bloquea", () => {
    for (const r of results) for (const c of r.candidates) expect([r.caseId, c.plan, c.evaluation.verdict]).toEqual([r.caseId, c.plan, "NEEDS_TEACHER_REVIEW"]);
  });

  it("nunca hay veredicto PASS: el juicio pedagógico queda para el docente", () => {
    for (const r of results) {
      for (const e of [...r.candidates.map((c) => c.evaluation), ...r.mutations.map((m) => m.evaluation)]) {
        expect(["FAIL", "NEEDS_TEACHER_REVIEW"]).toContain(e.verdict);
        expect(e.findings.some((f) => f.check === "aprendizaje_preservado" && f.status === "NEEDS_TEACHER_REVIEW")).toBe(true);
      }
    }
  });

  it("es determinista", () => {
    const c = FIXTURE_CASES[0]!;
    const sheet = adapt(c.original, c.plans[0]!);
    expect(evaluate(c.reference, sheet)).toEqual(evaluate(c.reference, sheet));
  });
});

describe("errores introducidos", () => {
  it("cada error verificable falla en la comprobación esperada", () => {
    const missed = results.flatMap((r) => r.mutations.filter((m) => m.mutation.verifiable && !m.detected).map((m) => `${r.caseId}/${m.mutation.id}`));
    expect(missed).toEqual([]);
  });

  it("un error no verificable nunca sale mejor que «pendiente de revisión docente»", () => {
    const soft = results.flatMap((r) => r.mutations.filter((m) => !m.mutation.verifiable));
    expect(soft.length).toBeGreaterThan(0);
    for (const m of soft) expect(["FAIL", "NEEDS_TEACHER_REVIEW"]).toContain(m.evaluation.verdict);
  });

  it("3/4 → 2/4 se detecta como dato cambiado", () => {
    const c = byId("fx_fracciones_pizza");
    const base = adapt(c.original, c.plans[0]!);
    const e = evaluate(c.reference, applyMutation(base, c.mutations.find((m) => m.id === "fraccion_3_4_a_2_4")!));
    expect(e.findings.find((f) => f.check === "numeros" && f.activityId === "act_3")).toMatchObject({ status: "FAIL" });
  });

  it("una mutación cuyo texto no existe es un error de autoría, no un caso silencioso", () => {
    const c = byId("fx_problemas_autobus");
    const base = adapt(c.original, c.plans[0]!);
    expect(() => applyMutation(base, { id: "x", errorType: "cambio_dato", description: "", verifiable: true, expect: null, ops: [{ op: "replace", activity: "act_1", target: "content", find: "no existe", replace: "" }] })).toThrow();
  });

  it("cubre las seis familias pedidas", () => {
    expect(new Set(FIXTURE_CASES.map((c) => c.reference.activityType))).toEqual(new Set(["fracciones", "numeracion_calculo", "comprension_lectora", "ciencias", "esquema_etiquetado", "geometria"]));
  });
});

describe("separación entre adaptador y referencia", () => {
  it("el adaptador controlado no lee la referencia ni las respuestas", () => {
    const src = readFileSync(join(__dirname, "../../evals/pedagogical-quality/adapter.ts"), "utf8");
    const imports = src.split("\n").filter((l) => l.startsWith("import"));
    expect(imports.join("\n")).not.toMatch(/ReferenceSheet|fixtures|evaluate|metrics|cases/);
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/ReferenceSheet|\.answers\b|leakPatterns|unacceptableChanges|referenceAdaptation/);
  });
});

describe("revisión humana de figuras", () => {
  const sha = (c: string) => c.repeat(64);
  const region = { x: 0.1, y: 0.2, w: 0.5, h: 0.3 };
  const current = { materialSha256: sha("a"), page: 1, activityId: "act_1", visualId: "vis_1", region, cropSha256: sha("c") };
  const review: FigureReview = {
    request: { materialSha256: sha("a"), page: 1, activityId: "act_1", visualId: "vis_1", region, cropSha256: sha("c"), locatorVersion: "figure_geometry@v2", shownAt: "2026-10-15T10:00:00Z" },
    viewedCropSha256: sha("c"), decidedAt: "2026-10-15T10:01:00Z", reviewer: "docente",
    outcome: { decision: "confirm", checks: { belongsToActivity: true, complete: true, noAnswers: true } },
  };

  it("una confirmación completa sobre lo mismo que se vio es válida", () => {
    expect(isConfirmationValid(review, current)).toEqual({ valid: true });
  });

  it.each([
    ["el documento cambia", { ...current, materialSha256: sha("b") }],
    ["la región cambia", { ...current, region: { ...region, x: 0.11 } }],
    ["el recorte cambia", { ...current, cropSha256: sha("d") }],
    ["la página cambia", { ...current, page: 2 }],
    ["la actividad cambia", { ...current, activityId: "act_2" }],
  ])("deja de valer si %s", (_, now) => {
    expect(isConfirmationValid(review, now).valid).toBe(false);
  });

  it("no vale sin las tres comprobaciones marcadas", () => {
    const two = { belongsToActivity: true, complete: true };
    expect(isConfirmationValid({ ...review, outcome: { decision: "confirm", checks: two } }, current).valid).toBe(false);
    expect(isConfirmationValid({ ...review, outcome: { decision: "confirm", checks: { belongsToActivity: true, complete: false, noAnswers: true } } }, current).valid).toBe(false);
    expect(isConfirmationValid({ ...review, outcome: { decision: "confirm" } }, current).valid).toBe(false);
  });

  it("no vale si lo mostrado no es el recorte aprobado o si se decidió antes de verlo", () => {
    expect(isConfirmationValid({ ...review, viewedCropSha256: sha("e") }, current).valid).toBe(false);
    expect(isConfirmationValid({ ...review, decidedAt: "2026-10-15T09:59:00Z" }, current).valid).toBe(false);
  });

  it("corregir o rechazar no es confirmar", () => {
    expect(isConfirmationValid({ ...review, outcome: { decision: "correct", correctedRegion: { x: 0.1, y: 0.2, w: 0.6, h: 0.3 } } }, current).valid).toBe(false);
    expect(isConfirmationValid({ ...review, outcome: { decision: "reject", reason: "contiene_respuestas" } }, current).valid).toBe(false);
  });

  it("parte de la candidata del localizador, que sigue bloqueada", () => {
    const ctx = { materialSha256: sha("a"), page: 1, activityId: "act_1", cropSha256: sha("c"), shownAt: "2026-10-15T10:00:00Z" };
    expect(reviewRequestFromLocator({ visualId: "vis_1", candidate: null, verifier: "figure_geometry@v2", decision: "blocked", crop: null }, ctx)).toBeNull();
    const req = reviewRequestFromLocator({ visualId: "vis_1", candidate: region, verifier: "figure_geometry@v2", decision: "blocked", crop: null }, ctx);
    expect(req).toMatchObject({ region, locatorVersion: "figure_geometry@v2" });
  });
});
