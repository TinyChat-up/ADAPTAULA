import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { DraftBlockSchema, blockConsistencyIssues, type DraftBlock } from "@/lib/schemas/material-document";
import type { PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { responseFor } from "./document";
import type { NormalizedGeneration } from "./generated";
import type { DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import { normalizeText } from "./text";
import { CONCEPT_LEAK_CHECK, INVALID_BLOCK_CHECK, LITERAL_COPY_CHECK, MISSING_ACTIVITY_CHECK, NON_EFFECTIVE_CHECK, OUT_OF_BUDGET_CHECK, RESPONSE_AREA_CHECK, type AuditCheck, type GenerationAudit } from "./generation-checks";

/**
 * Localized recovery of a generation («Hacer magia» 2.0, docs/ADAPTATION.md § Recuperación localizada). Three pure tools:
 *   · `screenGeneration`: a generated block that breaks the document contract is dropped BEFORE assembly and recorded against its
 *     decision (one bad block no longer makes the whole sheet unbuildable, and the decision to regenerate is known);
 *   · `diagnoseGeneration`: every failure classified (category, rule, decisions, units), what is stored to explain a stop;
 *   · `repairLocally`: the fixes that need no model and lose nothing (the original's response area put back, a block's link to a
 *     decision that is not applied removed, a segment written for a unit no decision changes dropped).
 * The checks are never relaxed: whatever is repaired is assembled and audited again, from scratch, by the same checks.
 */

export const FAILURE_CATEGORIES = [
  "json", "schema", "unauthorized_block", "duplicate_support", "structure_loss", "data_loss", "answer_leak",
  "format_incompatible", "visual_unresolved", "pedagogical_review", "cost_or_limit", "not_executed", "traceability",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** Shortening a failed glossary must not silently remove its terms. Definitions still need the complete pedagogical review. */
export function missingRepairedGlossaries(previous: readonly Pick<DraftGeneratedSegmentsV2["segments"][number], "decision_id" | "target" | "supports">[], fresh: NormalizedGeneration["segments"]): string[] {
  return previous.flatMap((old) => {
    const wanted = old.supports.flatMap((s) => s.kind === "glossary" ? s.items.map((i) => normalizeText(i.term)) : []);
    if (!wanted.length) return [];
    const actual = new Set(fresh.segments.filter((s) => s.decision_ids.includes(old.decision_id) && s.target === old.target).flatMap((s) => s.blocks.flatMap((b) => b.type === "vocabulary" && b.trace.decision_ids.includes(old.decision_id) ? b.items.map((i) => normalizeText(i.term)) : [])));
    return wanted.some((term) => !actual.has(term)) ? [old.decision_id] : [];
  });
}

export interface GenerationFailure {
  category: FailureCategory;
  /** The audit check or review check that failed (its stable name or code). */
  rule: string;
  decisions: string[];
  refs: string[];
  /** How it can be repaired: without a model, by regenerating only the decisions it names, or not at all. */
  repair: "deterministic" | "ai_fragment" | "none";
}

const AUDIT_CATEGORY: Readonly<Record<string, FailureCategory>> = {
  [MISSING_ACTIVITY_CHECK]: "structure_loss",
  [NON_EFFECTIVE_CHECK]: "unauthorized_block",
  [INVALID_BLOCK_CHECK]: "schema",
  "el generador no propuso nada fuera de lo autorizado": "unauthorized_block",
  "cada bloque generado es de un tipo que su decisión autoriza": "format_incompatible",
  [LITERAL_COPY_CHECK]: "data_loss",
  [RESPONSE_AREA_CHECK]: "structure_loss",
  "ninguna frase se repite literalmente dentro de una actividad": "duplicate_support",
  [OUT_OF_BUDGET_CHECK]: "duplicate_support",
  [CONCEPT_LEAK_CHECK]: "answer_leak",
  "trazabilidad completa (todo bloque remite al original o a una decisión)": "traceability",
  "ninguna respuesta inferida aparece (ni en la clave)": "answer_leak",
  "los datos necesarios se conservan": "data_loss",
  "los elementos protegidos se conservan": "data_loss",
  "las restricciones y condiciones se conservan": "data_loss",
  "las consignas están completas": "data_loss",
  "las formas de respuesta mantienen lo evaluado": "format_incompatible",
  "sin infantilización": "pedagogical_review",
  "todas las decisiones aprobadas se ejecutaron o se rechazaron de forma estructurada": "not_executed",
};

const REVIEW_CATEGORY: Readonly<Partial<Record<PedagogicalReview["checks"][number]["check"], FailureCategory>>> = {
  answers_not_leaked: "answer_leak",
  required_data_preserved: "data_loss",
  protected_elements_preserved: "data_loss",
  constraints_preserved: "data_loss",
  instructions_complete: "data_loss",
  objectives_preserved: "data_loss",
  response_format_appropriate: "format_incompatible",
  traceability_complete: "traceability",
};

/** Failures that `repairLocally` fixes without a model when nothing else is implicated. */
const DETERMINISTIC: ReadonlySet<string> = new Set([NON_EFFECTIVE_CHECK, RESPONSE_AREA_CHECK, LITERAL_COPY_CHECK]);

export function diagnoseAudit(audit: Pick<GenerationAudit, "checks">): GenerationFailure[] {
  return audit.checks.filter((c) => !c.ok).map((c) => failureOfAudit(c));
}

function failureOfAudit(c: AuditCheck): GenerationFailure {
  const decisions = c.decisions ?? [];
  return {
    category: AUDIT_CATEGORY[c.name] ?? "pedagogical_review",
    rule: c.name,
    decisions,
    refs: c.refs ?? [],
    repair: DETERMINISTIC.has(c.name) ? "deterministic" : decisions.length > 0 ? "ai_fragment" : "none",
  };
}

export function diagnoseReview(review: Pick<PedagogicalReview, "checks">): GenerationFailure[] {
  return review.checks
    .filter((c) => c.status === "FAIL" && !c.teacher_override)
    .map((c) => ({ category: REVIEW_CATEGORY[c.check] ?? "pedagogical_review", rule: c.check, decisions: c.targets.filter((t) => t.startsWith("dec_")), refs: c.targets.filter((t) => !t.startsWith("dec_")), repair: "ai_fragment" as const }));
}

/** Everything a stop needs to say why, by rule and unit (names and ids only, never content). */
export function diagnoseGeneration(input: { audit?: Pick<GenerationAudit, "checks"> | null; review?: Pick<PedagogicalReview, "checks"> | null; generation?: Pick<NormalizedGeneration, "issues"> | null }): GenerationFailure[] {
  const out = [...(input.audit ? diagnoseAudit(input.audit) : []), ...(input.review ? diagnoseReview(input.review) : [])];
  const seen = new Set<string>();
  return out.filter((f) => {
    const key = `${f.rule}|${f.decisions.join(",")}|${f.refs.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A stable signature of what failed and where: two cycles with the same one made no progress. */
export const failureSignature = (failures: readonly GenerationFailure[]) => failures.map((f) => `${f.rule}@${[...f.decisions].sort().join("+")}`).sort().join(" | ");

// ---------------------------------------------------------------------------------------------------------------------
// Screening (before assembly)
// ---------------------------------------------------------------------------------------------------------------------

type Segment = NormalizedGeneration["segments"]["segments"][number];

/** Why a generated block cannot enter the document, or null when it can. */
function blockProblem(block: DraftBlock): string | null {
  const parsed = DraftBlockSchema.safeParse(block);
  if (!parsed.success) return parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".") || "bloque"}: ${i.code}`).join(", ");
  const consistency = blockConsistencyIssues(parsed.data);
  return consistency.length > 0 ? consistency[0]! : null;
}

/**
 * The generation without the blocks that break the document contract (too long, a malformed table, a missing field). Each drop is
 * recorded against its decision (`invalid_block_dropped`), and a decision left without any block is no longer «generated». Nothing
 * valid is touched; an already clean generation is returned as is (same object).
 */
export function screenGeneration(generation: NormalizedGeneration): NormalizedGeneration {
  const issues = [...generation.issues];
  let changed = false;
  const segments: Segment[] = [];
  for (const segment of generation.segments.segments) {
    const blocks = segment.blocks.filter((block) => {
      const problem = blockProblem(block);
      if (!problem) return true;
      changed = true;
      issues.push({ code: "invalid_block_dropped", decision_id: segment.decision_ids[0] ?? null, detail: `${block.type}: ${problem}`.slice(0, 200) });
      return false;
    });
    if (blocks.length > 0) segments.push({ ...segment, blocks });
  }
  if (!changed) return generation;
  const withBlocks = new Set(segments.flatMap((s) => s.decision_ids));
  const generated = generation.generated.filter((id) => withBlocks.has(id));
  const lost = generation.generated.filter((id) => !withBlocks.has(id));
  return { ...generation, segments: { ...generation.segments, segments }, issues, generated, ignored: [...new Set([...generation.ignored, ...lost])] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Deterministic local repair (after an audit)
// ---------------------------------------------------------------------------------------------------------------------

export interface LocalRepair {
  generation: NormalizedGeneration;
  /** What was fixed, by rule and unit (for the log and the execution report). */
  fixes: string[];
}

/**
 * The fixes that need no model and lose nothing the plan asked for:
 *   · an activity whose answer area changed without a decision that changes it gets the ORIGINAL's area back;
 *   · a generated block linked to a decision that is not applied loses that link (the block stays if another applied decision
 *     wrote it; a block only that decision wrote is dropped);
 *   · a segment written for a unit no decision changes (its original must stay identical) is dropped.
 * Null when nothing applies. The caller assembles and audits the result again and keeps it only if it is strictly better.
 */
export function repairLocally(generation: NormalizedGeneration, audit: Pick<GenerationAudit, "checks">, analysis: MaterialAnalysis, effectiveIds: ReadonlySet<string>): LocalRepair | null {
  const failing = audit.checks.filter((c) => !c.ok);
  const fixes: string[] = [];
  let segments = generation.segments.segments.map((s) => ({ ...s, blocks: [...s.blocks] }));

  const areas = new Set(failing.filter((c) => c.name === RESPONSE_AREA_CHECK).flatMap((c) => c.refs ?? []));
  for (const ref of areas) {
    const activity = analysis.activities.find((a) => a.id === ref);
    if (!activity) continue;
    const original = responseFor(activity);
    segments = segments.map((s) => (s.target !== ref ? s : { ...s, blocks: s.blocks.map((b) => (b.type === "activity" ? { ...b, response: original } : b)) }));
    fixes.push(`${RESPONSE_AREA_CHECK}: ${ref}`);
  }

  if (failing.some((c) => c.name === NON_EFFECTIVE_CHECK)) {
    let stripped = 0;
    segments = segments.map((s) => ({
      ...s,
      decision_ids: s.decision_ids.filter((id) => effectiveIds.has(id)),
      blocks: s.blocks.flatMap((b) => {
        const kept = b.trace.decision_ids.filter((id) => effectiveIds.has(id));
        if (kept.length === b.trace.decision_ids.length) return [b];
        stripped += 1;
        return kept.length > 0 || s.decision_ids.some((id) => effectiveIds.has(id)) ? [{ ...b, trace: { ...b.trace, decision_ids: kept } }] : [];
      }),
    })).filter((s) => s.decision_ids.length > 0 && s.blocks.length > 0);
    if (stripped > 0) fixes.push(`${NON_EFFECTIVE_CHECK}: ${stripped} bloque(s)`);
  }

  const untouched = new Set(failing.filter((c) => c.name === LITERAL_COPY_CHECK).flatMap((c) => c.refs ?? []));
  if (untouched.size > 0) {
    const before = segments.length;
    segments = segments.filter((s) => !untouched.has(s.target));
    if (segments.length < before) fixes.push(`${LITERAL_COPY_CHECK}: ${[...untouched].join(", ")}`);
  }

  if (fixes.length === 0) return null;
  const withBlocks = new Set(segments.flatMap((s) => s.decision_ids));
  return {
    generation: { ...generation, segments: { ...generation.segments, segments }, generated: generation.generated.filter((id) => withBlocks.has(id)) },
    fixes,
  };
}
