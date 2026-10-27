import { describe, expect, it } from "vitest";
import { activityName, groupActivities } from "@/lib/analysis/activity-groups";
import { diagnosisLines } from "@/lib/adaptation/presentation/view-model";

const acts = (labels: Array<string | null>) => labels.map((label, i) => ({ id: `act_${i + 1}`, label }));

describe("main activities and their parts, from the printed labels", () => {
  it("the cell sheet: 5 exercises, 9 entries (3a/3b and the lettered statements are parts, not new activities)", () => {
    const groups = groupActivities(acts(["1", "2", "3a", "3b", "4", "a)", "b)", "c)", "5"]));
    expect(groups.map((g) => [g.key, g.ids.length])).toEqual([["1", 1], ["2", 1], ["3", 2], ["4", 4], ["5", 1]]);
    expect(activityName(groups, "act_7")).toBe("la actividad 4");
  });

  it("«Actividad 2», «2.» and «Ejercicio 3» are numbered; an entry without label stands on its own", () => {
    expect(groupActivities(acts(["Actividad 1", "2.", "Ejercicio 3", null])).map((g) => g.key)).toEqual(["1", "2", "3", "4"]);
    expect(groupActivities(acts(["a)", "b)"])).map((g) => g.ids.length)).toEqual([1, 1]);
  });
});

describe("why a sheet could not be delivered", () => {
  it("names the activity and the reason the pipeline recorded; nothing when nothing was recorded", () => {
    expect(diagnosisLines({ qualityDiagnosis: { stage: "generation", items: [{ category: "data_loss", activities: ["la actividad 3"] }, { category: "answer_leak", activities: [] }] } })).toEqual([
      "No hemos podido completar la actividad 3 porque la adaptación no conserva toda la información necesaria (datos, condiciones o elementos que hay que mantener).",
      "No hemos podido completar la ficha porque la adaptación dejaba ver la respuesta.",
    ]);
    expect(diagnosisLines({ qualityDiagnosis: null })).toEqual([]);
  });
});
