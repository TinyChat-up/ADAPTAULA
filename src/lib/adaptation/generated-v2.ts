import type { GeneratedSegments } from "@/lib/schemas/ai-contracts";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { CLOSED_RESPONSES, type Decision } from "@/lib/schemas/adaptation-plan";
import type { DraftGeneratedSegmentsV2, SupportV2 } from "@/lib/schemas/generated-segments-v2";
import type { AnalysisActivity, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { DraftBlock } from "@/lib/schemas/material-document";
import { responseForDecision } from "./document";
import { quotedReferences } from "./facts";
import type { GenerationIssue, NormalizedGeneration } from "./generated";
import type { ReviewedPlan } from "./plan-review";
import { instructionNeedsRewrite, supportBudgetWords } from "./proportion";
import { NEAR_DUPLICATE_OVERLAP, overlap, sentencesOf } from "./redundancy";
import { activityStructure } from "./structure";
import { criticalTokens, describeToken, hasToken, normalizeText, wordCount } from "./text";

/**
 * Draft v2 → `GeneratedSegments` (the form `buildDocument` assembles). Same job as `normalizeGenerated` (v1) with the v2 rules:
 *  - the original instruction is canonical: a `rewrite` is accepted only when the instruction is long enough
 *    (`instructionNeedsRewrite`), keeps every number, quantifier, unit and quoted reference, and is not a copy of the original;
 *    otherwise the original stays and the reason is recorded;
 *  - `requirements` are never generated: the original already carries them (the review checks they survive);
 *  - a support is accepted only if its kind is one the effective decision authorises; EXACT repeats of what is already visible
 *    are dropped, near repeats are only reported (fidelity before brevity);
 *  - ids, trace, answer area and resources come from the server.
 */

const REWRITING = new Set(["segment", "rephrase", "reduce", "reorganize", "change_response_format"]);

/**
 * The ONE decision allowed to rewrite an activity's instruction: the first applied decision on it whose action rewrites, and only
 * when the instruction is long enough (`instructionNeedsRewrite`). A decision that only adds supports never rewrites; two
 * rewriting decisions on the same activity never produce two versions of it. The generator is told exactly this
 * (`instruction_policy`), and the normaliser accepts a rewrite only from this decision.
 */
export function designatedRewriter(effective: readonly Decision[], analysis: Pick<MaterialAnalysis, "activities">, context: Pick<AdaptationContext, "limits">, target: string): string | null {
  const activity = analysis.activities.find((a) => a.id === target);
  if (!activity || !instructionNeedsRewrite(activity, context.limits.max_instruction_words)) return null;
  return effective.find((d) => d.target === target && REWRITING.has(d.action))?.id ?? null;
}

/**
 * The words a student reads in a support, the same thing the generator is asked to count against `support_budget_words`: titles,
 * items, labels, texts and every part of a worked example. Never the field names of the JSON.
 */
export function supportVisibleWords(s: SupportV2): number {
  const title = "title" in s && s.title ? wordCount(s.title) : 0;
  switch (s.kind) {
    case "checklist":
    case "step_list":
    case "guiding_questions":
    case "sentence_starters":
      return title + s.items.reduce((n, item) => n + wordCount(item), 0);
    case "planner":
      return title + s.slots.reduce((n, slot) => n + wordCount(slot.label), 0);
    case "reminder":
    case "key_idea":
    case "extension_task":
      return wordCount(s.text);
    case "glossary":
      return s.items.reduce((n, g) => n + wordCount(g.term) + wordCount(g.definition), 0);
    case "worked_example":
      return wordCount(s.problem) + s.steps.reduce((n, step) => n + wordCount(step), 0) + wordCount(s.result);
  }
}

/**
 * Support budgets (docs/ADAPTATION.md § Presupuesto de los apoyos). A decision's supports get `supportBudgetWords` of the activity;
 * a worked example adds its own allowance, because a model of the procedure cannot be shorter than its necessary steps (and its
 * steps are never cut). Up to the TOLERANCE over it is a counting slip (models count words approximately): accepted, reported.
 * Beyond it, the server first condenses safely (optional titles, items that nearly repeat what is already visible: nothing new
 * is lost); if it still does not fit, the support is out of budget and the audit rejects the generation, pinned on its decision
 * («Hacer magia» then regenerates it with an explicit word limit). There is no blanket acceptance «up to twice the budget».
 */
export const WORKED_EXAMPLE_ALLOWANCE = 40;
export function decisionSupportBudget(decision: Pick<Decision, "supports">, activity: Parameters<typeof supportBudgetWords>[0]): number {
  return supportBudgetWords(activity) + (authorizedKinds(decision).has("worked_example") ? WORKED_EXAMPLE_ALLOWANCE : 0);
}
export const supportTolerance = (budget: number) => Math.max(6, Math.ceil(budget * 0.15));

/**
 * Support kinds of a decision that contract v2 can write. `self_check` is a checklist of self-verification; `visual_cue` has no
 * v2 form (images are out of scope) and authorises nothing.
 */
export function authorizedKinds(decision: Pick<Decision, "supports">): Set<SupportV2["kind"]> {
  const kinds = new Set<SupportV2["kind"]>();
  for (const { kind } of decision.supports) {
    if (kind === "self_check") kinds.add("checklist");
    else if (kind !== "visual_cue") kinds.add(kind);
  }
  return kinds;
}

export function decisionsToGenerateV2(effective: readonly Decision[], analysis: MaterialAnalysis, context: Pick<AdaptationContext, "limits">): Decision[] {
  return effective.filter((d) => {
    if (d.action === "keep" || d.action === "remove") return false;
    const activity = analysis.activities.find((a) => a.id === d.target);
    return authorizedKinds(d).size > 0 || (activity !== undefined && REWRITING.has(d.action) && instructionNeedsRewrite(activity, context.limits.max_instruction_words));
  });
}

type SupportBlock = Extract<DraftBlock, { type: "checklist" | "planner" | "help_box" | "list" | "vocabulary" | "worked_example" | "sentence_starters" }>;

function toBlock(support: SupportV2, id: string, trace: DraftBlock["trace"]): SupportBlock {
  switch (support.kind) {
    case "checklist":
      return { id, type: "checklist", ...(support.title ? { title: support.title } : {}), items: support.items, trace };
    case "planner":
      return { id, type: "planner", ...(support.title ? { title: support.title } : {}), slots: support.slots, trace };
    case "reminder":
      return { id, type: "help_box", variant: "reminder", text: support.text, trace };
    case "key_idea":
      return { id, type: "help_box", variant: "key_idea", text: support.text, trace };
    case "extension_task":
      return { id, type: "help_box", variant: "tip", text: support.text, trace };
    case "step_list":
      return { id, type: "list", style: "numbered", items: support.items, trace };
    case "guiding_questions":
      return { id, type: "list", style: "bullet", items: support.items, trace };
    case "glossary":
      return { id, type: "vocabulary", items: support.items, trace };
    case "worked_example":
      return { id, type: "worked_example", problem: support.problem, steps: support.steps, result: support.result, trace };
    case "sentence_starters":
      return { id, type: "sentence_starters", items: support.items, trace };
  }
}

/** Items of a support that carry student-visible prose, for the repeat checks. */
function itemsOf(support: SupportV2): string[] | null {
  switch (support.kind) {
    case "checklist":
    case "step_list":
    case "guiding_questions":
    case "sentence_starters":
      return support.items;
    case "reminder":
    case "key_idea":
    case "extension_task":
      return [support.text];
    default:
      return null;
  }
}

const withItems = (support: SupportV2, items: string[]): SupportV2 => {
  switch (support.kind) {
    case "checklist":
    case "step_list":
    case "guiding_questions":
    case "sentence_starters":
      return { ...support, items };
    case "reminder":
    case "key_idea":
    case "extension_task":
      return { ...support, text: items.join(" ") };
    default:
      return support;
  }
};


/**
 * The SAFE condensation of a decision's supports: optional titles go, and so do list items that nearly repeat what the student
 * already sees (never below the list's minimum). Nothing else: a worked example, its steps, a sequence of steps, an organiser's
 * slots and every item that says something new are kept whole.
 */
function condense(supports: readonly SupportV2[], nearRepeats: ReadonlySet<string>): { supports: SupportV2[]; removed: string[] } {
  const removed: string[] = [];
  const out = supports.map((s) => {
    let next: SupportV2 = s;
    if ((next.kind === "checklist" || next.kind === "planner") && next.title) {
      next = { ...next, title: undefined } as SupportV2;
      removed.push(`título de ${s.kind}`);
    }
    const items = itemsOf(next);
    if (items && next.kind !== "step_list") {
      const minimum = 1;
      const keep = items.filter((item) => !nearRepeats.has(item));
      const kept = keep.length >= minimum ? keep : items.slice(0, minimum);
      if (kept.length < items.length && (next.kind === "checklist" || next.kind === "guiding_questions" || next.kind === "sentence_starters")) {
        removed.push(`${items.length - kept.length} elemento(s) casi repetidos de ${s.kind}`);
        next = withItems(next, kept);
      }
    }
    return next;
  });
  return { supports: out, removed };
}

export function normalizeGeneratedV2(draft: DraftGeneratedSegmentsV2, reviewed: ReviewedPlan, analysis: MaterialAnalysis, context: Pick<AdaptationContext, "limits">): NormalizedGeneration {
  const effective = new Map(reviewed.effective.decisions.map((d) => [d.id, d]));
  const rewriterOf = (target: string) => designatedRewriter(reviewed.effective.decisions, analysis, context, target);
  // What the student already sees of each target, across ALL its decisions: the designated rewrite is read first, so a support
  // of another decision on the same activity never repeats it literally (two decisions on one activity combine, never duplicate).
  const visibleOf = new Map<string, string>();
  const segments = [...draft.segments].sort((a, b) => Number(rewriterOf(b.target) === b.decision_id) - Number(rewriterOf(a.target) === a.decision_id));
  const issues: GenerationIssue[] = [];
  const out = new Map<string, GeneratedSegments["segments"][number]>();
  const issue = (code: GenerationIssue["code"], decision_id: string | null, detail: string) => issues.push({ code, decision_id, detail });
  const skippedBy = new Map<string, Set<SupportV2["kind"]>>();

  for (const s of draft.skipped) {
    const owner = effective.get(s.decision_id);
    if (!owner || !authorizedKinds(owner).has(s.support)) continue;
    skippedBy.set(s.decision_id, (skippedBy.get(s.decision_id) ?? new Set()).add(s.support));
    issue("skipped_support", s.decision_id, `${s.support}: ${s.reason}`);
  }

  for (const segment of segments) {
    const decision = effective.get(segment.decision_id);
    if (!decision) {
      const known = reviewed.decisions.find((d) => d.id === segment.decision_id);
      issue("unapproved_decision", segment.decision_id, known ? `La decisión no está aplicada (${known.outcome})` : "La decisión no existe en el plan");
      continue;
    }
    if (segment.target !== decision.target) {
      issue("target_mismatch", decision.id, `El segmento actúa sobre ${segment.target} y la decisión sobre ${decision.target}`);
      continue;
    }
    const activity: AnalysisActivity | undefined = analysis.activities.find((a) => a.id === decision.target);
    const trace = (origin: "adapted" | "support" | "extension") => ({ origin, source_refs: decision.target === "document" ? [] : [decision.target], decision_ids: [decision.id] });
    const closed = decision.response_target !== undefined && (CLOSED_RESPONSES as readonly string[]).includes(decision.response_target);
    if (closed) issue("unsupported_response_format", decision.id, `El formato ${decision.response_target} necesita una clave de respuestas: no soportado por el generador`);

    const blocks: DraftBlock[] = [];
    let visible = visibleOf.get(decision.target) ?? (activity ? normalizeText(`${activity.instruction} ${activity.context ?? ""}`) : "");

    // --- rewrite: only the designated decision, only for a long instruction, only if nothing is lost, never a copy -------------
    if (segment.rewrite) {
      const canRewrite = activity !== undefined && rewriterOf(decision.target) === decision.id;
      if (!activity || !canRewrite) {
        const why = !activity || !instructionNeedsRewrite(activity, context.limits.max_instruction_words) ? "la consigna es breve y clara" : REWRITING.has(decision.action) ? "otra decisión ya reescribe esta consigna" : "la decisión solo añade apoyos";
        issue("rewrite_not_needed", decision.id, `Reescritura descartada (${why}): se conserva la consigna original o la reescritura de su decisión`);
      }
      else {
        const steps = [...new Map(segment.rewrite.steps.map((x) => [normalizeText(x), x])).values()].filter((x) => normalizeText(x) !== normalizeText(segment.rewrite!.lead));
        if (steps.length < segment.rewrite.steps.length) issue("duplicate_item_dropped", decision.id, "Pasos repetidos dentro de la reescritura");
        const rewritten = normalizeText([segment.rewrite.lead, ...steps].join(" "));
        const original = `${activity.instruction} ${activity.context ?? ""}`;
        const missing = criticalTokens(original).filter((t) => !hasToken(rewritten, t)).map(describeToken);
        const missingQuotes = quotedReferences(original).filter((q) => !rewritten.includes(normalizeText(q)));
        // The items to order and the labelled fields are drawn by the answer area: a rewrite that prints them again doubles them.
        const structure = activityStructure(activity);
        const drawn = [...(structure.sequence ?? []), ...(structure.fields ?? []).filter((f) => wordCount(f.label) >= 2).map((f) => f.label)].map(normalizeText);
        if (rewritten === normalizeText(original)) issue("rewrite_copies_original", decision.id, "La reescritura es una copia de la consigna: se conserva la original");
        else if (drawn.some((d) => d.length >= 8 && rewritten.includes(d))) issue("rewrite_restates_structure", decision.id, "La reescritura repite los elementos o los campos que ya dibuja la zona de respuesta: se conserva la consigna original");
        else if (missing.length > 0 || missingQuotes.length > 0) issue("rewrite_lost_requirements", decision.id, `La reescritura pierde ${[...missing, ...missingQuotes.map((q) => `«${q}»`)].join(", ")}: se conserva la original`);
        else {
          blocks.push({
            id: `${decision.id}-g0`,
            type: "activity",
            ...(activity.label ? { label: activity.label } : {}),
            prompt: segment.rewrite.lead,
            ...(steps.length > 0 ? { steps } : {}),
            resource_block_ids: activity.resource_ids,
            response: responseForDecision(activity, closed ? undefined : decision.response_target),
            trace: trace("adapted"),
          });
          visible = rewritten;
        }
      }
    }

    // --- supports: authorised kinds only, exact repeats dropped, near repeats reported ------------------------------------
    const allowed = authorizedKinds(decision);
    const seenKinds = new Set<string>();
    const accepted: SupportV2[] = [];
    /** Items that nearly repeat something already visible: kept (fidelity), but the first thing a condensation removes. */
    const nearRepeats = new Set<string>();
    for (const support of segment.supports) {
      if (!allowed.has(support.kind) || seenKinds.has(support.kind)) {
        issue("unauthorized_support", decision.id, `${support.kind}: ${seenKinds.has(support.kind) ? "repetido en la decisión" : "no autorizado por la decisión"}`);
        continue;
      }
      seenKinds.add(support.kind);
      let kept: SupportV2 = support;
      const items = itemsOf(support);
      if (items) {
        const keptItems: string[] = [];
        for (const item of items) {
          const norm = normalizeText(item);
          const exact = wordCount(item) >= 4 && (visible.includes(norm) || keptItems.some((k) => normalizeText(k) === norm));
          if (exact) {
            issue("duplicate_item_dropped", decision.id, `${support.kind}: un elemento repite literalmente algo ya visible`);
            continue;
          }
          if (sentencesOf(item).some((s) => sentencesOf(visible).some((v) => overlap(s, v) >= NEAR_DUPLICATE_OVERLAP))) {
            issue("near_duplicate", decision.id, `${support.kind}: un elemento repite casi literalmente algo ya visible`);
            nearRepeats.add(item);
          }
          keptItems.push(item);
        }
        if (keptItems.length === 0) {
          issue("redundant_support_dropped", decision.id, `${support.kind}: solo repetía lo ya visible`);
          continue;
        }
        const minimum = support.kind === "step_list" ? 2 : 1;
        if (keptItems.length < minimum) {
          issue("redundant_support_dropped", decision.id, `${support.kind}: quedaría con menos de ${minimum} elementos tras quitar repeticiones`);
          continue;
        }
        kept = withItems(support, keptItems);
      }
      // A label like "Argumento 2" is structure; a long one or one with figures is the statement again.
      if (kept.kind === "planner" && kept.slots.some((s) => wordCount(s.label) > 5 || /\d/.test(s.label.replace(/\s\d$/, "")))) issue("planner_label_restates", decision.id, "Una etiqueta del planificador parece repetir la consigna");
      accepted.push(kept);
      visible = `${visible} ${normalizeText(JSON.stringify(kept))}`;
    }
    // --- budget: what the student reads, with a tolerance; reported, never cut ----------------------------------------------
    const budget = decisionSupportBudget(decision, activity);
    const limit = budget + supportTolerance(budget);
    const wordsOf = (list: readonly SupportV2[]) => list.reduce((sum, s) => sum + supportVisibleWords(s), 0);
    let fitted = accepted;
    if (wordsOf(fitted) > limit) {
      const condensed = condense(accepted, nearRepeats);
      if (condensed.removed.length > 0) {
        fitted = condensed.supports;
        issue("support_condensed", decision.id, `Apoyo condensado sin perder contenido nuevo: ${condensed.removed.join(", ")}`);
      }
    }
    const added = wordsOf(fitted);
    if (added > budget) issue("support_over_budget", decision.id, `Los apoyos suman ${added} palabras y el presupuesto era ${budget} (${added <= limit ? "dentro de la tolerancia" : "fuera de la tolerancia"})`);
    if (added > limit) issue("support_out_of_budget", decision.id, `Los apoyos suman ${added} palabras: superan su presupuesto (${budget}) más allá de la tolerancia (${limit - budget})`);
    let n = 1;
    for (const kept of fitted) blocks.push(toBlock(kept, `${decision.id}-g${n++}`, trace(decision.action === "extend" ? "extension" : "support")));
    visibleOf.set(decision.target, visible);

    if (blocks.length === 0) continue;
    const existing = out.get(decision.id);
    if (existing) existing.blocks.push(...blocks);
    else out.set(decision.id, { target: decision.target, decision_ids: [decision.id], blocks, new_item_answers: [] });
  }

  const declined = new Set<string>();
  for (const b of draft.blocked) {
    if (!effective.has(b.decision_id)) continue;
    declined.add(b.decision_id);
    issue("model_blocked", b.decision_id, `${b.reason}: ${b.note}`);
  }

  const toWrite = decisionsToGenerateV2(reviewed.effective.decisions, analysis, context);
  const requested = toWrite.map((d) => d.id);
  for (const d of toWrite) {
    const kinds = [...authorizedKinds(d)];
    // Every authorised support was declined with a reason and there is nothing to rewrite: a structured refusal, not an omission.
    if (!out.has(d.id) && kinds.length > 0 && kinds.every((k) => skippedBy.get(d.id)?.has(k))) declined.add(d.id);
  }
  const generated = requested.filter((id) => out.has(id));
  const ignored = requested.filter((id) => !out.has(id) && !declined.has(id));
  for (const id of ignored) issue("no_segment", id, "Decisión aprobada sin ningún bloque generado");
  const preserved = reviewed.effective.decisions.filter((d) => d.action !== "keep" && d.action !== "remove" && !requested.includes(d.id)).map((d) => d.id);
  for (const id of preserved) {
    const d = effective.get(id)!;
    if (!analysis.activities.some((a) => a.id === d.target)) issue("unsupported_action", id, `La acción ${d.action} sobre ${d.target} no necesita texto generado: se conserva el original`);
  }

  return {
    version: 2,
    segments: { segments: [...out.values()], change_summary: draft.change_summary.length > 0 ? draft.change_summary : ["Sin resumen"] },
    issues,
    requested,
    generated,
    ignored,
    declined: [...declined],
    preserved,
  };
}
