import { describe, expect, it } from "vitest";
import { FunctionalProfileSchema, emptyFunctionalProfile } from "@/lib/schemas/functional-profile";
import { compactProfile, setSupport, addPresets, replaceSupports } from "@/lib/profiles/draft";
import { validPedagogicalAreas } from "@/lib/profiles/catalog";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";

const pedagogy = { areas: [{ subject: "conocimiento-medio", reference_grade: "3-primaria", knows: ["Reconoce partes de una planta"], needs: ["Explicar sus funciones"] }, { subject: "matematicas", reference_grade: null, knows: [], needs: [] }], response_preferences: ["oral" as const, "match" as const], adaptation_preferences: ["accessibility" as const, "curricular" as const] };
const profile = { ...emptyFunctionalProfile(), schema_version: 3 as const, supports: { visual_support: "medium" as const, high_contrast: "none" as const }, observations: { strengths: ["oral_expression" as const], barriers: ["written_expression" as const] }, pedagogy };

describe("perfil pedagógico V3", () => {
  it("lee V1/V2 y conserva el nuevo perfil al editar, combinar y compactar", () => {
    expect(FunctionalProfileSchema.parse({ schema_version: 1, supports: {}, limits: {}, allowances: {} }).pedagogy).toBeUndefined();
    expect(FunctionalProfileSchema.parse(emptyFunctionalProfile()).pedagogy).toBeUndefined();
    expect(FunctionalProfileSchema.parse(profile)).toEqual(profile);
    expect(compactProfile(profile).supports.high_contrast).toBe("none");
    const changed = setSupport(profile, "visual_support", "high");
    expect(changed.schema_version).toBe(3);
    expect(changed.pedagogy).toEqual(pedagogy);
    const preset = { id: "test", label: "Prueba", description: "", supports: { visual_support: "medium" as const } };
    expect(addPresets(changed, [preset]).pedagogy).toEqual(pedagogy);
    expect(replaceSupports(changed, [preset]).pedagogy).toEqual(pedagogy);
  });
  it("valida listas y evita campos desconocidos y versiones antiguas con datos nuevos", () => {
    expect(FunctionalProfileSchema.safeParse({ ...profile, schema_version: 2 }).success).toBe(false);
    expect(FunctionalProfileSchema.safeParse({ ...profile, pedagogy: { ...pedagogy, diagnosis: "dato" } }).success).toBe(false);
    expect(FunctionalProfileSchema.safeParse({ ...profile, pedagogy: { ...pedagogy, areas: [pedagogy.areas[0], pedagogy.areas[0]] } }).success).toBe(false);
    expect(FunctionalProfileSchema.safeParse({ ...profile, pedagogy: { ...pedagogy, areas: [{ ...pedagogy.areas[0], knows: ["x".repeat(181)] }] } }).success).toBe(false);
  });
  it("valida áreas y niveles contra el catálogo, sin inferir otros niveles", () => {
    const catalog = { stages: [], grades: [{ slug: "3-primaria", stage_slug: "primaria", name: "Tercero" }], subjects: [{ slug: "conocimiento-medio", name: "Ciencias" }, { slug: "matematicas", name: "Matemáticas" }] };
    expect(validPedagogicalAreas(catalog, pedagogy.areas)).toBe(true);
    expect(validPedagogicalAreas(catalog, [{ subject: "otra", reference_grade: null }])).toBe(false);
    expect(validPedagogicalAreas(catalog, [{ subject: "matematicas", reference_grade: "curso-inventado" }])).toBe(false);
    expect(profile.pedagogy.areas[1]!.reference_grade).toBeNull();
  });
  it("no envía los campos nuevos al contexto ni cambia la huella del planificador", () => {
    const analysis = fractionsAnalysis();
    const args = { analysis, education: { stage: "primaria", grade: "5-primaria", subject: "matematicas" }, adaptationType: "accessibility" as const };
    const withNew = buildAdaptationContext({ ...args, profile });
    const withoutNew = { ...profile, pedagogy: undefined };
    expect(withNew.context).toEqual(buildAdaptationContext({ ...args, profile: withoutNew }).context);
    expect(JSON.stringify(withNew.context)).not.toContain("Reconoce partes de una planta");
    expect(withNew.context.adaptation_type).toBe("accessibility");
  });
});
