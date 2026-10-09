import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { buildDocument, sequentialIds } from "./document";
import { stableStringify } from "./fingerprint";
import { UNAUTHORIZED_CODES, REDUNDANCY_CODES, authorizedBlockTypes, targetKindOf, type NormalizedGeneration } from "./generated";
import { activityExpansion, type ActivityExpansion } from "./redundancy";
import type { ReviewedPlan } from "./plan-review";
import { checkOf } from "./review";
import { visualTreatment } from "./visual-needs";

/**
 * Deterministic audit of one generation against the reviewed plan (docs/ADAPTATION.md § Generador). It does not trust the
 * normaliser: it re-reads the final MaterialDocument and answers, with ids and typed fields only, whether the generator
 * did exactly what was approved: nothing more, nothing less, and nothing else changed.
 */

export interface AuditCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GenerationAudit {
  checks: AuditCheck[];
  ok: boolean;
  /** Approved decisions that produced nothing and were not declined: the generator ignored them. */
  ignoredApproved: string[];
  /** Blocks in the document that trace to a decision that is not applied (rejected, blocked, unreviewed or unknown). */
  appliedFromNonEffective: string[];
  /** Segments or blocks the generator proposed outside what the plan authorises (dropped before assembly). */
  proposedUnauthorized: number;
  /** Visible words per activity and repeated sentences (exact and near). Metrics for the experiments, not product rules. */
  expansion: ActivityExpansion[];
  /** Things the model wrote that the server had to drop or replace by the original because they were redundant or lossy. */
  redundancyInterventions: number;
  /** Non-failing observations (near repeats, budget overruns…). */
  findings: string[];
}

/** A block without ids and decision links, comparable across two documents built with different id sequences. */
function comparable(block: Block): string {
  const { id: _id, ...rest } = block;
  void _id;
  const trace = { origin: block.trace.origin, source_refs: block.trace.source_refs };
  return stableStringify({ ...rest, trace, ...(block.type === "activity" ? { resource_block_ids: undefined } : {}) });
}

export function auditGeneration(input: {
  analysis: MaterialAnalysis;
  context: AdaptationContext;
  reviewed: ReviewedPlan;
  generation: NormalizedGeneration;
  document: MaterialDocument;
  review: PedagogicalReview;
}): GenerationAudit {
  const { analysis, context, reviewed, generation, document, review } = input;
  const effectiveIds = new Set(reviewed.effective.decisions.map((d) => d.id));
  const blocks = allBlocks(document);
  const checks: AuditCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const missing = analysis.activities.filter((a) => !reviewed.effective.decisions.some((d) => d.target === a.id && d.action === "remove") && !blocks.some((b) => b.type === "activity" && b.trace.source_refs.includes(a.id)));
  add("todas las actividades originales siguen presentes", missing.length === 0, missing.length === 0 ? `${analysis.activities.length} de ${analysis.activities.length}` : `faltan ${missing.map((a) => a.id).join(", ")}`);

  const fromNonEffective = [...new Set(blocks.filter((b) => b.trace.decision_ids.some((id) => !effectiveIds.has(id))).map((b) => b.id))];
  add("ningún bloque procede de una decisión no aplicada (rechazada, bloqueada o sin revisar)", fromNonEffective.length === 0, fromNonEffective.length === 0 ? "ninguno" : fromNonEffective.join(", "));

  const unauthorized = generation.issues.filter((i) => UNAUTHORIZED_CODES.includes(i.code));
  add("el generador no propuso nada fuera de lo autorizado", unauthorized.length === 0, unauthorized.length === 0 ? "nada fuera de sus decisiones" : unauthorized.map((i) => `${i.code}${i.decision_id ? `(${i.decision_id})` : ""}`).join(", "));

  const badBlocks = blocks.filter((b) => {
    if (b.trace.origin === "original" || b.trace.origin === "structure") return false;
    return b.trace.decision_ids.some((id) => {
      const d = reviewed.effective.decisions.find((x) => x.id === id);
      if (!d) return true;
      const target = d.target === "document" ? "document" : d.target;
      const kind = targetKindOf(analysis, target);
      // Deterministic composition (a segmented source text is labelled, not written) is not a generated block.
      if (b.type === "reading_text") return !(d.action === "segment" && kind === "text");
      // Nor is the reserved place of a visual the decision asks for (docs/VISUAL_RESOURCES.md): nothing was drawn.
      if (b.type === "image" && b.source.kind === "requested") return !(b.source.decision_id === d.id && visualTreatment(d, analysis)?.kind === "requested");
      return !authorizedBlockTypes(d, kind).has(b.type);
    });
  });
  add("cada bloque generado es de un tipo que su decisión autoriza", badBlocks.length === 0, badBlocks.length === 0 ? "sí" : badBlocks.map((b) => `${b.id}:${b.type}`).join(", "));

  // Everything without an effective decision must be copied identically from the analysis.
  const literal = buildDocument({ analysis, plan: { ...reviewed.effective, decisions: [] }, context, generated: null, newBlockId: sequentialIds("l") });
  const touched = new Set(reviewed.effective.decisions.filter((d) => d.action !== "keep").map((d) => d.target));
  const refs = [...analysis.activities.map((a) => a.id), ...analysis.texts.map((t) => t.id), ...analysis.visuals.map((v) => v.id)].filter((r) => !touched.has(r));
  const differing = refs.filter((ref) => {
    const a = allBlocks(literal).filter((b) => b.trace.source_refs.includes(ref) && b.trace.origin === "original").map(comparable);
    const b = blocks.filter((x) => x.trace.source_refs.includes(ref) && x.trace.origin === "original").map(comparable);
    return a.length !== b.length || a.some((x, i) => x !== b[i]);
  });
  add("lo que no tiene decisión efectiva se copia idéntico del análisis", differing.length === 0, differing.length === 0 ? `${refs.length} elementos intactos` : `difieren ${differing.join(", ")}`);

  const areas = analysis.activities.flatMap((a) => {
    const decision = reviewed.effective.decisions.find((d) => d.target === a.id && d.response_target);
    if (decision) return [];
    return blocks.filter((b) => b.type === "activity" && b.trace.source_refs.includes(a.id)).flatMap((b) => {
      const lit = allBlocks(literal).find((x) => x.type === "activity" && x.trace.source_refs.includes(a.id));
      return b.type === "activity" && lit?.type === "activity" && stableStringify(b.response) !== stableStringify(lit.response) ? [a.id] : [];
    });
  });
  add("las zonas de respuesta coinciden con las del original (salvo decisión que las cambie)", areas.length === 0, areas.length === 0 ? "coinciden" : `cambian en ${areas.join(", ")}`);

  const expansion = activityExpansion(analysis, document);
  const exact = expansion.filter((e) => e.exactRepeats > 0);
  // v2 drops exact repeats itself, so any left is a bug; v1 (historical) did not and is only observed.
  if (generation.version === 2) add("ninguna frase se repite literalmente dentro de una actividad", exact.length === 0, exact.length === 0 ? "sin repeticiones literales" : exact.map((e) => `${e.id}×${e.exactRepeats}`).join(", "));
  const findings = [
    ...exact.filter(() => generation.version !== 2).map((e) => `${e.id}: ${e.exactRepeats} repeticiones literales`),
    ...expansion.filter((e) => e.nearRepeats > 0).map((e) => `${e.id}: ${e.nearRepeats} repeticiones casi literales`),
    ...generation.issues.filter((i) => ["near_duplicate", "support_over_budget", "planner_label_restates"].includes(i.code)).map((i) => `${i.decision_id}: ${i.code} (${i.detail})`),
  ];

  const traced = blocks.filter((b) => b.trace.origin !== "structure" && b.trace.source_refs.length === 0 && b.trace.decision_ids.length === 0);
  // A WARN here only means an approved decision produced no block (declined or ignored): the next checks judge which.
  add("trazabilidad completa (todo bloque remite al original o a una decisión)", checkOf(review, "traceability_complete").status !== "FAIL" && traced.length === 0, checkOf(review, "traceability_complete").detail);
  for (const [name, check] of [
    ["ninguna respuesta inferida aparece (ni en la clave)", "answers_not_leaked"],
    ["los datos necesarios se conservan", "required_data_preserved"],
    ["los elementos protegidos se conservan", "protected_elements_preserved"],
    ["las restricciones y condiciones se conservan", "constraints_preserved"],
    ["las consignas están completas", "instructions_complete"],
    ["las formas de respuesta mantienen lo evaluado", "response_format_appropriate"],
    ["sin infantilización", "no_infantilization"],
  ] as const) {
    const c = checkOf(review, check);
    add(name, c.status !== "FAIL", `${c.status}: ${c.detail}`);
  }

  const executed = generation.requested.length === generation.generated.length + generation.declined.length;
  add("todas las decisiones aprobadas se ejecutaron o se rechazaron de forma estructurada", executed && generation.ignored.length === 0, `solicitadas ${generation.requested.length} · generadas ${generation.generated.length} · rechazadas por el modelo ${generation.declined.length} · ignoradas ${generation.ignored.length}`);

  return {
    checks,
    ok: checks.every((c) => c.ok),
    ignoredApproved: generation.ignored,
    appliedFromNonEffective: fromNonEffective,
    proposedUnauthorized: unauthorized.length,
    expansion,
    redundancyInterventions: generation.issues.filter((i) => REDUNDANCY_CODES.includes(i.code)).length,
    findings,
  };
}
