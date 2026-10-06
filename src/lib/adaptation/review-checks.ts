import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, PlanValidation } from "@/lib/schemas/adaptation-plan";
import { OBJECTIVES_MAY_CHANGE } from "@/lib/schemas/adaptation-type";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { CLOSED_RESPONSE_KINDS, allBlocks, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { CheckResult, CheckStatus, ReviewCheck } from "@/lib/schemas/pedagogical-review";
import { blocksFor, studentText, textOf } from "./document-text";
import { CONSTRAINT_TYPES, answersOf, evaluatesOperation, evaluatesWriting, isLiteralSourceText, isOpenActivity, materialNumbers, quotedReferences } from "./facts";
import { STAGE_RULES, infantilizingMatches } from "./stage-rules";
import { answerSignatures, averageSentenceLength, criticalTokens, describeToken, hasToken, leakedSignature, normalizeText, numbersIn, sharedTokens, wordCount } from "./text";

/**
 * The deterministic part of the PedagogicalReview. Each function compares the document with the analysis, the plan and the
 * context through ids and typed fields, and returns one CheckResult. Nothing here needs a model or the network.
 */

export interface ReviewInput {
  analysis: MaterialAnalysis;
  plan: AdaptationPlan;
  context: AdaptationContext;
  document: MaterialDocument;
  validation?: PlanValidation;
}

const result = (check: ReviewCheck, status: CheckStatus, targets: string[], detail: string): CheckResult => ({
  check,
  method: "deterministic",
  status,
  targets: [...new Set(targets)].slice(0, 30),
  detail: detail.slice(0, 240),
});
const worst = (statuses: CheckStatus[]): CheckStatus => (statuses.includes("FAIL") ? "FAIL" : statuses.includes("WARN") ? "WARN" : "PASS");
/** Accumulates the findings of one check: the worst status, the messages and the affected targets. */
function collector() {
  const statuses: CheckStatus[] = [];
  const problems: string[] = [];
  const targets: string[] = [];
  const note = (status: CheckStatus, message: string, ...ids: string[]) => {
    statuses.push(status);
    problems.push(message);
    targets.push(...ids);
  };
  return { statuses, problems, targets, note };
}
const list = (values: string[]) => values.slice(0, 4).join(", ") + (values.length > 4 ? "…" : "");

function removedActivities(input: ReviewInput): Set<string> {
  return new Set(input.plan.decisions.filter((d) => d.action === "remove" && d.target.startsWith("act_")).map((d) => d.target));
}
const activityBlocks = (doc: MaterialDocument, ref: string) => blocksFor(doc, ref).filter((b) => b.type === "activity");

export function traceabilityComplete({ analysis, plan, document }: ReviewInput): CheckResult {
  const decisionIds = new Set(plan.decisions.map((d) => d.id));
  const { problems, targets, note } = collector();
  for (const b of allBlocks(document)) {
    const { origin, source_refs, decision_ids } = b.trace;
    if (origin !== "structure" && source_refs.length === 0 && decision_ids.length === 0) note("FAIL", `${b.id} sin origen`, b.id);
    if ((origin === "support" || origin === "extension" || origin === "adapted") && decision_ids.length === 0) note("FAIL", `${b.id} sin decisión`, b.id);
    for (const id of decision_ids) if (!decisionIds.has(id)) note("FAIL", `${b.id} cita ${id}, que no existe`, b.id);
  }
  const removed = new Set(plan.decisions.filter((d) => d.action === "remove").map((d) => d.target));
  for (const a of analysis.activities) if (!removed.has(a.id) && activityBlocks(document, a.id).length === 0) note("FAIL", `${a.id} no aparece`, a.id);
  if (problems.length > 0) return result("traceability_complete", "FAIL", targets, `Trazabilidad incompleta: ${list(problems)}`);

  const used = new Set(allBlocks(document).flatMap((b) => b.trace.decision_ids));
  const unused = plan.decisions.filter((d) => d.action !== "keep" && d.action !== "remove" && !used.has(d.id)).map((d) => d.id);
  if (unused.length > 0) return result("traceability_complete", "WARN", unused, `Decisiones sin bloque: ${list(unused)}`);
  return result("traceability_complete", "PASS", [], "Cada bloque remite al original o a una decisión, y cada actividad está presente");
}

export function objectivesPreserved(input: ReviewInput): CheckResult {
  const { analysis, document, plan } = input;
  const lost = analysis.pedagogical_intent.objectives.filter((o) => {
    const activities = analysis.activities.filter((a) => a.objective_ids.includes(o.id));
    return activities.length > 0 && activities.every((a) => activityBlocks(document, a.id).length === 0);
  });
  if (lost.length === 0) return result("objectives_preserved", "PASS", [], "Todos los objetivos conservan al menos una actividad");
  const status = OBJECTIVES_MAY_CHANGE[plan.adaptation_type] ? "WARN" : "FAIL";
  return result("objectives_preserved", status, lost.map((o) => o.id), `Objetivos sin actividad: ${list(lost.map((o) => o.id))}`);
}

export function instructionsComplete(input: ReviewInput): CheckResult {
  const { analysis, document } = input;
  const removed = removedActivities(input);
  const { problems, targets, note } = collector();
  for (const a of analysis.activities) {
    if (removed.has(a.id)) continue;
    const blocks = activityBlocks(document, a.id);
    if (blocks.length === 0) continue; // reported by traceability
    const text = textOf(blocksFor(document, a.id));
    const missing = criticalTokens(`${a.instruction} ${a.context ?? ""}`)
      .filter((t) => t.kind === "number")
      .filter((t) => !hasToken(text, t));
    if (missing.length > 0) note("FAIL", `${a.id} pierde ${list(missing.map(describeToken))}`, a.id, ...blocks.map((b) => b.id));
    const lostQuotes = quotedReferences(a.instruction).filter((q) => !normalizeText(text).includes(normalizeText(q)));
    if (lostQuotes.length > 0) note("FAIL", `${a.id} pierde la cita «${lostQuotes[0]}»`, a.id, ...blocks.map((b) => b.id));
    if (a.response_format !== "none" && blocks.every((b) => b.type === "activity" && b.response.kind === "none")) note("FAIL", `${a.id} sin forma de responder`, a.id);
  }
  if (problems.length > 0) return result("instructions_complete", "FAIL", targets, `Consignas incompletas: ${list(problems)}`);
  return result("instructions_complete", "PASS", [], "Cada actividad conserva sus datos y una forma de responder");
}

export function constraintsPreserved(input: ReviewInput): CheckResult {
  const { analysis, document, plan } = input;
  const removed = removedActivities(input);
  const { statuses, problems, targets, note } = collector();
  const authorizedLengthChange = (activity: string) =>
    plan.decisions.some((d) => d.target === activity && (d.strategies.includes("writing_load_reduction") || d.action === "reduce")) &&
    !(input.validation?.issues ?? []).some((i) => i.severity === "block" && i.target === activity);

  for (const p of analysis.protected_elements.filter((x) => (CONSTRAINT_TYPES as readonly string[]).includes(x.type))) {
    for (const activity of p.activity_ids.filter((id) => !removed.has(id))) {
      if (activityBlocks(document, activity).length === 0) continue;
      const text = textOf(blocksFor(document, activity));
      const original = analysis.activities.find((a) => a.id === activity);
      // The protected value is the analyzer's wording: only what the original statement says can be required.
      const required = sharedTokens(p.value, `${original?.instruction ?? ""} ${original?.context ?? ""}`);
      const missing = required.filter((t) => !hasToken(text, t));
      if (missing.length === 0) continue;
      const lengthOnly = missing.every((t) => t.kind === "number" || (t.kind === "unit" && (t.group === "lines" || t.group === "words")));
      const status: CheckStatus = p.importance !== "essential" ? "WARN" : lengthOnly && authorizedLengthChange(activity) ? "WARN" : "FAIL";
      note(status, `${activity}: falta ${list(missing.map(describeToken))} de ${p.id}`, p.id, activity);
    }
  }
  // Conditions written in the statement count even if the analysis did not protect them.
  for (const a of analysis.activities.filter((x) => !removed.has(x.id))) {
    if (activityBlocks(document, a.id).length === 0) continue;
    const text = textOf(blocksFor(document, a.id));
    const missing = criticalTokens(a.instruction).filter((t) => t.kind === "quantifier" && ["min", "max", "only", "not_reduce", "not_enough"].includes(t.group) && !hasToken(text, t));
    if (missing.length > 0) note("FAIL", `${a.id}: falta «${list(missing.map(describeToken))}»`, a.id);
  }
  const status = worst(statuses);
  if (status === "PASS") return result("constraints_preserved", "PASS", [], "Se conservan las restricciones y condiciones de las consignas");
  return result("constraints_preserved", status, targets, `Restricciones alteradas: ${list(problems)}`);
}

export function protectedElementsPreserved({ analysis, document }: ReviewInput): CheckResult {
  const { statuses, problems, targets, note } = collector();
  const whole = textOf(allBlocks(document));
  for (const p of analysis.protected_elements) {
    if ((CONSTRAINT_TYPES as readonly string[]).includes(p.type)) continue; // checked by constraints_preserved
    const severity: CheckStatus = p.importance === "essential" ? "FAIL" : p.importance === "important" ? "WARN" : "PASS";
    if (severity === "PASS") continue;
    const missingResources = p.resource_ids.filter((r) => blocksFor(document, r).length === 0);
    const missingActivities = p.activity_ids.filter((a) => activityBlocks(document, a).length === 0);
    let missingTerms: string[] = [];
    if (p.type === "required_vocabulary") {
      missingTerms = p.value.split(/[,;]| y /).map((t) => t.trim()).filter((t) => t.length >= 3 && !normalizeText(whole).includes(normalizeText(t)));
    }
    const scope = p.activity_ids.length > 0 ? textOf(p.activity_ids.flatMap((a) => blocksFor(document, a))) : whole;
    const originalText = analysis.activities.filter((a) => p.activity_ids.includes(a.id)).map((a) => `${a.instruction} ${a.context ?? ""}`).join(" ");
    const missingNumbers = sharedTokens(p.value, originalText).filter((t) => t.kind === "number" && !hasToken(scope, t));
    const missingQuotes = quotedReferences(p.value).filter((q) => normalizeText(originalText).includes(normalizeText(q)) && !normalizeText(scope).includes(normalizeText(q)));
    if (missingResources.length + missingActivities.length + missingTerms.length + missingNumbers.length + missingQuotes.length > 0) {
      note(severity, `${p.id} («${p.value.slice(0, 50)}»)`, p.id, ...missingResources, ...missingActivities);
    }
  }
  const status = worst(statuses);
  if (status === "PASS") return result("protected_elements_preserved", "PASS", [], "Los elementos protegidos siguen presentes");
  return result("protected_elements_preserved", status, targets, `Elementos protegidos perdidos o alterados: ${list(problems)}`);
}

export function requiredDataPreserved({ analysis, document }: ReviewInput): CheckResult {
  const { problems, targets, note } = collector();
  const cells = (rows: string[][]) => rows.map((r) => r.map((c) => normalizeText(c)).filter(Boolean).join("|")).join("\n");
  const needed = new Set([...analysis.activities.flatMap((a) => a.resource_ids), ...analysis.visuals.filter((v) => v.role === "required").map((v) => v.id)]);
  for (const ref of needed) {
    const blocks = blocksFor(document, ref);
    const visual = analysis.visuals.find((v) => v.id === ref);
    const text = analysis.texts.find((t) => t.id === ref);
    if (blocks.length === 0) {
      note("FAIL", `${ref} no aparece`, ref);
      continue;
    }
    if (visual?.table) {
      const table = blocks.find((b): b is Extract<Block, { type: "table" }> => b.type === "table");
      if (!table || cells([table.headers, ...table.rows]) !== cells([visual.table.headers, ...visual.table.rows])) note("FAIL", `${ref}: datos de la tabla alterados`, ref, ...(table ? [table.id] : []));
    }
    if (visual?.chart) {
      const chart = blocks.find((b): b is Extract<Block, { type: "chart" }> => b.type === "chart");
      const same = chart && JSON.stringify(chart.categories.map(normalizeText)) === JSON.stringify(visual.chart.categories.map(normalizeText)) && JSON.stringify(chart.series.map((s) => s.values)) === JSON.stringify(visual.chart.series.map((s) => s.values));
      if (!same) note("FAIL", `${ref}: datos del gráfico alterados`, ref, ...(chart ? [chart.id] : []));
    }
    if (text && isLiteralSourceText(analysis, text)) {
      const reading = blocks.find((b): b is Extract<Block, { type: "reading_text" }> => b.type === "reading_text");
      const flat = (s: string) => normalizeText(s).replace(/[^a-z0-9]/g, "");
      if (!reading || !reading.literal || flat(reading.paragraphs.join(" ")) !== flat(text.text)) note("FAIL", `${ref}: el texto fuente no es literal`, ref, ...(reading ? [reading.id] : []));
    }
  }
  if (problems.length > 0) return result("required_data_preserved", "FAIL", targets, `Datos necesarios perdidos o alterados: ${list(problems)}`);
  return result("required_data_preserved", "PASS", [], "Tablas, gráficos y textos necesarios conservan sus datos");
}

/**
 * An inferred answer can be checked mechanically only when it carries numbers that the material does not print: a leak is then
 * a number showing up where it should not. A textual answer (or one made only of numbers already on the sheet) cannot be
 * excluded by matching: a paraphrase or a synonym would pass. "Cannot verify" is never a PASS: it is a WARN that asks for a
 * semantic review, which the pedagogical reviewer can resolve (`mergeAiChecks`). No keyword about any particular answer is used.
 */
export function isMechanicallyVerifiable(answer: string, materialNumberSet: ReadonlySet<string>): boolean {
  return numbersIn(answer).some((n) => !materialNumberSet.has(n));
}

export function answersNotLeaked({ analysis, document }: ReviewInput): CheckResult {
  const numbers = materialNumbers(analysis);
  const { statuses, problems, targets, note } = collector();
  const unverifiable: string[] = [];
  for (const answer of answersOf(analysis)) {
    const signatures = answerSignatures(answer.value, numbers);
    if (answer.basis === "inferred" && !isMechanicallyVerifiable(answer.value, numbers)) unverifiable.push(answer.activity);
    if (signatures.length === 0) continue;
    for (const block of allBlocks(document)) {
      const leak = leakedSignature(studentText(block), signatures);
      if (!leak) continue;
      note(answer.basis === "inferred" ? "FAIL" : "WARN", `${block.id} contiene «${leak}» (respuesta de ${answer.activity})`, block.id, answer.activity);
    }
    if (answer.basis === "inferred" && document.answer_key.some((e) => e.value && leakedSignature(e.value, signatures))) {
      note("FAIL", `la clave contiene la respuesta inferida de ${answer.activity}`, answer.activity);
    }
  }
  const status = worst(statuses);
  if (status !== "PASS") return result("answers_not_leaked", status, targets, `Respuesta revelada: ${list(problems)}`);
  if (unverifiable.length > 0) {
    return {
      ...result("answers_not_leaked", "WARN", unverifiable, `No se pudo comprobar de forma determinista la respuesta inferida de ${list(unverifiable)} (no se puede excluir una fuga semántica): requiere revisión semántica`),
      needs_semantic_review: true,
    };
  }
  return result("answers_not_leaked", "PASS", [], "Ninguna respuesta aparece en el contenido del alumno");
}

export function responseFormatAppropriate(input: ReviewInput): CheckResult {
  const { analysis, document } = input;
  const { statuses, problems, targets, note } = collector();
  for (const a of analysis.activities) {
    for (const b of activityBlocks(document, a.id)) {
      if (b.type !== "activity") continue;
      const closed = (CLOSED_RESPONSE_KINDS as readonly string[]).includes(b.response.kind);
      if (closed && evaluatesWriting(analysis, a)) note("FAIL", `${a.id}: la escritura evaluada pasa a respuesta cerrada`, b.id, a.id);
      else if (closed && evaluatesOperation(analysis, a)) note("FAIL", `${a.id}: la operación pasa a reconocer un resultado`, b.id, a.id);
      else if (closed && isOpenActivity(a)) note("WARN", `${a.id}: tarea abierta convertida en cerrada`, b.id, a.id);
      if (evaluatesWriting(analysis, a) && b.response.kind === "lines" && a.answer_area.lines && b.response.lines < Math.ceil(a.answer_area.lines / 2)) {
        note("WARN", `${a.id}: menos espacio para escribir del que pide la tarea`, b.id);
      }
    }
  }
  const status = worst(statuses);
  if (status === "PASS") return result("response_format_appropriate", "PASS", [], "Las formas de respuesta mantienen lo que se evalúa");
  return result("response_format_appropriate", status, targets, list(problems));
}

/** Needs that the layout meets through the document's presentation settings, without a plan decision. */
const MET_BY_LAYOUT: Partial<Record<string, (doc: MaterialDocument) => boolean>> = {
  number_of_visible_tasks: (doc) => doc.presentation.max_tasks_per_page !== null,
  unnecessary_decoration: (doc) => doc.presentation.decoration !== "standard",
  visual_density: (doc) => doc.presentation.decoration !== "standard",
};

export function functionalSupportsApplied({ context, plan, document }: ReviewInput): CheckResult {
  const used = new Set(allBlocks(document).flatMap((b) => b.trace.decision_ids));
  const unmet = context.needs
    .filter((n) => n.level !== "low")
    .filter((n) => !MET_BY_LAYOUT[n.dimension]?.(document))
    .filter((n) => {
      const decisions = plan.decisions.filter((d) => d.dimensions.includes(n.dimension));
      return decisions.length === 0 || !decisions.some((d) => d.action === "remove" || used.has(d.id));
    })
    .map((n) => n.dimension);
  const presentationOk = JSON.stringify(document.presentation) === JSON.stringify(context.presentation);
  if (unmet.length === 0 && presentationOk) return result("functional_supports_applied", "PASS", [], "Las necesidades del perfil tienen decisiones aplicadas");
  const parts = [unmet.length > 0 ? `necesidades sin aplicar: ${list(unmet)}` : "", presentationOk ? "" : "la presentación no corresponde al perfil"].filter(Boolean);
  return result("functional_supports_applied", "WARN", [], parts.join("; "));
}

export function visualLoadReasonable({ analysis, context, document }: ReviewInput): CheckResult {
  const loadNeeds = context.needs.some((n) => ["visual_density", "visual_distraction_reduction", "unnecessary_decoration", "sensory_triggers"].includes(n.dimension));
  const { problems, targets, note } = collector();
  const decorative = new Set(analysis.visuals.filter((v) => v.role === "decorative").map((v) => v.id));
  for (const page of document.pages) {
    const images = page.blocks.filter((b) => b.type === "image");
    const deco = images.filter((b) => b.type === "image" && b.source.kind === "original" && decorative.has(b.source.visual_ref));
    if (loadNeeds && deco.length > 0) note("WARN", "decoración que el perfil pide evitar", ...deco.map((b) => b.id));
    const visuals = page.blocks.filter((b) => b.type === "image" || b.type === "chart").length;
    if (visuals > (loadNeeds ? 2 : 4)) note("WARN", `${visuals} elementos visuales en una página`, ...images.map((b) => b.id));
  }
  if (loadNeeds && document.presentation.decoration === "standard") note("WARN", "decoración estándar con necesidad de menos carga visual");
  if (problems.length > 0) return result("visual_load_reasonable", "WARN", targets, list(problems));
  return result("visual_load_reasonable", "PASS", [], "Carga visual adecuada al perfil");
}

export function readingLoadReasonable({ context, document }: ReviewInput): CheckResult {
  const { problems, targets, note } = collector();
  const max = context.limits.max_instruction_words;
  const sentenceNeed = context.needs.find((n) => n.dimension === "sentence_length");
  for (const b of allBlocks(document)) {
    if (b.type !== "activity" && b.type !== "instruction") continue;
    const main = b.type === "activity" ? b.prompt : b.text;
    const pieces = [main.split(/\n\s*\n/)[0] ?? main, ...(b.steps ?? [])];
    if (max !== null && pieces.some((p) => wordCount(p) > max)) note("WARN", `${b.id} supera ${max} palabras por instrucción`, b.id);
    if (sentenceNeed && b.trace.origin !== "original") {
      const limit = sentenceNeed.level === "high" ? 15 : 20;
      if (averageSentenceLength(pieces.join(". ")) > limit) note("WARN", `${b.id} con frases largas`, b.id);
    }
  }
  if (problems.length > 0) return result("reading_load_reasonable", "WARN", targets, list(problems));
  return result("reading_load_reasonable", "PASS", [], "Carga de lectura dentro de los límites del perfil");
}

export function noInfantilization({ context, document }: ReviewInput): CheckResult {
  const guard = context.audience.infantilization_guard;
  const allowed = STAGE_RULES[context.education.stage].image_styles;
  const { statuses, problems, targets, note } = collector();
  for (const b of allBlocks(document)) {
    const found = infantilizingMatches(studentText(b));
    if (found.length > 0) note(guard ? "FAIL" : "WARN", `${b.id}: «${found.join("», «")}»`, b.id);
    if (b.type === "image" && b.source.kind === "requested" && !allowed.includes(b.source.style)) note("WARN", `${b.id}: estilo ${b.source.style} poco adecuado para la etapa`, b.id);
  }
  const status = worst(statuses);
  if (status === "PASS") return result("no_infantilization", "PASS", [], guard ? "Lenguaje y estética adecuados a la edad" : "Sin expresiones condescendientes");
  return result("no_infantilization", status, targets, list(problems));
}
