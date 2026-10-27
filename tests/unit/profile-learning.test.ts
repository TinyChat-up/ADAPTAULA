import { describe, expect, it } from "vitest";
import { FunctionalProfileSchema, activeSupports, emptyFunctionalProfile } from "@/lib/schemas/functional-profile";
import { addPresets, applyPreset, compactProfile, replaceSupports, setSupport } from "@/lib/profiles/draft";
import { summarizeProfile } from "@/lib/profiles/summary";
import { BARRIER_IDS, STRENGTH_IDS, suggestedSupports } from "@/lib/profiles/learning-catalog";
import { STARTING_POINTS, pointsInUse, presetForPoint } from "@/lib/profiles/starting-points";
import { buildAdaptationContext, contextFingerprint } from "@/lib/adaptation/context";
import { plannerContextV2 } from "@/lib/adaptation/plan-v2";
import { fractionsCaseAnalysis } from "../support/fractions-case";

const observations = { strengths: ["oral_expression" as const], barriers: ["written_expression" as const] };
const contextOf = (profile: ReturnType<typeof emptyFunctionalProfile>) => buildAdaptationContext({ profile, analysis: fractionsCaseAnalysis(), education: { stage: "primaria", grade: "4-primaria", subject: "matematicas" }, adaptationType: "accessibility", policy: 2 }).context;

describe("contrato compatible de perfil pedagógico", () => {
  it("lee V1 sin añadir observaciones ni cambiar sus apoyos", () => {
    const legacy = { schema_version: 1, supports: { visual_support: "medium" }, limits: {}, allowances: {} };
    expect(FunctionalProfileSchema.parse(legacy)).toEqual(legacy);
    expect(compactProfile(FunctionalProfileSchema.parse(legacy))).toEqual(legacy);
    expect(summarizeProfile(FunctionalProfileSchema.parse(legacy)).strengths).toEqual([]);
  });

  it("V2 conserva por separado lo no indicado y lo declarado innecesario", () => {
    const p = setSupport(emptyFunctionalProfile(), "visual_support", "none");
    expect(p.supports.visual_support).toBe("none");
    expect(p.supports.high_contrast).toBeUndefined();
    expect(pointsInUse(p)).toEqual([]);
    expect(activeSupports(p)).toEqual([]);
    expect(summarizeProfile(p).notNeeded).toEqual(["Usar apoyos visuales para comprender"]);
    expect(summarizeProfile(p).intro).toContain("lo demás sigue sin indicar");
    expect(setSupport(p, "visual_support", "unknown").supports.visual_support).toBeUndefined();
  });

  it("guarda y lee fortalezas y barreras independientes, con IDs validados", () => {
    const p = { ...emptyFunctionalProfile(), observations };
    expect(FunctionalProfileSchema.parse(JSON.parse(JSON.stringify(compactProfile(p))))).toEqual(p);
    expect(summarizeProfile(p)).toMatchObject({ strengths: ["Explica oralmente lo que sabe."], barriers: [expect.stringContaining("por escrito")], lines: [] });
  });

  it.each([
    { strengths: ["diagnostico"], barriers: [] },
    { strengths: [], barriers: ["nombre-completo"] },
    { ...observations, notes: "texto personal" },
    { strengths: ["oral_expression", "oral_expression"], barriers: [] },
  ])("rechaza datos ajenos al catálogo: %j", (invalid) => {
    expect(FunctionalProfileSchema.safeParse({ ...emptyFunctionalProfile(), observations: invalid }).success).toBe(false);
  });

  it("no interpreta nuevos campos como datos V1", () => {
    expect(FunctionalProfileSchema.safeParse({ ...emptyFunctionalProfile(), schema_version: 1, observations }).success).toBe(false);
  });
});

describe("combinación explícita y no destructiva", () => {
  it("combina imágenes para comprender, baja densidad y acceso visual como decisiones independientes", () => {
    const p = addPresets(emptyFunctionalProfile(), [presetForPoint("visual-understanding"), presetForPoint("load")]);
    expect(pointsInUse(p)).toEqual(["visual-understanding", "load"]);
    expect(p.supports.visual_support).toBe("medium");
    expect(p.supports.visual_density).toBe("medium");
    expect(p.supports.high_contrast).toBeUndefined();
    const accessible = addPresets(p, [presetForPoint("visual-access")]);
    expect(accessible.supports.visual_support).toBe("medium");
    expect(accessible.supports.high_contrast).toBe("medium");
    expect(accessible.supports.image_dependency).toBe("high");
    // Adding access alternatives does not silently remove the explanatory images requested by the teacher.
    expect(contextOf(accessible).presentation.text_alternatives_for_visuals).toBe(true);
  });

  it("añadir conserva intensidad mayor, límites, permisos, observaciones y el «no necesita» explícito", () => {
    const p = { ...emptyFunctionalProfile(), observations, supports: { visual_support: "none" as const, worked_examples: "high" as const }, limits: { max_visible_tasks: 2 }, allowances: { keyboard: true } };
    const combined = addPresets(p, [presetForPoint("visual-understanding"), presetForPoint("attention")]);
    expect(combined).toMatchObject({ observations, supports: { visual_support: "none", worked_examples: "high" }, limits: { max_visible_tasks: 2 }, allowances: { keyboard: true } });
    expect(p.supports).toEqual({ visual_support: "none", worked_examples: "high" });
  });

  it("la sustitución explícita solo sustituye configuración, conserva observaciones y no muta la versión anterior", () => {
    const previous = { ...applyPreset(presetForPoint("reading")), observations };
    const next = replaceSupports(previous, [presetForPoint("math")]);
    expect(next.observations).toEqual(observations);
    expect(next.supports.decoding_support).toBeUndefined();
    expect(previous.supports.decoding_support).toBe("high");
  });

  it("las sugerencias pertenecen a dimensiones reales, no activan apoyos al declarar una observación", () => {
    expect(STARTING_POINTS).toHaveLength(11);
    for (const id of BARRIER_IDS) expect(suggestedSupports([id]).length).toBeGreaterThan(0);
    expect(STRENGTH_IDS).toHaveLength(8);
    expect(contextOf({ ...emptyFunctionalProfile(), observations }).needs).toEqual([]);
    expect(summarizeProfile(applyPreset(presetForPoint("math"))).strengths).toEqual([]);
  });
});

describe("contexto real de adaptación y privacidad", () => {
  it("las observaciones llegan al contexto del planificador sin alias ni datos libres", () => {
    const context = contextOf({ ...addPresets(emptyFunctionalProfile(), [presetForPoint("math")]), observations });
    expect(plannerContextV2(context).learning_observations).toEqual(observations);
    expect(context.education.grade).toBe("4-primaria");
    expect(context.adaptation_type).toBe("accessibility");
    expect(context.needs.some((n) => n.dimension === "number_sense_support" && n.level === "high")).toBe(true);
    expect(JSON.stringify(context)).not.toMatch(/display_name|contextual_tags|diagnosis|learner_id/);
  });

  it("mantiene el fingerprint histórico si no hay observaciones y distingue los perfiles declarados", () => {
    const p = applyPreset(presetForPoint("math"));
    const v1 = { ...p, schema_version: 1 as const };
    expect(contextFingerprint(contextOf(v1))).toBe(contextFingerprint(contextOf(p)));
    expect(contextFingerprint(contextOf({ ...p, observations }))).not.toBe(contextFingerprint(contextOf(p)));
  });
});
