import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationAction, DraftAdaptationPlan, DraftDecision, StrategyKey, SupportKind } from "@/lib/schemas/adaptation-plan";
import type { DraftGeneratedSegments, GeneratedBlock } from "@/lib/schemas/ai-contracts";
import type { DraftAdaptationPlanV2 } from "@/lib/schemas/adaptation-plan-draft-v2";
import type { DraftGeneratedSegmentsV2, SupportV2 } from "@/lib/schemas/generated-segments-v2";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { AnalysisActivity, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { AI_REVIEW_CHECKS, type AiReviewDraft } from "@/lib/schemas/pedagogical-review";
import { evaluatesOperation, isLiteralSourceText, protectedFor } from "./facts";
import { decisionsToGenerate } from "./generated";
import { authorizedKinds, decisionsToGenerateV2 } from "./generated-v2";
import { needRefTable } from "./plan-v2";
import { instructionNeedsRewrite } from "./proportion";
import type { ReviewedPlan } from "./plan-review";
import type { AdaptationPlanner, MaterialGenerator, PedagogicalReviewer } from "./services";
import { averageSentenceLength, wordCount } from "./text";

/**
 * Deterministic stand-ins for the planner, the generator and the reviewer. They follow the same rules a good model should
 * (preserve what is protected, analogous examples, segment instead of summarising a source text…) so the whole pipeline,
 * the invariants and the review can be exercised offline. Their wording is placeholder: they are not a product.
 */

const sentences = (text: string) => text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);

class DecisionBuilder {
  private readonly map = new Map<string, DraftDecision>();
  add(target: string, action: AdaptationAction, dim: DimensionKey, strategy: StrategyKey, extra: Partial<DraftDecision> = {}) {
    const key = `${target}:${action}`;
    const d = this.map.get(key) ?? { target, action, strategies: [], dimensions: [], intensity: "light", preserves: [], supports: [], flags: [] };
    if (!d.dimensions.includes(dim) && d.dimensions.length < 4) d.dimensions.push(dim);
    if (!d.strategies.includes(strategy) && d.strategies.length < 3) d.strategies.push(strategy);
    for (const p of extra.preserves ?? []) if (!d.preserves.includes(p)) d.preserves.push(p);
    for (const s of extra.supports ?? []) if (!d.supports.some((x) => x.kind === s.kind) && d.supports.length < 4) d.supports.push(s);
    if (extra.intensity && rank(extra.intensity) > rank(d.intensity)) d.intensity = extra.intensity;
    if (extra.response_target) d.response_target = extra.response_target;
    this.map.set(key, d);
  }
  /** One replacing decision per target: a segment that also simplifies the language is one change, not two. */
  decisions(): DraftDecision[] {
    const all = [...this.map.values()];
    const out: DraftDecision[] = [];
    for (const d of all) {
      if (!REPLACING_PRIORITY.includes(d.action)) {
        out.push(d);
        continue;
      }
      const winner = all.filter((x) => x.target === d.target && REPLACING_PRIORITY.includes(x.action)).sort((a, b) => REPLACING_PRIORITY.indexOf(a.action) - REPLACING_PRIORITY.indexOf(b.action))[0]!;
      if (winner !== d) {
        for (const dim of d.dimensions) if (!winner.dimensions.includes(dim) && winner.dimensions.length < 4) winner.dimensions.push(dim);
        for (const s of d.strategies) if (!winner.strategies.includes(s) && winner.strategies.length < 3) winner.strategies.push(s);
        for (const p of d.preserves) if (!winner.preserves.includes(p)) winner.preserves.push(p);
      } else out.push(d);
    }
    return out;
  }
}
const REPLACING_PRIORITY: AdaptationAction[] = ["change_response_format", "segment", "rephrase", "reduce"];
const rank = (i: DraftDecision["intensity"]) => ["light", "moderate", "substantial"].indexOf(i);

export function mockPlanDraft(analysis: MaterialAnalysis, context: AdaptationContext): DraftAdaptationPlan {
  const b = new DecisionBuilder();
  const preservesOf = (target: string) => protectedFor(analysis, target).filter((p) => p.importance !== "optional").map((p) => p.id);
  const writing = new Set(context.material.writing_evaluated_activities);
  const maxWords = context.limits.max_instruction_words ?? 20;
  const support = (kind: SupportKind) => ({ supports: [{ kind, uses_task_data: false }] });

  for (const need of context.needs) {
    const { dimension: dim, intensity } = need;
    for (const strategy of need.strategies) {
      switch (strategy) {
        case "task_sequencing":
        case "instruction_clarification":
          for (const a of analysis.activities) if (sentences(a.instruction).length > 1 || wordCount(a.instruction) > maxWords) b.add(a.id, "segment", dim, strategy, { preserves: preservesOf(a.id), intensity });
          break;
        case "text_segmentation":
          for (const t of analysis.texts.filter((x) => x.kind === "reading_text" && wordCount(x.text) > 60)) b.add(t.id, "segment", dim, strategy, { preserves: preservesOf(t.id), intensity });
          break;
        case "language_simplification":
          for (const t of analysis.texts.filter((x) => x.kind === "reading_text" && !isLiteralSourceText(analysis, x))) b.add(t.id, "rephrase", dim, strategy, { preserves: preservesOf(t.id), intensity });
          for (const a of analysis.activities.filter((x) => averageSentenceLength(x.instruction) > 12)) b.add(a.id, "rephrase", dim, strategy, { preserves: preservesOf(a.id), intensity });
          break;
        case "visual_load_reduction":
          for (const v of analysis.visuals.filter((x) => x.role === "decorative")) b.add(v.id, "remove", dim, strategy);
          break;
        case "planning_support":
          for (const id of writing) b.add(id, "add_support", dim, strategy, support(analysis.activities.find((a) => a.id === id)?.type === "writing" ? "planner" : "checklist"));
          break;
        case "self_regulation":
          b.add("document", "add_support", dim, strategy, support("self_check"));
          break;
        case "vocabulary_support":
          b.add("document", "add_support", dim, strategy, support("glossary"));
          break;
        case "comprehension_support":
          for (const t of analysis.texts.filter((x) => x.kind === "reading_text")) b.add(t.id, "add_support", dim, strategy, support("key_idea"));
          break;
        case "worked_example":
          for (const a of analysis.activities.filter((x) => evaluatesOperation(analysis, x))) b.add(a.id, "add_support", dim, strategy, support("worked_example"));
          break;
        case "working_memory_support":
          for (const a of analysis.activities.filter((x) => evaluatesOperation(analysis, x))) b.add(a.id, "add_support", dim, strategy, support("reminder"));
          break;
        case "writing_load_reduction":
        case "response_format":
          for (const a of analysis.activities.filter((x) => x.response_format === "write_text")) {
            if (writing.has(a.id)) b.add(a.id, "add_support", dim, "planning_support" as StrategyKey, support("planner"));
            else b.add(a.id, "change_response_format", dim, strategy, { preserves: preservesOf(a.id), response_target: context.allowances.keyboard ? "keyboard" : "write_text_short" });
          }
          break;
        case "prior_knowledge_activation":
          b.add("document", "add_support", dim, strategy, support("key_idea"));
          break;
        case "extension":
          b.add("document", "extend", dim, strategy, support("extension_task"));
          break;
        default:
          break; // presentation-like strategies (spatial organisation, attention, pacing) are applied by layout
      }
    }
  }
  return { decisions: b.decisions(), summary: ["Plan simulado a partir de las necesidades del perfil."] };
}

function supportBlock(kind: SupportKind, analysis: MaterialAnalysis, activity: AnalysisActivity | undefined): GeneratedBlock {
  const requirements = activity ? protectedFor(analysis, activity.id).filter((p) => p.type.endsWith("constraint")).map((p) => p.value) : [];
  switch (kind) {
    case "planner":
      return { type: "planner", title: "Organiza tu respuesta", slots: [{ label: "Qué voy a decir", lines: 2 }, { label: "Qué datos uso", lines: 3 }, { label: "Cierre", lines: 2 }] };
    case "checklist":
    case "self_check":
      return { type: "checklist", title: "Antes de entregar", items: ["He leído toda la consigna.", ...requirements.slice(0, 5).map((r) => `Cumplo: ${r}`)] };
    case "glossary": {
      const terms = analysis.protected_elements.filter((p) => p.type === "required_vocabulary").flatMap((p) => p.value.split(/[,;]/)).map((t) => t.trim()).filter(Boolean);
      return { type: "vocabulary", title: "Vocabulario", items: (terms.length > 0 ? terms : ["Término clave"]).slice(0, 8).map((term) => ({ term, definition: "Significado en este contexto (lo completa el docente)." })) };
    }
    case "worked_example":
      return { type: "worked_example", title: "Ejemplo con otros datos", problem: "Un ejemplo análogo con datos distintos de los de la actividad.", steps: ["Identifica los datos.", "Aplica la operación paso a paso."], result: "Resultado del ejemplo análogo." };
    case "reminder":
      return { type: "help_box", variant: "reminder", text: "Recuerda: anota qué datos vas a usar antes de empezar." };
    case "key_idea":
      return { type: "help_box", variant: "key_idea", text: "Fíjate en la idea principal de cada parte antes de responder." };
    case "extension_task":
      return { type: "help_box", variant: "tip", title: "Para ir más allá", text: "Plantea una pregunta nueva que puedas investigar con estos mismos documentos." };
    case "sentence_starters":
      return { type: "sentence_starters", items: ["En mi opinión,", "En primer lugar,", "Además,", "En conclusión,"] };
    case "step_list":
      return { type: "list", style: "numbered", items: ["Localiza el documento que necesitas.", "Anota los datos que vas a usar.", "Responde a lo que se pide."] };
    case "guiding_questions":
      return { type: "list", style: "bullet", items: ["¿Qué documento tengo que mirar?", "¿Qué se me pide responder?"] };
    default:
      return { type: "help_box", variant: "strategy", text: "Sigue los pasos en orden." };
  }
}

/**
 * Deterministic generator draft, written in the same model-facing format as the real one and following the same rules: it only
 * writes for the effective decisions and only the blocks each one authorises. Placeholder wording, not a product.
 */
export function mockGenerateDraft(analysis: MaterialAnalysis, reviewed: ReviewedPlan): DraftGeneratedSegments {
  const segments: DraftGeneratedSegments["segments"] = [];
  for (const d of decisionsToGenerate(reviewed.effective.decisions, analysis)) {
    const activity = analysis.activities.find((a) => a.id === d.target);
    const text = analysis.texts.find((t) => t.id === d.target);
    const blocks: GeneratedBlock[] = [];
    if (activity && ["segment", "rephrase", "reduce", "reorganize", "change_response_format"].includes(d.action)) {
      const parts = sentences(activity.context ? `${activity.instruction} ${activity.context}` : activity.instruction);
      const requirements = analysis.protected_elements.filter((p) => d.preserves.includes(p.id) && p.activity_ids.includes(activity.id) && p.type.endsWith("constraint")).map((p) => p.value);
      blocks.push({ type: "activity", ...(activity.label ? { label: activity.label } : {}), prompt: parts[0] ?? activity.instruction, ...(parts.length > 1 ? { steps: parts.slice(1).map((x) => x.slice(0, 300)) } : {}), ...(requirements.length > 0 ? { requirements: requirements.slice(0, 8) } : {}) });
    } else if (text && d.action === "rephrase") {
      blocks.push({ type: "paragraph", text: text.text });
    }
    for (const s of d.supports) blocks.push(supportBlock(s.kind, analysis, activity));
    if (blocks.length > 0) segments.push({ decision_id: d.id, target: d.target, blocks });
  }
  return { segments, blocked: [], change_summary: ["Adaptación simulada (sin IA)."] };
}

/**
 * Deterministic generator draft for contract v2: the original instruction is kept (a rewrite only when the system allows one),
 * supports are short, distinct in function and never repeat the instruction; a reminder or key idea that could only repeat a
 * condition is declined. Placeholder wording, not a product: it exercises the v2 pipeline offline.
 */
export function mockGenerateDraftV2(analysis: MaterialAnalysis, reviewed: ReviewedPlan, context: Pick<AdaptationContext, "limits">): DraftGeneratedSegmentsV2 {
  const segments: DraftGeneratedSegmentsV2["segments"] = [];
  const skipped: DraftGeneratedSegmentsV2["skipped"] = [];
  for (const d of decisionsToGenerateV2(reviewed.effective.decisions, analysis, context)) {
    const activity = analysis.activities.find((a) => a.id === d.target);
    const supports: SupportV2[] = [];
    for (const kind of authorizedKinds(d)) {
      switch (kind) {
        case "checklist":
          supports.push({ kind: "checklist", title: "Antes de entregar", items: ["He cumplido todo lo que pide la consigna.", "He releído mi respuesta."] });
          break;
        case "planner":
          supports.push({ kind: "planner", title: "Organiza tus ideas", slots: [{ label: "Ideas", lines: 2 }, { label: "Orden", lines: 2 }] });
          break;
        case "step_list":
          supports.push({ kind: "step_list", items: ["Prepara lo que necesitas.", "Hazlo paso a paso.", "Revisa al terminar."] });
          break;
        case "guiding_questions":
          supports.push({ kind: "guiding_questions", items: ["¿Qué tengo que mirar?", "¿Qué me piden hacer?"] });
          break;
        case "glossary":
          supports.push({ kind: "glossary", items: [{ term: "Término clave", definition: "Significado en este contexto (lo completa el docente)." }] });
          break;
        case "worked_example":
          supports.push({ kind: "worked_example", problem: "Un caso análogo con datos distintos de los de la actividad.", steps: ["Identifica los datos.", "Aplica la operación."], result: "Resultado del caso análogo." });
          break;
        default:
          // reminder, key_idea, extension_task and the rest could only repeat what is visible: declined, not written.
          skipped.push({ decision_id: d.id, support: kind as SupportV2["kind"], reason: "already_visible" });
      }
    }
    let rewrite: DraftGeneratedSegmentsV2["segments"][number]["rewrite"];
    if (activity && ["segment", "rephrase", "reduce", "reorganize", "change_response_format"].includes(d.action) && instructionNeedsRewrite(activity, context.limits.max_instruction_words)) {
      const parts = sentences(activity.context ? `${activity.instruction} ${activity.context}` : activity.instruction);
      if (parts.length >= 3) rewrite = { lead: parts[0]!.slice(0, 160), steps: parts.slice(1).map((x) => x.slice(0, 140)).slice(0, 5) };
    }
    if (rewrite || supports.length > 0) segments.push({ decision_id: d.id, target: d.target, ...(rewrite ? { rewrite } : {}), supports });
  }
  return { segments, skipped, blocked: [], change_summary: ["Adaptación simulada (sin IA)."] };
}

const usage = () => [];

/**
 * Deterministic planner draft for contract v2, following planner v2's rules: needs are cited by reference, a need does not
 * force a decision (short instructions are left alone, layout is the presentation's), and supports are executive (one global
 * checklist; a planner only where the student's own production is what is evaluated). Placeholder, not a product: it exercises
 * the v2 contract and pipeline offline.
 */
export function mockPlanDraftV2(analysis: MaterialAnalysis, context: AdaptationContext): DraftAdaptationPlanV2 {
  const refs = needRefTable(context);
  const need = (dimension: DimensionKey) => context.needs.find((n) => n.dimension === dimension);
  const ref = (dimension: DimensionKey) => refs.find((r) => r.dimension === dimension)?.ref;
  const preservesOf = (target: string) => protectedFor(analysis, target).filter((p) => p.importance !== "optional").map((p) => p.id);
  const decisions: DraftAdaptationPlanV2["decisions"] = [];

  const checklist = need("checklist_support");
  if (checklist) decisions.push({ target: "document", action: "add_support", strategies: ["planning_support"], need_refs: [ref("checklist_support")!], intensity: checklist.intensity, supports: [{ kind: "checklist", uses_task_data: false }] });

  const planning = need("planning_support");
  if (planning) {
    for (const id of context.material.writing_evaluated_activities) decisions.push({ target: id, action: "add_support", strategies: ["planning_support"], need_refs: [ref("planning_support")!], intensity: planning.intensity, preserves: preservesOf(id), supports: [{ kind: "planner", uses_task_data: false }] });
  }

  const chunking = need("instruction_chunking");
  if (chunking) {
    for (const a of analysis.activities.filter((x) => instructionNeedsRewrite(x, context.limits.max_instruction_words))) {
      decisions.push({ target: a.id, action: "segment", strategies: ["task_sequencing"], need_refs: [ref("instruction_chunking")!], intensity: chunking.intensity, preserves: preservesOf(a.id) });
    }
  }
  return { decisions, summary: decisions.length > 0 ? ["Apoyos ejecutivos solo donde hacen falta."] : ["No se necesita adaptar este material para este perfil."] };
}

export function createMockPlanner(analysis: MaterialAnalysis, version: 1 | 2 = 1): AdaptationPlanner {
  return { plan: async ({ context }) => ({ draft: version === 2 ? mockPlanDraftV2(analysis, context) : mockPlanDraft(analysis, context), runs: usage() }) };
}
export function createMockGenerator(version: 1 | 2 = 1): MaterialGenerator {
  return { generate: async ({ analysis, reviewed, context }) => ({ draft: version === 2 ? mockGenerateDraftV2(analysis, reviewed, context) : mockGenerateDraft(analysis, reviewed), runs: usage() }) };
}
export function createMockReviewer(): PedagogicalReviewer {
  // The mock cannot judge semantics, so it leaves `answers_not_leaked` open instead of faking a PASS.
  const draft: AiReviewDraft = { checks: AI_REVIEW_CHECKS.filter((c) => c !== "answers_not_leaked").map((check) => ({ check, status: "PASS" as const, targets: [], detail: "Revisión simulada (sin IA)." })) };
  return { review: async () => ({ draft, runs: usage() }) };
}
