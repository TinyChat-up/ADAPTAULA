import type { DraftDecision } from "@/lib/schemas/adaptation-plan";
import { DraftGeneratedSegmentsV2Schema, type DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { protectedFor } from "@/lib/adaptation/facts";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";

/**
 * A synthetic equivalent of a real «Hacer magia» failure (Matemáticas, 4.º de Primaria; no personal data): the material, the six
 * executable decisions and the generator's answer, with the same shapes and the same word counts as the real artifact.
 */
export function mathAnalysis(): MaterialAnalysis {
  const a = fractionsAnalysis();
  // act_1: 20 words → support budget 40 · act_3: 32 words → budget 64, and long enough for a rewrite (> 30).
  a.activities = a.activities.map((x) =>
    x.id === "act_1"
      ? { ...x, context: "La figura 1 es un rectángulo dividido en cuatro partes iguales; usa un color." }
      : x.id === "act_3"
        ? { ...x, context: "Después escribe el resultado como fracción y comprueba tu cálculo con las tiras de fracciones que tienes arriba en la ficha." }
        : x,
  );
  return a;
}

const preserved = (a: MaterialAnalysis, target: string) => protectedFor(a, target).map((p) => p.id);
const d = (over: Partial<DraftDecision> & Pick<DraftDecision, "target" | "action">): DraftDecision => ({ strategies: [], dimensions: [], intensity: "moderate", preserves: [], supports: [], flags: [], ...over });

/** The six decisions of the real plan, in its order (dec_1…dec_6). */
export function realDecisions(a: MaterialAnalysis = mathAnalysis()): DraftDecision[] {
  return [
    d({ target: "act_1", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], intensity: "light", preserves: preserved(a, "act_1"), supports: [{ kind: "checklist", uses_task_data: false }] }),
    d({ target: "act_3", action: "add_support", strategies: ["worked_example", "working_memory_support"], dimensions: ["working_memory_support"], intensity: "moderate", preserves: preserved(a, "act_3"), supports: [{ kind: "worked_example", uses_task_data: false }, { kind: "checklist", uses_task_data: false }] }),
    d({ target: "act_3", action: "segment", strategies: ["task_sequencing"], dimensions: ["instruction_chunking"], intensity: "moderate", preserves: preserved(a, "act_3") }),
    d({ target: "act_2", action: "add_support", strategies: ["working_memory_support"], dimensions: ["working_memory_support"], intensity: "light", preserves: preserved(a, "act_2"), supports: [{ kind: "reminder", uses_task_data: false }] }),
    d({ target: "act_5", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support"], intensity: "light", preserves: preserved(a, "act_5"), supports: [{ kind: "planner", uses_task_data: false }] }),
    d({ target: "act_4", action: "add_support", strategies: ["task_sequencing"], dimensions: ["instruction_chunking"], intensity: "light", preserves: preserved(a, "act_4"), supports: [{ kind: "step_list", uses_task_data: false }] }),
  ];
}

export const dec3Rewrite = { lead: "Vas a sumar dos fracciones con el mismo denominador.", steps: ["Calcula 2/5 + 1/5.", "Simplifica el resultado si se puede.", "Escribe el resultado como fracción.", "Comprueba tu cálculo con las tiras de fracciones que tienes arriba en la ficha."] };
/** What the model answered (same shapes and word counts as the real artifact). */
export const realDraft: DraftGeneratedSegmentsV2 = DraftGeneratedSegmentsV2Schema.parse({
  segments: [
    { decision_id: "dec_1", target: "act_1", supports: [{ kind: "checklist", title: "Antes de colorear", items: ["Cuento las partes iguales de la figura", "Miro el número de abajo de la fracción para saber cuántas partes hay", "Miro el número de arriba para saber cuántas partes debo colorear", "Coloreo con un solo color y repaso que no me sobra ninguna"] }] },
    {
      decision_id: "dec_2",
      target: "act_3",
      // Not asked of dec_2 (it only adds supports): the generator was told «rewrite» for the ACTIVITY, not for this decision.
      rewrite: dec3Rewrite,
      supports: [
        { kind: "worked_example", problem: "Calcula 1/7 + 3/7 y simplifica si se puede.", steps: ["Los denominadores son iguales: los dos son 7.", "Sumo solo los dos numeradores: 1 + 3 = 4.", "Mantengo el denominador 7: queda 4/7.", "4 y 7 no tienen divisores comunes: no se puede simplificar."], result: "1/7 + 3/7 = 4/7" },
        { kind: "checklist", items: ["¿Tienen el mismo denominador?", "¿He sumado solo los numeradores?", "¿He intentado simplificar el resultado final?"] },
      ],
    },
    { decision_id: "dec_3", target: "act_3", rewrite: dec3Rewrite, supports: [] },
    { decision_id: "dec_4", target: "act_2", supports: [{ kind: "reminder", text: "Dos fracciones son equivalentes si representan la misma parte de la unidad." }] },
    { decision_id: "dec_5", target: "act_5", supports: [{ kind: "planner", slots: [{ label: "Lo que observo", lines: 1 }, { label: "Por qué ocurre", lines: 2 }] }] },
    { decision_id: "dec_6", target: "act_4", supports: [{ kind: "step_list", items: ["Fíjate en las fracciones con el mismo numerador.", "Compara primero los denominadores entre sí."] }] },
  ],
  skipped: [],
  blocked: [],
  change_summary: ["Apoyos de planificación y secuenciación"],
});

