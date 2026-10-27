import { describe, expect, it } from "vitest";
import { containsTerm, requiredTerms } from "@/lib/adaptation/review-checks";
import { argumentationAnalysis } from "../../evals/adaptation/fixtures";
import { PROFILES } from "../../evals/adaptation/scenarios";
import { contextFor, documentOf, mutate, planOf, statusOf } from "./adaptation-helpers";

/**
 * Regression of the real «Hacer magia» stop (adaptation 2d78f548…, 1.º ESO, the cell): three versions blocked by
 * protected_elements_preserved on prt_6, `required_vocabulary` «Usar las palabras energía y nutrientes», for a statement that
 * says «… Usa las palabras energía y nutrientes.». Every version kept that sentence and both words; the check split the value into
 * «Usar las palabras energía» + «nutrientes» and required the first as literal text, which not even the original prints.
 */
function cellCase() {
  const analysis = structuredClone(argumentationAnalysis());
  const target = analysis.activities[0]!;
  target.instruction = "Durante una carrera, las células musculares trabajan intensamente. Explica por qué las mitocondrias son importantes en estas células. Usa las palabras energía y nutrientes.";
  analysis.protected_elements = [{ id: "prt_6", type: "required_vocabulary", importance: "essential", value: "Usar las palabras energía y nutrientes", activity_ids: [target.id], resource_ids: [] }];
  return { analysis, activity: target.id };
}

describe("required vocabulary is the words the sheet asks for, not the analyzer's sentence", () => {
  it("«Usar las palabras energía y nutrientes» requires «energía» and «nutrientes»", () => {
    expect(requiredTerms("Usar las palabras energía y nutrientes")).toEqual(["energía", "nutrientes"]);
    expect(requiredTerms("núcleo, mitocondria, membrana plasmática y citoplasma")).toEqual(["núcleo", "mitocondria", "membrana plasmática", "citoplasma"]);
  });

  it("the unadapted sheet passes (the case that blocked three generations); losing a word still FAILS", () => {
    const { analysis, activity } = cellCase();
    const ctx = contextFor(analysis, PROFILES.language);
    const plan = planOf(analysis, ctx, []);
    const literal = documentOf(analysis, plan, ctx);
    expect(statusOf(analysis, plan, ctx, literal, "protected_elements_preserved").status).toBe("PASS");
    const lost = mutate(literal, (b) => b.type === "activity" && b.trace.source_refs.includes(activity), (b) => (b.type === "activity" ? { ...b, prompt: "Explica por qué las mitocondrias son importantes en las células musculares." } : b));
    const check = statusOf(analysis, plan, ctx, lost, "protected_elements_preserved");
    expect(check.status).toBe("FAIL");
    expect(check.detail).toMatch(/falta el término «energía»/);
  });

  it("a word the activity requires is not kept because ANOTHER activity uses it", () => {
    const { analysis, activity } = cellCase();
    const other = analysis.activities.find((a) => a.id !== activity)!.id;
    const ctx = contextFor(analysis, PROFILES.language);
    const plan = planOf(analysis, ctx, []);
    const moved = mutate(
      mutate(documentOf(analysis, plan, ctx), (b) => b.type === "activity" && b.trace.source_refs.includes(activity), (b) => (b.type === "activity" ? { ...b, prompt: "Explica por qué las mitocondrias son importantes en las células musculares. Usa la palabra nutrientes." } : b)),
      (b) => b.type === "activity" && b.trace.source_refs.includes(other),
      (b) => (b.type === "activity" ? { ...b, prompt: `${b.prompt} Piensa en la energía.` } : b),
    );
    const check = statusOf(analysis, plan, ctx, moved, "protected_elements_preserved");
    expect(check.status).toBe("FAIL");
    expect(check.detail).toMatch(/prt_6: falta el término «energía»/);
  });

  it("whole words only: a term inside another word is not the term", () => {
    expect(containsTerm("Usa las palabras Energía y nutrientes.", "energía")).toBe(true);
    expect(containsTerm("La sinergia entre órganos", "energía")).toBe(false);
    expect(containsTerm("los micronutrientes", "nutrientes")).toBe(false);
    expect(containsTerm("la membrana  plasmática", "membrana plasmática")).toBe(true);
  });

  it("a requirement without links is global: the word may be anywhere on the sheet", () => {
    const { analysis } = cellCase();
    analysis.protected_elements[0]!.activity_ids = [];
    const ctx = contextFor(analysis, PROFILES.language);
    const plan = planOf(analysis, ctx, []);
    expect(statusOf(analysis, plan, ctx, documentOf(analysis, plan, ctx), "protected_elements_preserved").status).toBe("PASS");
  });

  it("a term the original text never prints cannot be verified by matching: a WARN for the semantic review, never a FAIL", () => {
    const { analysis } = cellCase();
    analysis.protected_elements[0]!.value = "orgánulo, energía";
    const ctx = contextFor(analysis, PROFILES.language);
    const plan = planOf(analysis, ctx, []);
    expect(statusOf(analysis, plan, ctx, documentOf(analysis, plan, ctx), "protected_elements_preserved").status).toBe("WARN");
  });
});
