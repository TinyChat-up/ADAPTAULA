import { buildAdaptationContext } from "@/lib/adaptation/context";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { normalizeGeneratedV2 } from "@/lib/adaptation/generated-v2";
import { autoReview, reviewPlan } from "@/lib/adaptation/plan-review";
import { normalizePlan } from "@/lib/adaptation/plan";
import { protectedFor } from "@/lib/adaptation/facts";
import type { DraftDecision } from "@/lib/schemas/adaptation-plan";
import { DraftGeneratedSegmentsV2Schema } from "@/lib/schemas/generated-segments-v2";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import { buildRenderModel } from "@/lib/render/model";
import { flowClaim, flowFigure } from "@/lib/visuals/from-analysis";
import { needRefTable } from "@/lib/adaptation/plan-v2";
import { normalizePlanV3 } from "@/lib/adaptation/plan-v3";
import { pondAnalysis } from "./pond-case";

/**
 * The plan «Hacer magia» wrote for the pond sheet (planner v2, eight decisions) and what the generator answered, with the shapes
 * the real artifacts have: checklists on three activities, a worked example on 2 and 5, a glossary on 3a, a reorganisation of 2
 * that only the renderer can do, and a sheet-level reminder plus self-check. Profile: needs of the real one, up to the level that
 * gives three visible tasks per page.
 */
export const pondProfile = (): FunctionalProfile => {
  const profile = emptyFunctionalProfile();
  Object.assign(profile.supports, {
    written_instructions: "medium", worked_examples: "medium", background_knowledge_support: "low", vocabulary_support: "low", visual_distraction_reduction: "medium",
    visual_density: "medium", predictable_feedback: "medium", neutral_language: "medium", visual_support: "high", number_of_visible_tasks: "medium",
  });
  return profile;
};

const d = (over: Partial<DraftDecision> & Pick<DraftDecision, "target" | "action">): DraftDecision => ({ strategies: [], dimensions: [], intensity: "light", preserves: [], supports: [], flags: [], ...over });

export function pondCase(planner: "v2" | "v3" = "v2") {
  const analysis = pondAnalysis();
  const context = buildAdaptationContext({ profile: pondProfile(), education: { stage: "primaria", grade: "5-primaria", subject: "ciencias-naturales" }, analysis, adaptationType: "accessibility", policy: 3 }).context;
  context.presentation.spacing = "wide";
  const keep = (target: string) => protectedFor(analysis, target).map((p) => p.id);
  const decisions: DraftDecision[] = [
    d({ target: "act_1", action: "segment", strategies: ["instruction_clarification"], dimensions: ["written_instructions"], preserves: keep("act_1"), supports: [{ kind: "checklist", uses_task_data: false }] }),
    d({ target: "act_7", action: "segment", strategies: ["instruction_clarification"], dimensions: ["written_instructions"], preserves: keep("act_7"), supports: [{ kind: "checklist", uses_task_data: false }] }),
    d({ target: "act_8", action: "segment", strategies: ["instruction_clarification"], dimensions: ["written_instructions"], preserves: keep("act_8"), supports: [{ kind: "checklist", uses_task_data: false }] }),
    d({ target: "act_2", action: "add_support", strategies: ["worked_example"], dimensions: ["worked_examples"], preserves: keep("act_2"), supports: [{ kind: "worked_example", uses_task_data: false }] }),
    d({ target: "act_5", action: "add_support", strategies: ["worked_example"], dimensions: ["worked_examples"], preserves: keep("act_5"), supports: [{ kind: "worked_example", uses_task_data: false }] }),
    d({ target: "act_3", action: "add_support", strategies: ["vocabulary_support", "prior_knowledge_activation"], dimensions: ["background_knowledge_support", "vocabulary_support"], preserves: keep("act_3"), supports: [{ kind: "glossary", uses_task_data: false }] }),
    d({ target: "act_2", action: "reorganize", strategies: ["visual_load_reduction", "spatial_organization"], dimensions: ["visual_distraction_reduction", "visual_density"], preserves: keep("act_2") }),
    d({ target: "document", action: "add_support", strategies: ["self_regulation"], dimensions: ["predictable_feedback", "neutral_language"], supports: [{ kind: "reminder", uses_task_data: false }, { kind: "self_check", uses_task_data: false }] }),
  ];
  // The same eight decisions through each planner's own contract: v3 (V2.2) declares needs by reference and answers the hint test.
  const refs = needRefTable(context);
  const plan =
    planner === "v2"
      ? normalizePlan({ decisions, summary: [] }, analysis, context)
      : normalizePlanV3(
          {
            decisions: decisions.map(({ dimensions, ...rest }) => ({ ...rest, need_refs: dimensions.map((dim) => refs.find((r) => r.dimension === dim)?.ref).filter((r): r is string => r !== undefined), status: "active", hint_yes: [] })),
            summary: [],
          },
          analysis,
          context,
          null,
        ).plan;
  const reviewed = reviewPlan(plan, autoReview(plan, analysis, context), analysis, context);
  const draft = DraftGeneratedSegmentsV2Schema.parse({
    segments: [
      { decision_id: "dec_1", target: "act_1", supports: [{ kind: "checklist", title: "Antes de escribir", items: ["Subrayo los dos cambios", "Anoto la frase que lo muestra"] }] },
      { decision_id: "dec_2", target: "act_7", supports: [{ kind: "checklist", title: "Para valorar", items: ["Leo la afirmación entera", "Busco datos en el texto"] }] },
      { decision_id: "dec_3", target: "act_8", supports: [{ kind: "checklist", title: "Mi medida", items: ["Digo qué propongo", "Explico a quién ayuda"] }] },
      { decision_id: "dec_4", target: "act_2", supports: [{ kind: "worked_example", problem: "Clasifica: Pez · Roca.", steps: ["El pez está vivo.", "La roca no está viva."], result: "Pez: ser vivo. Roca: elemento no vivo." }] },
      { decision_id: "dec_5", target: "act_5", supports: [{ kind: "worked_example", problem: "Un charco tenía 20 cm y bajó a 12 cm. ¿Cuánto bajó?", steps: ["Resto el nivel final al inicial."], result: "20 − 12 = 8 cm" }] },
      { decision_id: "dec_6", target: "act_3", supports: [{ kind: "glossary", items: [{ term: "cadena alimentaria", definition: "Orden en el que unos seres vivos sirven de alimento a otros." }] }] },
      { decision_id: "dec_8", target: "document", supports: [{ kind: "reminder", text: "Lee despacio cada consigna." }, { kind: "checklist", title: "Revisión final", items: ["He contestado todo", "He releído mis respuestas"] }] },
    ],
    skipped: [],
    blocked: [],
    change_summary: ["Apoyos de la ficha"],
  });
  const generation = normalizeGeneratedV2(draft, reviewed, analysis, context);
  const document = buildDocument({ analysis, plan: reviewed.effective, context, generated: generation.segments, newBlockId: sequentialIds() });
  return { analysis, context, plan: reviewed.effective, reviewed, generation, document };
}

export function pondModel(planner: "v2" | "v3" = "v2") {
  const c = pondCase(planner);
  const visual = c.analysis.visuals.find((v) => v.id === "vis_2")!;
  const figure = flowFigure(flowClaim(visual)!)!;
  const { model, validation } = buildRenderModel(c.document, { mode: "student", deferred: [], subjectLabel: "Ciencias de la Naturaleza", figures: { vis_2: figure } });
  return { ...c, model, validation };
}
