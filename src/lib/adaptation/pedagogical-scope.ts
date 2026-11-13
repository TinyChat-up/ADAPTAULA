import { z } from "zod";
import type { AdaptationContext, ConflictResolution, ContextNeed } from "@/lib/schemas/adaptation-context";
import type { ResponseTarget, StrategyKey } from "@/lib/schemas/adaptation-plan";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import { contentStems } from "./support-evidence";
import { STRATEGIES } from "./strategies";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { fingerprint } from "./fingerprint";

/** The per-sheet decision. `accessibility` and `methodological` are connected to the pipeline (below); `curricular` is still only a contract. */
const ObjectiveId = z.string().regex(/^obj_[0-9]{1,4}$/);
export const SheetPedagogicalChoiceSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(1), type: z.literal("accessibility") }).strict(),
  z.object({ version: z.literal(1), type: z.literal("methodological") }).strict(),
  z.object({ version: z.literal(1), type: z.literal("curricular"), analysis_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), objective_ids: z.array(ObjectiveId).min(1).max(8).refine((ids) => new Set(ids).size === ids.length) }).strict(),
]);
export type SheetPedagogicalChoice = z.infer<typeof SheetPedagogicalChoiceSchema>;

/** Only a server-verified subject slug selects an area: model-produced text is not an authoritative match. */
export function pedagogicalAreaFor(profile: FunctionalProfile, materialSubjectSlug: string | null) {
  if (profile.schema_version !== 3 || !materialSubjectSlug) return null;
  const matches = profile.pedagogy?.areas.filter((area) => area.subject === materialSubjectSlug) ?? [];
  return matches.length === 1 ? structuredClone(matches[0]!) : null;
}

export type ScopeResult =
  | { ok: true; choice: SheetPedagogicalChoice; affected_activities: string[] }
  | { ok: false; reason: "invalid_choice" | "stale_analysis" | "unknown_objective" | "unlinked_objective" };

/** No inference from the learner's preferences. A mixed-objective activity is not wholly within a partial authorisation. */
export function checkPedagogicalScope(input: unknown, analysis: MaterialAnalysis): ScopeResult {
  const parsed = SheetPedagogicalChoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_choice" };
  const choice = parsed.data;
  if (choice.type !== "curricular") return { ok: true, choice, affected_activities: [] };
  if (choice.analysis_fingerprint !== fingerprint(analysis)) return { ok: false, reason: "stale_analysis" };
  const known = new Set(analysis.pedagogical_intent.objectives.map((o) => o.id));
  if (choice.objective_ids.some((id) => !known.has(id))) return { ok: false, reason: "unknown_objective" };
  const selected = new Set(choice.objective_ids);
  if (choice.objective_ids.some((id) => !analysis.activities.some((activity) => activity.objective_ids.includes(id)))) return { ok: false, reason: "unlinked_objective" };
  return { ok: true, choice, affected_activities: analysis.activities.filter((a) => a.objective_ids.length > 0 && a.objective_ids.every((id) => selected.has(id))).map((a) => a.id) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Connected to «Hacer magia»: what the choice and the V3 profile contribute to one sheet (deterministic, no free text sent)
// ---------------------------------------------------------------------------------------------------------------------

export type SheetScope = "accessibility" | "methodological";
export type SheetPedagogy = NonNullable<AdaptationContext["pedagogy"]>;

/** Actions that change HOW the task is answered or how much of it there is: methodology, not access. */
const METHOD_ACTIONS: ReadonlySet<string> = new Set(["change_response_format", "reduce"]);
/** A strategy that can only act through those actions has nothing to offer an access adaptation. */
export const isMethodOnly = (strategy: StrategyKey) => STRATEGIES[strategy].actions.every((a) => METHOD_ACTIONS.has(a));
/** Needs whose answer is a change of response: the ones a methodological adaptation serves with a response format. */
export const RESPONSE_NEEDS: readonly DimensionKey[] = ["writing_amount", "fine_motor_demand", "alternative_response", "reduced_copying", "selection_based_response", "choice_support", "expressive_language_support"];
/** Needs a support of comprehension, vocabulary or prior knowledge serves: where a declared learning can focus a support. */
const FOCUS_STRATEGIES: ReadonlySet<StrategyKey> = new Set(["comprehension_support", "vocabulary_support", "prior_knowledge_activation"]);

/**
 * The response formats a methodological adaptation may use for this profile: only what an executor really builds (a short written answer,
 * an oral answer when the teacher declared it, the keyboard when it is allowed). The declared closed formats (match, fill in, order,
 * select, classify) have no executor that produces a verified answer key yet: they are listed as unavailable, never promised.
 * Oral comes first only when the need to write less is HIGH; otherwise the student keeps writing, less.
 */
export function responseOptions(profile: FunctionalProfile, needs: readonly Pick<ContextNeed, "dimension" | "level">[]): NonNullable<SheetPedagogy["response"]> {
  const declared = profile.pedagogy?.response_preferences ?? [];
  const high = needs.some((n) => n.level === "high" && (RESPONSE_NEEDS as readonly string[]).includes(n.dimension));
  const available: ResponseTarget[] = ["write_text_short"];
  if (profile.allowances.keyboard) available.push("keyboard");
  if (declared.includes("oral")) {
    if (high) available.unshift("oral_or_alternative");
    else available.push("oral_or_alternative");
  }
  return { available, unavailable: declared.filter((p) => p !== "write" && p !== "oral") };
}

/**
 * Activities that work on something the teacher declared the student «needs to learn or reinforce» in the area of this sheet. The match
 * is lexical and done here (two content words in common with the activity, its objectives or its linked texts): the declared text is
 * untrusted free text and NEVER leaves the server. A hint of where to focus a support, never a reason to change an objective.
 */
export function focusTargets(area: ReturnType<typeof pedagogicalAreaFor>, analysis: MaterialAnalysis): string[] {
  if (!area || area.needs.length === 0) return [];
  const declared = area.needs.map((statement) => contentStems(statement)).filter((stems) => stems.size >= 2);
  return analysis.activities
    .filter((a) => {
      const objectives = analysis.pedagogical_intent.objectives.filter((o) => a.objective_ids.includes(o.id)).map((o) => o.text);
      const texts = analysis.texts.filter((t) => a.resource_ids.includes(t.id) && t.text.length <= 600).map((t) => t.text);
      const mine = contentStems([a.instruction, a.context ?? "", ...objectives, ...texts].join(" "));
      return declared.some((stems) => [...stems].filter((s) => mine.has(s)).length >= 2);
    })
    .map((a) => a.id)
    .slice(0, 40);
}

const FORMAT_ES: Partial<Record<ResponseTarget, string>> = { write_text_short: "respuesta escrita breve", oral_or_alternative: "respuesta oral", keyboard: "respuesta con teclado" };
const PREFERENCE_ES: Record<string, string> = { match: "unir", fill_blanks: "completar", order: "ordenar", select: "seleccionar", classify: "clasificar" };

/**
 * What the scope does to the needs and which resolutions the planner must follow (the published planner already obeys `conflicts`).
 *  · accessibility: a strategy that can only change the response or reduce the task is not offered; a need left with none is out of scope;
 *  · methodological: every strategy stays, and the response formats that can be executed are stated.
 */
export function applySheetScope(input: { scope: SheetScope; profile: FunctionalProfile; subjectSlug: string | null; analysis: MaterialAnalysis; needs: ContextNeed[] }): { needs: ContextNeed[]; outOfScope: DimensionKey[]; pedagogy: SheetPedagogy; conflicts: ConflictResolution[] } {
  const { scope, profile, analysis } = input;
  const area = pedagogicalAreaFor(profile, input.subjectSlug);
  const conflicts: ConflictResolution[] = [];
  let needs = input.needs;
  const outOfScope: DimensionKey[] = [];
  if (scope === "accessibility") {
    const touched: DimensionKey[] = [];
    needs = input.needs.flatMap((n) => {
      const strategies = n.strategies.filter((s) => !isMethodOnly(s));
      if (strategies.length === n.strategies.length) return [n];
      touched.push(n.dimension);
      if (strategies.length === 0) {
        outOfScope.push(n.dimension);
        return [];
      }
      return [{ ...n, strategies }];
    });
    const kept = touched.filter((d) => !outOfScope.includes(d));
    for (let i = 0; i < kept.length; i += 6) conflicts.push({ key: "access_scope_keeps_response", dimensions: kept.slice(i, i + 6), targets: [], rule: "pedagogical_integrity", guidance: "Adaptación de acceso para esta ficha: no cambies el formato de respuesta ni reduzcas la tarea. Atiende estas necesidades solo con apoyos." });
  }
  const response = scope === "methodological" ? responseOptions(profile, needs) : undefined;
  if (response) {
    const dims = needs.filter((n) => (RESPONSE_NEEDS as readonly string[]).includes(n.dimension)).map((n) => n.dimension);
    if (dims.length > 0) {
      const formats = response.available.map((f) => FORMAT_ES[f]).filter(Boolean).join(", ");
      const missing = response.unavailable.map((p) => PREFERENCE_ES[p]).filter(Boolean).join(", ");
      for (let i = 0; i < dims.length; i += 6) conflicts.push({ key: "methodological_response_formats", dimensions: dims.slice(i, i + 6), targets: [], rule: "functional_need", guidance: `Adaptación metodológica: para cambiar la respuesta usa solo ${formats}, en ese orden de preferencia, y nunca donde se evalúa la escritura o una operación.${missing ? ` Aún no disponibles: ${missing}.` : ""}`.slice(0, 240) });
    }
  }
  const focus = focusTargets(area, analysis);
  const focusDims = needs.filter((n) => n.strategies.some((s) => FOCUS_STRATEGIES.has(s))).map((n) => n.dimension);
  if (focus.length > 0 && focusDims.length > 0) conflicts.push({ key: "declared_learning_focus", dimensions: focusDims.slice(0, 6), targets: focus, rule: "functional_need", guidance: "Estas actividades trabajan un aprendizaje que el docente declara por reforzar: si un apoyo de comprensión o de vocabulario ayuda, priorízalo aquí. Ningún objetivo cambia." });
  return { needs, outOfScope, pedagogy: { scope, area_matched: area !== null, ...(response ? { response } : {}), focus_targets: focus }, conflicts };
}

/** Whether a decision stays inside an access adaptation: it never changes how the student answers nor how much of the task there is. */
export function exceedsAccessScope(decision: { action: string; response_target?: string | undefined }, isActivity: boolean): boolean {
  return decision.action === "change_response_format" || decision.response_target !== undefined || (decision.action === "reduce" && isActivity);
}
