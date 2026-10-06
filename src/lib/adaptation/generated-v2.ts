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

const supportWords = (s: SupportV2): number => wordCount(JSON.stringify(s).replace(/"(kind|title|lines)":("[^"]*"|\d+),?/g, " ").replace(/[{}\[\]":,]/g, " "));

export function normalizeGeneratedV2(draft: DraftGeneratedSegmentsV2, reviewed: ReviewedPlan, analysis: MaterialAnalysis, context: Pick<AdaptationContext, "limits">): NormalizedGeneration {
  const effective = new Map(reviewed.effective.decisions.map((d) => [d.id, d]));
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

  for (const segment of draft.segments) {
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
    let visible = activity ? normalizeText(`${activity.instruction} ${activity.context ?? ""}`) : "";

    // --- rewrite: only for a long instruction, only if nothing is lost, never a copy of the original -------------------------
    if (segment.rewrite) {
      const canRewrite = activity !== undefined && REWRITING.has(decision.action) && instructionNeedsRewrite(activity, context.limits.max_instruction_words);
      if (!activity || !canRewrite) issue("rewrite_not_needed", decision.id, "La consigna es breve y clara (o la decisión no la reescribe): se conserva la original");
      else {
        const steps = [...new Map(segment.rewrite.steps.map((x) => [normalizeText(x), x])).values()].filter((x) => normalizeText(x) !== normalizeText(segment.rewrite!.lead));
        if (steps.length < segment.rewrite.steps.length) issue("duplicate_item_dropped", decision.id, "Pasos repetidos dentro de la reescritura");
        const rewritten = normalizeText([segment.rewrite.lead, ...steps].join(" "));
        const original = `${activity.instruction} ${activity.context ?? ""}`;
        const missing = criticalTokens(original).filter((t) => !hasToken(rewritten, t)).map(describeToken);
        const missingQuotes = quotedReferences(original).filter((q) => !rewritten.includes(normalizeText(q)));
        if (rewritten === normalizeText(original)) issue("rewrite_copies_original", decision.id, "La reescritura es una copia de la consigna: se conserva la original");
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
    let added = 0;
    let n = 1;
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
          if (sentencesOf(item).some((s) => sentencesOf(visible).some((v) => overlap(s, v) >= NEAR_DUPLICATE_OVERLAP))) issue("near_duplicate", decision.id, `${support.kind}: un elemento repite casi literalmente algo ya visible`);
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
      added += supportWords(kept);
      blocks.push(toBlock(kept, `${decision.id}-g${n++}`, trace(decision.action === "extend" ? "extension" : "support")));
      visible = `${visible} ${normalizeText(JSON.stringify(kept))}`;
    }
    const budget = supportBudgetWords(activity);
    if (added > budget) issue("support_over_budget", decision.id, `Los apoyos suman ${added} palabras y el presupuesto era ${budget}`);

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
