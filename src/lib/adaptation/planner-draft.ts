import type { z } from "zod";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { DraftAdaptationPlanSchema, type AdaptationPlan, type PlanIssue } from "@/lib/schemas/adaptation-plan";
import { DraftAdaptationPlanV2Schema } from "@/lib/schemas/adaptation-plan-draft-v2";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { normalizePlan } from "./plan";
import { PlanDraftError, needRefTable, normalizePlanFor } from "./plan-v2";

/**
 * The planner's draft, judged before it becomes a plan: diagnosed (what is wrong, where, never the model's text), repaired
 * deterministically when the fix is unequivocal, or explained to the model for its ONE repair. Nothing is widened: the contract is
 * the same Zod schema, and a draft that still breaks it is never turned into a plan.
 *
 * Unequivocal fixes (v2 drafts only), each recorded:
 *  · `null` in an optional field (`note`, `response_target`, `visual`, `preserves`, `supports`, `flags`) = absent;
 *  · repeated values in a list (`strategies`, `need_refs`, `preserves`, `flags`) are one value;
 *  · a need reference written with leading zeros or another case (`need_01`, `NEED_1`) is the same reference;
 *  · an enum value or id that differs only in case or surrounding spaces is that value;
 *  · teacher-facing text over its length (`note` over 160, a `summary` point over 160, more than 5 points): the note is dropped,
 *    the extra or overlong points are dropped. They never decide anything.
 * Everything else (a 5th need on a decision, an unknown strategy, a missing field, a need the context does not have…) is NOT
 * guessed: it goes to the model's repair with the exact path and rule.
 */

export type DraftFailureKind = "truncated" | "not_json" | "schema" | "normalization" | "refused";

/** One invalid field: where and which rule (a Zod code or our own), never the value the model wrote. */
export interface DraftIssue {
  path: string;
  code: string;
  /** Fixed server wording of the rule (limits, allowed set), safe to log and to send back to the model. */
  rule: string;
}

export interface PlanDraftDiagnosis {
  stage: "planning";
  /** Draft contract and prompt version («DraftAdaptationPlan v2», 2). */
  schema: string;
  prompt_version: number;
  kind: DraftFailureKind;
  issues: DraftIssue[];
  truncated: boolean;
  output_tokens: number | null;
  max_output_tokens: number | null;
  /** Unequivocal fixes that were applied before judging (still failing, or this would not be a diagnosis). */
  deterministic_fixes: string[];
  repair_attempted: boolean;
  /** Why the stage stopped, when it did. */
  final_reason?: string;
}

export type DraftCheck = { ok: true; plan: AdaptationPlan; fixes: string[]; draft: unknown } | { ok: false; kind: "schema" | "normalization"; issues: DraftIssue[]; fixes: string[] };

const MAX_ISSUES = 20;
const pathOf = (path: ReadonlyArray<PropertyKey>) => path.map(String).join(".") || "(raíz)";

function ruleOf(issue: z.core.$ZodIssue): string {
  const i = issue as z.core.$ZodIssue & { maximum?: unknown; minimum?: unknown; expected?: unknown; values?: unknown[]; origin?: string; format?: string };
  switch (i.code) {
    case "too_big":
      return `como máximo ${String(i.maximum)}${i.origin === "string" ? " caracteres" : " elementos"}`;
    case "too_small":
      return `como mínimo ${String(i.minimum)}${i.origin === "string" ? " carácter" : " elemento"}`;
    case "invalid_type":
      return `obligatorio, de tipo ${String(i.expected)}`;
    case "invalid_value":
      return `uno de: ${(i.values ?? []).map(String).join(", ")}`.slice(0, 400);
    case "invalid_format":
      return "formato de identificador no válido";
    default:
      return issue.message.slice(0, 160);
  }
}

const valueAt = (root: unknown, path: ReadonlyArray<PropertyKey>): unknown =>
  path.reduce<unknown>((node, key) => (typeof node === "object" && node !== null ? (node as Record<PropertyKey, unknown>)[key] : undefined), root);

/** Paths and rules of a Zod failure. With the parsed value, a field that is absent is reported as missing (only its presence is read). */
export function zodIssues(error: z.ZodError, root?: unknown): DraftIssue[] {
  return error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const missing = root !== undefined && issue.path.length > 0 && valueAt(root, issue.path) === undefined;
    return missing ? { path: pathOf(issue.path), code: "missing", rule: `obligatorio (${ruleOf(issue)})`.slice(0, 400) } : { path: pathOf(issue.path), code: issue.code, rule: ruleOf(issue) };
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const OPTIONAL_NULLABLE = ["note", "response_target", "visual", "preserves", "supports", "flags"] as const;
const DEDUPED = ["strategies", "need_refs", "preserves", "flags"] as const;
const TRIMMED = ["target", "action", "intensity", "response_target"] as const;
const NOTE_MAX = 160;
const SUMMARY_MAX_ITEMS = 5;

/** The unequivocal fixes of a v2 draft, on a copy. Never adds, removes or reinterprets a decision. */
export function fixDraftV2(input: unknown): { draft: unknown; fixes: string[] } {
  if (!isRecord(input)) return { draft: input, fixes: [] };
  const fixes: string[] = [];
  const draft: Record<string, unknown> = { ...input };
  if (Array.isArray(draft.decisions)) {
    draft.decisions = draft.decisions.map((raw, i) => {
      if (!isRecord(raw)) return raw;
      const d: Record<string, unknown> = { ...raw };
      for (const key of OPTIONAL_NULLABLE) {
        if (d[key] === null) {
          delete d[key];
          fixes.push(`decisions.${i}.${key}: null → ausente`);
        }
      }
      for (const key of TRIMMED) {
        if (typeof d[key] === "string") {
          const v = (d[key] as string).trim();
          const normalized = key === "target" && v.toLowerCase() === "document" ? "document" : key === "target" ? v.replace(/^([A-Za-z]+)_/, (_, p: string) => `${p.toLowerCase()}_`) : v.toLowerCase();
          if (normalized !== d[key]) {
            d[key] = normalized;
            fixes.push(`decisions.${i}.${key}: mayúsculas o espacios`);
          }
        }
      }
      if (Array.isArray(d.strategies)) {
        const strategies = d.strategies.map((s) => (typeof s === "string" ? s.trim().toLowerCase() : s));
        if (strategies.some((s, k) => s !== (d.strategies as unknown[])[k])) fixes.push(`decisions.${i}.strategies: mayúsculas o espacios`);
        d.strategies = strategies;
      }
      if (Array.isArray(d.need_refs)) {
        const refs = d.need_refs.map((r) => (typeof r === "string" && /^\s*need_0*[0-9]{1,2}\s*$/i.test(r) ? `need_${Number(r.trim().slice(5))}` : r));
        if (refs.some((r, k) => r !== (d.need_refs as unknown[])[k])) fixes.push(`decisions.${i}.need_refs: referencia escrita de otra forma`);
        d.need_refs = refs;
      }
      for (const key of DEDUPED) {
        const list = d[key];
        if (Array.isArray(list) && list.every((x) => typeof x === "string")) {
          const unique = [...new Set(list as string[])];
          if (unique.length !== list.length) {
            d[key] = unique;
            fixes.push(`decisions.${i}.${key}: valores repetidos`);
          }
        }
      }
      if (typeof d.note === "string" && d.note.trim().length > NOTE_MAX) {
        delete d.note;
        fixes.push(`decisions.${i}.note: más de ${NOTE_MAX} caracteres (se omite la nota)`);
      }
      return d;
    });
  }
  if (draft.summary === null) {
    draft.summary = [];
    fixes.push("summary: null → vacío");
  }
  if (Array.isArray(draft.summary)) {
    const kept = draft.summary.filter((s) => !(typeof s === "string" && s.trim().length > NOTE_MAX));
    if (kept.length !== draft.summary.length) fixes.push(`summary: puntos de más de ${NOTE_MAX} caracteres omitidos`);
    if (kept.length > SUMMARY_MAX_ITEMS) fixes.push(`summary: más de ${SUMMARY_MAX_ITEMS} puntos (se conservan los primeros)`);
    draft.summary = kept.slice(0, SUMMARY_MAX_ITEMS);
  }
  return { draft, fixes };
}

/**
 * The draft of the given version → the canonical plan, or the exact reasons why not. A need reference the context does not have
 * is reported as such (`normalization`), never as a malformed answer, and never resolved to a guessed need.
 */
export function checkPlanDraft(version: number, input: unknown, analysis: MaterialAnalysis, context: AdaptationContext): DraftCheck {
  const { draft, fixes } = version === 2 ? fixDraftV2(input) : { draft: input, fixes: [] as string[] };
  const parsed = version === 2 ? DraftAdaptationPlanV2Schema.safeParse(draft) : DraftAdaptationPlanSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, kind: "schema", issues: zodIssues(parsed.error, draft), fixes };
  if (version === 2) {
    const known = new Set(needRefTable(context).map((n) => n.ref));
    const unknown: DraftIssue[] = [];
    (parsed.data as { decisions: Array<{ need_refs: string[] }> }).decisions.forEach((d, i) =>
      d.need_refs.forEach((ref, k) => {
        if (!known.has(ref)) unknown.push({ path: `decisions.${i}.need_refs.${k}`, code: "unknown_need_ref", rule: `solo need_1…need_${known.size}` });
      }),
    );
    if (unknown.length > 0) return { ok: false, kind: "normalization", issues: unknown.slice(0, MAX_ISSUES), fixes };
  }
  try {
    const plan = version === 2 ? normalizePlanFor(version, parsed.data, analysis, context) : normalizePlan(parsed.data, analysis, context);
    return { ok: true, plan, fixes, draft: parsed.data };
  } catch (error) {
    if (error instanceof PlanDraftError) return { ok: false, kind: "normalization", issues: [{ path: "decisions", code: error.code, rule: "referencia inexistente" }], fixes };
    if (isZodError(error)) return { ok: false, kind: "normalization", issues: zodIssues(error), fixes };
    throw error;
  }
}

const isZodError = (error: unknown): error is z.ZodError => error instanceof Error && error.name === "ZodError" && Array.isArray((error as { issues?: unknown }).issues);

const decisionOf = (path: string) => {
  const m = /^decisions\.([0-9]+)/.exec(path);
  return m ? `dec_${Number(m[1]) + 1}` : null;
};

/**
 * What the model is told for its ONE repair: the exact field and rule of each problem (server wording, never the model's own text
 * or the material). For a cut-off answer, that it was cut off and must be shorter. Shaped like the validator's issues, which is
 * what the published prompt renders (`decision_id`, `target`, `message`).
 */
export function repairNotes(kind: DraftFailureKind, issues: readonly DraftIssue[]): PlanIssue[] {
  const note = (decision_id: string | null, message: string): PlanIssue => ({ flag: "unjustified_change", severity: "block", decision_id, target: null, message: message.slice(0, 240) });
  if (kind === "truncated") return [note(null, "la respuesta anterior se cortó por longitud antes de terminar el JSON. Devuelve el plan completo y más breve: solo las decisiones necesarias, sin «note» y con «summary» de como máximo 3 puntos cortos.")];
  if (kind === "not_json") return [note(null, "la respuesta anterior no era un objeto JSON válido. Devuelve únicamente el objeto JSON del plan, sin texto ni Markdown.")];
  return issues.map((i) => {
    const field = i.path.replace(/^decisions\.[0-9]+\.?/, "") || "decisión";
    if (i.code === "unknown_need_ref") return note(decisionOf(i.path), `${field}: cita una necesidad que no existe; usa solo las referencias del contexto (${i.rule}).`);
    if (field.startsWith("need_refs") && i.code === "too_big") return note(decisionOf(i.path), `need_refs: ${i.rule}; si la decisión atiende más necesidades, divídela en dos o deja las más relevantes.`);
    return note(decisionOf(i.path), `${field}: ${i.rule}.`);
  });
}
