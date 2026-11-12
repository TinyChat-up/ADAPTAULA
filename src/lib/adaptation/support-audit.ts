import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { AnalysisActivity, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { Block, MaterialDocument } from "@/lib/schemas/material-document";
import { allBlocks } from "@/lib/schemas/material-document";
import { studentText } from "./document-text";
import { containsTerm } from "./review-checks";
import { normalizeText } from "./text";

/**
 * support_audit@v1 (bloque 1, SHADOW MODE). A support must make the task reachable, never perform the reasoning the activity
 * evaluates. This audit looks for three observable ways a generated support does it, from the analysis's STRUCTURED fields (never
 * from the wording of an instruction):
 *   · defines_evaluated_concept   a glossary entry or key idea whose subject IS the protected concept/operation/constraint (or
 *                                 objective) of an activity that asks for an explanation or an interpretation;
 *   · reuses_task_data            a worked example that works on the task's OWN numbers (an example is always analogous: other data);
 *   · contains_answer             a support that carries the answer the analysis states or infers for that activity.
 * It never blocks, never changes the document, never asks the teacher anything and is never shown: it is recorded next to the
 * deterministic review (codes, block and activity ids, decision ids and counts; no wording of the material and no answer) so that
 * its precision can be measured before any of it is allowed to act. Pure and deterministic.
 */

export const SUPPORT_AUDIT_VERSION = "support_audit@v1";

export type SupportWarningCode = "defines_evaluated_concept" | "reuses_task_data" | "contains_answer";

export interface SupportWarning {
  code: SupportWarningCode;
  block_id: string;
  activity_id: string;
  decision_ids: string[];
  /** Every need the support answers is a LOW one: a minor need drove a support that touches what is evaluated. */
  low_need_only: boolean;
}

export interface SupportAudit {
  version: typeof SUPPORT_AUDIT_VERSION;
  mode: "shadow";
  supports_checked: number;
  warnings: SupportWarning[];
}

/** Activities whose answer is an explanation or an interpretation (structured fields, not the verb of the instruction). */
const EXPLAINING = new Set<AnalysisActivity["type"]>(["short_answer", "open_question", "reading_comprehension", "graph_interpretation", "experiment"]);
const EVALUATED = new Set(["concept", "target_operation", "reasoning_constraint", "formula"]);
const SUPPORT_ORIGINS = new Set<Block["trace"]["origin"]>(["support", "extension"]);

const STOP = new Set(
  "para como pero sobre entre desde hasta cuando donde porque cada esta este estos estas esos esas otro otra otros otras mismo misma ser son tiene tienen hace hacen puede pueden uso usa usar debe deben tambien ademas segun muy mas menos todo todos toda todas algun alguna alguno algunos algunas ninguno una unos unas del las los con sin por que the".split(" "),
);
/** Words that name the task or the kind of learning, not the thing learnt. */
const GENERIC = new Set(
  "significado relacion relaciones concepto conceptos idea ideas forma formas texto textos esquema esquemas actividad actividades alumno alumnado estudiante explicar explica identificar interpretar reconocer comprender entender describir analizar valorar justificar sobre ejemplo ejemplos informacion datos dato".split(" "),
);

/** Content stems of a text: lowercase, no accents, no function or task words, five letters of each word (alimento ≈ alimentaria). */
export function contentStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalizeText(text).split(/[^a-z0-9]+/)) {
    if (word.length < 4 || STOP.has(word) || GENERIC.has(word) || /^\d+$/.test(word)) continue;
    out.add(word.slice(0, 5));
  }
  return out;
}

const numbersIn = (text: string): Set<string> => new Set((text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")));

/** What the activity evaluates, from structured fields only: its protected concept/operation/constraint and its objectives. */
function evaluatedStems(analysis: MaterialAnalysis, activity: AnalysisActivity): Set<string> {
  const values = analysis.protected_elements.filter((p) => p.activity_ids.includes(activity.id) && EVALUATED.has(p.type)).map((p) => p.value);
  const objectives = analysis.pedagogical_intent.objectives.filter((o) => activity.objective_ids.includes(o.id)).map((o) => o.text);
  return contentStems([...values, ...objectives].join(" "));
}

/** The numbers the student works with: the activity's own words, the linked tables and charts, and the linked texts. */
function taskNumbers(analysis: MaterialAnalysis, activity: AnalysisActivity): Set<string> {
  const parts = [activity.instruction, activity.context ?? ""];
  for (const ref of activity.resource_ids) {
    const visual = analysis.visuals.find((v) => v.id === ref);
    if (visual?.table) parts.push(visual.table.headers.join(" "), ...visual.table.rows.map((r) => r.join(" ")));
    if (visual?.chart) parts.push(visual.chart.categories.join(" "), ...visual.chart.series.map((s) => s.values.join(" ")));
    const text = analysis.texts.find((t) => t.id === ref);
    if (text) parts.push(text.text);
  }
  return numbersIn(parts.join(" "));
}

const answerOf = (activity: AnalysisActivity): string | null => {
  const { basis, value } = activity.expected_answer;
  return (basis === "source" || basis === "inferred") && value && normalizeText(value).length >= 4 ? value : null;
};

function warningsFor(block: Block, activity: AnalysisActivity, analysis: MaterialAnalysis): SupportWarningCode[] {
  const codes: SupportWarningCode[] = [];
  const evaluated = evaluatedStems(analysis, activity);
  if (EXPLAINING.has(activity.type) && evaluated.size > 0) {
    if (block.type === "vocabulary") {
      const defines = block.items.some((item) => {
        const stems = contentStems(item.term);
        return stems.size > 0 && [...stems].every((s) => evaluated.has(s));
      });
      if (defines) codes.push("defines_evaluated_concept");
    } else if (block.type === "help_box" && block.variant === "key_idea") {
      if ([...contentStems(studentText(block))].filter((s) => evaluated.has(s)).length >= 2) codes.push("defines_evaluated_concept");
    }
  }
  if (block.type === "worked_example") {
    const mine = numbersIn(block.problem);
    const task = taskNumbers(analysis, activity);
    const shared = [...mine].filter((n) => task.has(n));
    if (shared.length >= 2 || (mine.size > 0 && shared.length === mine.size)) codes.push("reuses_task_data");
  }
  const answer = answerOf(activity);
  if (answer && containsTerm(studentText(block), answer)) codes.push("contains_answer");
  return codes;
}

export interface SupportAuditInput {
  analysis: MaterialAnalysis;
  plan: Pick<AdaptationPlan, "decisions">;
  context: Pick<AdaptationContext, "needs">;
  document: MaterialDocument;
}

export function auditSupports({ analysis, plan, context, document }: SupportAuditInput): SupportAudit {
  const level = new Map(context.needs.map((n) => [n.dimension, n.level] as const));
  const warnings: SupportWarning[] = [];
  let checked = 0;
  for (const block of allBlocks(document)) {
    if (!SUPPORT_ORIGINS.has(block.trace.origin) || block.type === "activity") continue;
    const refs = block.trace.source_refs.filter((r) => r.startsWith("act_"));
    if (refs.length !== 1) continue;
    const activity = analysis.activities.find((a) => a.id === refs[0]);
    if (!activity) continue;
    checked += 1;
    const decisions = plan.decisions.filter((d) => block.trace.decision_ids.includes(d.id));
    const dimensions = decisions.flatMap((d) => d.dimensions);
    const lowOnly = dimensions.length > 0 && dimensions.every((dim) => level.get(dim) === "low");
    for (const code of warningsFor(block, activity, analysis)) {
      warnings.push({ code, block_id: block.id, activity_id: activity.id, decision_ids: decisions.map((d) => d.id), low_need_only: lowOnly });
    }
  }
  return { version: SUPPORT_AUDIT_VERSION, mode: "shadow", supports_checked: checked, warnings };
}
