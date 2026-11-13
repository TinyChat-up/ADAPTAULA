import { describe, expect, it } from "vitest";
import { checkPedagogicalScope, pedagogicalAreaFor } from "@/lib/adaptation/pedagogical-scope";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";

const profile: FunctionalProfile = { ...emptyFunctionalProfile(), schema_version: 3, pedagogy: { areas: [
  { subject: "conocimiento-medio", reference_grade: "3-primaria", knows: ["Reconoce partes de una planta"], needs: ["Relaciona las partes con su función"] },
  { subject: "matematicas", reference_grade: null, knows: [], needs: [] },
], response_preferences: ["oral"], adaptation_preferences: ["curricular"] } };
const analysis = fractionsAnalysis();

describe("alcance pedagógico propuesto", () => {
  it("solo utiliza el área exacta y mantiene desconocido un nivel no valorado", () => {
    expect(pedagogicalAreaFor(profile, "conocimiento-medio")?.reference_grade).toBe("3-primaria");
    expect(pedagogicalAreaFor(profile, "matematicas")?.reference_grade).toBeNull();
    expect(pedagogicalAreaFor(profile, null)).toBeNull();
    expect(pedagogicalAreaFor(profile, "Ciencias")).toBeNull();
    expect(pedagogicalAreaFor({ ...profile, schema_version: 2 }, "conocimiento-medio")).toBeNull();
  });
  it("una preferencia curricular nunca equivale a una autorización para la ficha", () => {
    expect(checkPedagogicalScope({ version: 1, type: "curricular" }, analysis)).toEqual({ ok: false, reason: "invalid_choice" });
    expect(checkPedagogicalScope({ version: 1, type: "accessibility" }, analysis)).toMatchObject({ ok: true, affected_activities: [] });
    expect(checkPedagogicalScope({ version: 1, type: "methodological" }, analysis)).toMatchObject({ ok: true, affected_activities: [] });
  });
  it("rechaza una autorización para otro análisis, objetivos desconocidos y listas vacías", () => {
    const base = { version: 1, type: "curricular", analysis_fingerprint: fingerprint(analysis), objective_ids: ["obj_9999"] };
    expect(checkPedagogicalScope(base, analysis)).toEqual({ ok: false, reason: "unknown_objective" });
    expect(checkPedagogicalScope({ ...base, objective_ids: [] }, analysis)).toEqual({ ok: false, reason: "invalid_choice" });
    expect(checkPedagogicalScope({ ...base, analysis_fingerprint: "a".repeat(64) }, analysis)).toEqual({ ok: false, reason: "stale_analysis" });
  });
  it("solo incluye actividades enteramente dentro de los objetivos autorizados", () => {
    const a = structuredClone(analysis);
    a.pedagogical_intent.objectives = [{ id: "obj_1", text: "A" }, { id: "obj_2", text: "B" }];
    a.activities = [ { ...a.activities[0]!, id: "act_1", objective_ids: ["obj_1"] }, { ...a.activities[0]!, id: "act_2", objective_ids: ["obj_1", "obj_2"] }, { ...a.activities[0]!, id: "act_3", objective_ids: [] } ];
    const choice = { version: 1, type: "curricular", analysis_fingerprint: fingerprint(a), objective_ids: ["obj_1"] };
    expect(checkPedagogicalScope(choice, a)).toMatchObject({ ok: true, affected_activities: ["act_1"] });
    expect(checkPedagogicalScope({ ...choice, objective_ids: ["obj_1", "obj_2"] }, a)).toMatchObject({ ok: true, affected_activities: ["act_1", "act_2"] });
  });
});
