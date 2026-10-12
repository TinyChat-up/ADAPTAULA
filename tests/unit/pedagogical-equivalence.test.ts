import { describe, expect, it } from "vitest";
import { rewriteEquivalence, taskProfile } from "@/lib/adaptation/pedagogical-equivalence";
import { validateRewrite, validateSubstitute } from "@/lib/materials/visuals/auto/policy";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { fractionsCaseAnalysis } from "../support/fractions-case";

/**
 * Equivalencia pedagógica de una reescritura sin figura: reglas deterministas por tipo de tarea. Mantener los números no basta;
 * que el modelo diga «equivalente» (`feasible: true`) tampoco. Casos obligatorios de la ficha de fracciones.
 */

const analysis = fractionsCaseAnalysis();
const act = (id: string) => analysis.activities.find((a) => a.id === id)!;
const vis = (id: string) => analysis.visuals.find((v) => v.id === id);
const check = (a: MaterialAnalysis, activityId: string, visualId: string | undefined, prompt: string, steps: string[] = []) => {
  const activity = a.activities.find((x) => x.id === activityId)!;
  return validateRewrite({ feasible: true, prompt, steps, lines: 2 }, { analysis: a, activity, visual: visualId ? a.visuals.find((v) => v.id === visualId) : undefined, signatures: [], functionalNeeds: [] });
};

describe("perfil de la tarea: objetivo, operación cognitiva, representación, respuesta", () => {
  it("act 1 interpreta la barra; act 4 actúa sobre la recta: en ambas la representación es necesaria", () => {
    expect(taskProfile(analysis, act("act_1"), vis("vis_1"))).toMatchObject({ operation: "interpret_representation", representation: "required", responseType: "write_number" });
    expect(taskProfile(analysis, act("act_1"), vis("vis_1")).requiredBecause).toEqual(expect.arrayContaining(["operation:interpret_representation", "objective_about_representation", "protected_necessary_visual"]));
    expect(taskProfile(analysis, act("act_4"), vis("vis_2"))).toMatchObject({ operation: "act_on_representation", representation: "required", responseType: "mark" });
    expect(taskProfile(analysis, act("act_4"), vis("vis_2")).requiredBecause).toEqual(expect.arrayContaining(["visual_kind:number_line", "objective_about_representation"]));
  });

  it("act 3 usa datos del enunciado: ninguna representación es necesaria", () => {
    expect(taskProfile(analysis, act("act_3"), undefined)).toMatchObject({ operation: "use_data", representation: "data_source", requiredBecause: [] });
  });
});

describe("reescrituras rechazadas aunque conserven los números", () => {
  it("act 1 · barra 8 partes / 3 sombreadas ≠ «Escribe la fracción tres octavos»", () => {
    const result = check(analysis, "act_1", "vis_1", "Escribe con números la fracción tres octavos.");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.violations).toEqual(expect.arrayContaining(["representation_required(operation:interpret_representation)", "representation_required(protected_necessary_visual)"]));
  });

  it("act 1 · ni siquiera describiendo la barra en palabras: leer una representación no es leer un texto", () => {
    const result = check(analysis, "act_1", "vis_1", "Una barra tiene 8 partes iguales y 3 están coloreadas. ¿Qué fracción está coloreada? Escríbela.");
    expect(result.ok).toBe(false);
  });

  it("act 4 · «Marca 3/4 en la recta» nunca se convierte en una pregunta de texto ni en un cálculo", () => {
    for (const prompt of ["¿Qué fracción es mayor, 3/4 o 1/2? Escribe la respuesta.", "Escribe cuánto le falta a 3/4 para llegar a 1.", "Divide el segmento de 0 a 1 en cuatro partes iguales y escribe dónde iría 3/4."]) {
      const result = check(analysis, "act_4", "vis_2", prompt);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.violations).toEqual(expect.arrayContaining(["representation_required(operation:act_on_representation)", "response_type_changed(mark)"]));
    }
  });

  it("act 2 · las dos comparaciones con sus casillas: quitar una o pedir otra acción no es equivalente", () => {
    const one = check(analysis, "act_2", undefined, "Compara 2/3 y 3/5 y escribe >, < o = en la casilla.");
    expect(!one.ok && one.violations).toEqual(expect.arrayContaining(["data_lost"]));
    const other = check(analysis, "act_2", undefined, "Calcula cuál es mayor en cada pareja: 2/3 y 3/5; 4/8 y 1/2.");
    expect(!other.ok && other.violations).toEqual(expect.arrayContaining(["action_lost(compara)", "action_lost(escribe)", "action_added(calcula)"]));
  });

  it("no se baja la exigencia con una solución por pasos que el perfil no pide, ni se añaden datos", () => {
    const steps = check(analysis, "act_3", undefined, "Ana bebe 3/4 de litro por la mañana y 1/4 de litro por la tarde. ¿Cuántos litros de agua bebe en total?", ["Suma los numeradores.", "Mantén el denominador."]);
    expect(!steps.ok && steps.violations).toContain("demand_lowered(steps)");
    const data = check(analysis, "act_3", undefined, "Ana bebe 3/4 de litro por la mañana, 1/4 de litro por la tarde y 2/4 por la noche. ¿Cuántos litros de agua bebe en total?");
    expect(!data.ok && data.violations).toContain("new_data(2/4)");
  });

  it("la palabra del modelo no basta: `feasible: true` con una tarea distinta sigue rechazada; `feasible: false` nunca pasa", () => {
    const activity = act("act_4");
    expect(validateRewrite({ feasible: false, prompt: "x".repeat(30), steps: [], lines: 2 }, { analysis, activity, visual: vis("vis_2"), signatures: [], functionalNeeds: [] })).toEqual({ ok: false, violations: ["not_feasible"] });
  });
});

describe("la única reescritura aceptable: la figura solo aportaba un dato", () => {
  it("una etiqueta que dice «3/4 de litro» puede pasar al enunciado si la tarea es calcular con ese dato", () => {
    const a = structuredClone(analysis);
    a.visuals[1] = { ...a.visuals[1]!, kind: "image", title: null, description: "Etiqueta de una botella de agua: 3/4 de litro.", text: null };
    Object.assign(a.activities.find((x) => x.id === "act_4")!, { instruction: "Calcula cuántos cuartos de litro le faltan a la botella para llegar a 1 litro.", response_format: "calculate", answer_area: { type: "lines", lines: 2 }, objective_ids: ["obj_3"] });
    a.protected_elements = a.protected_elements.filter((p) => !p.resource_ids.includes("vis_2"));
    const profile = taskProfile(a, a.activities.find((x) => x.id === "act_4")!, a.visuals[1]);
    expect(profile).toMatchObject({ operation: "use_data", representation: "data_source" });
    expect(check(a, "act_4", "vis_2", "La botella tiene 3/4 de litro de agua. Calcula cuántos cuartos de litro le faltan para llegar a 1 litro.")).toMatchObject({ ok: true });
    expect(rewriteEquivalence({ analysis: a, activity: a.activities.find((x) => x.id === "act_4")!, visual: a.visuals[1], rewrite: { prompt: "La botella tiene 3/4 de litro. Explica cuánto falta para 1 litro.", steps: [], lines: 2 }, needs: [] }).violations).toEqual(["action_lost(calcula)", "action_added(explica)"]);
  });
});

describe("sustitución por otra actividad equivalente (cuando el recurso original no se puede salvar)", () => {
  const line = { kind: "number_line" as const, parts: null, shaded: null, rows: null, cols: null, line_end: 1, divisions: 4 };
  const sub = (a: MaterialAnalysis, activityId: string, visualId: string, draft: { prompt: string; lines: number; figure: typeof line | null }, drawable = true) => {
    const activity = a.activities.find((x) => x.id === activityId)!;
    return validateSubstitute({ feasible: true, steps: [], ...draft }, { analysis: a, activity, visual: a.visuals.find((v) => v.id === visualId), signatures: [], functionalNeeds: [], drawable });
  };

  it("act 4 · marcar en la recta sigue siendo marcar en una recta: con su recta y sin espacio de escritura", () => {
    expect(sub(analysis, "act_4", "vis_2", { prompt: "Marca con una X la posición de 3/4 en la recta numérica.", lines: 0, figure: line })).toMatchObject({ ok: true, spec: { kind: "number_line", divisions: 4, labels: [{ tick: 0, text: "0" }, { tick: 4, text: "1" }] } });
  });

  it("act 4 · una sustitución textual o con líneas de escritura no es equivalente", () => {
    const text = sub(analysis, "act_4", "vis_2", { prompt: "Escribe qué fracción está entre 1/2 y 1 y es mayor que 1/2.", lines: 2, figure: null });
    expect(!text.ok && text.violations).toEqual(expect.arrayContaining(["representation_lost", "response_type_changed(mark)"]));
    const lines = sub(analysis, "act_4", "vis_2", { prompt: "Marca 3/4 en la recta numérica.", lines: 2, figure: line });
    expect(!lines.ok && lines.violations).toContain("response_type_changed(mark)");
  });

  it("una figura inválida de la IA no se dibuja; una sustitución que da la respuesta se rechaza", () => {
    expect(sub(analysis, "act_4", "vis_2", { prompt: "Marca 3/4 en la recta numérica.", lines: 0, figure: { ...line, divisions: 3, line_end: 2 } })).toEqual({ ok: false, violations: ["figure_invalid"] });
    const bar = { kind: "fraction_bar" as const, parts: 6, shaded: 2, rows: null, cols: null, line_end: null, divisions: null };
    const leaked = validateSubstitute({ feasible: true, steps: [], lines: 1, prompt: "Observa la barra: 2/6 está coloreada. ¿Qué fracción está coloreada? Escríbela.", figure: bar as never }, { analysis, activity: act("act_1"), visual: vis("vis_1"), signatures: [], functionalNeeds: [], drawable: true });
    expect(!leaked.ok && leaked.violations).toContain("answer_leaked(figure)");
  });

  it("un recurso que no sabemos dibujar (esquema de una célula) puede pasar a una actividad guiada por escrito sobre el mismo contenido", () => {
    const a = structuredClone(analysis);
    a.visuals[1] = { ...a.visuals[1]!, kind: "diagram", title: null, description: "Esquema de una célula animal con membrana, citoplasma y núcleo señalados.", text: null };
    Object.assign(a.activities.find((x) => x.id === "act_4")!, { instruction: "Rodea en el esquema el núcleo de la célula.", objective_ids: ["obj_4"] });
    a.pedagogical_intent.objectives = a.pedagogical_intent.objectives.map((o) => (o.id === "obj_4" ? { ...o, text: "Identificar las partes de la célula animal" } : o));
    expect(sub(a, "act_4", "vis_2", { prompt: "La célula animal tiene membrana, citoplasma y núcleo. Escribe qué parte de la célula guarda la información y controla su actividad.", lines: 2, figure: null }, false)).toMatchObject({ ok: true, spec: null });
    const unrelated = sub(a, "act_4", "vis_2", { prompt: "Escribe el nombre de tres animales que viven en el mar y explica cómo respiran.", lines: 2, figure: null }, false);
    expect(!unrelated.ok && unrelated.violations).toContain("objective_unrelated");
  });
});
