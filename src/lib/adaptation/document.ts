import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, Decision } from "@/lib/schemas/adaptation-plan";
import type { GeneratedSegments } from "@/lib/schemas/ai-contracts";
import { MATERIAL_DOCUMENT_SCHEMA_VERSION, MaterialDocumentSchema, createBlockId, type Block, type DraftBlock, type MaterialDocument, type ResponseSpec } from "@/lib/schemas/material-document";
import type { AnalysisActivity, AnalysisText, AnalysisVisual, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { statedAnswer } from "@/lib/analysis/answers";
import { VISUAL_ACTIONS, visualTreatment, type VisualTreatment } from "./visual-needs";

/**
 * Builds the MaterialDocument from the analysis, the plan and the generated segments. What the plan keeps is copied
 * literally from the analysis here, without a model: original words, tables and chart data cannot drift. The generator only
 * writes the blocks of targets that a decision changes or supports, and those replace (or follow) the literal blocks.
 * Inferred answers never get into the document, not even into the answer key.
 */

interface Unit {
  ref: string;
  page: number;
  blocks: Block[];
  /** Source order: (page, section, kind, id number). See `sourceOrder`. */
  order: readonly [number, number, number, number];
}

const REPLACING = new Set(["rephrase", "segment", "reorganize", "change_response_format", "reduce"]);

export function responseFor(activity: AnalysisActivity): ResponseSpec {
  const area = activity.answer_area;
  switch (area.type) {
    case "line":
      return { kind: "lines", lines: 1 };
    case "lines":
      return { kind: "lines", lines: area.lines ?? 3 };
    case "box":
      return { kind: "box", size: "medium" };
    case "large_space":
      return { kind: "box", size: "large" };
    case "grid":
      return { kind: "grid" };
    case "table_cells":
      return { kind: "table_cells" };
    case "none":
      return activity.response_format === "none" ? { kind: "none" } : { kind: "lines", lines: 2 };
    default:
      return { kind: "lines", lines: area.lines ?? 3 };
  }
}

/**
 * The answer area of an adapted activity: the original's, unless a decision changes how the student answers. Closed formats
 * need a generated answer key and are not supported by generator v1: they keep the original area.
 */
/**
 * Open answer formats the assembler sets by itself on an activity (`responseForDecision`): a shorter answer area, the keyboard or an
 * oral/alternative answer. Nothing is written for them, so no model is needed. The closed formats need an answer key: none.
 */
export const DETERMINISTIC_RESPONSES = ["write_text_short", "keyboard", "oral_or_alternative"] as const satisfies readonly NonNullable<Decision["response_target"]>[];
export const isDeterministicResponse = (decision: Pick<Decision, "action" | "response_target">) =>
  decision.action === "change_response_format" && decision.response_target !== undefined && (DETERMINISTIC_RESPONSES as readonly string[]).includes(decision.response_target);

export function responseForDecision(activity: AnalysisActivity, target: Decision["response_target"]): ResponseSpec {
  const lines = activity.answer_area.lines ?? 3;
  if (target === "keyboard") return { kind: "oral_or_alternative", mode: "keyboard", lines };
  if (target === "oral_or_alternative") return { kind: "oral_or_alternative", mode: "oral", lines: 0 };
  if (target === "write_text_short") return { kind: "lines", lines: Math.max(1, Math.ceil(lines / 2)) };
  if (target === "table_completion") return { kind: "table_cells" };
  return responseFor(activity);
}

function textBlock(t: AnalysisText, id: string): Block {
  const trace = { origin: "original" as const, source_refs: [t.id], decision_ids: [] };
  if (t.kind === "heading") return { id, type: "heading", level: 2, text: t.text.slice(0, 300), trace };
  if (t.kind === "reading_text") return { id, type: "reading_text", paragraphs: t.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), literal: true, trace };
  if (t.kind === "instruction") return { id, type: "instruction", text: t.text, trace };
  return { id, type: "paragraph", text: t.text, trace };
}

function visualBlock(v: AnalysisVisual, id: string): Block | null {
  const trace = { origin: "original" as const, source_refs: [v.id], decision_ids: [] };
  const caption = v.title ?? undefined;
  if (v.table && v.table.rows.length > 0) {
    const width = Math.max(v.table.headers.length, ...v.table.rows.map((r) => r.length), 1);
    const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")].slice(0, width);
    return { id, type: "table", caption, headers: pad(v.table.headers), rows: v.table.rows.map(pad), unit: v.table.unit ?? undefined, trace };
  }
  if (v.chart) {
    return {
      id,
      type: "chart",
      title: caption,
      chart_type: v.chart.type,
      categories: v.chart.categories,
      // Series names may be inferred by the analyzer: never shown automatically.
      series: v.chart.series.map((s) => ({ label: null, values: s.values })),
      unit: v.chart.unit ?? undefined,
      x_label: v.chart.x_label ?? undefined,
      y_label: v.chart.y_label ?? undefined,
      trace,
    };
  }
  const alt = v.description || v.title || "Imagen del material original";
  return { id, type: "image", source: { kind: "original", visual_ref: v.id }, alt_text: alt.slice(0, 300), caption, trace };
}

/**
 * Source order from the metadata the analysis really has, never from text: page first, then the position of the item's
 * section (sections are listed in reading order), then kind (texts, visuals, activities) and the number of its id (items are
 * listed in reading order within their kind). Items without a section come first on their page. Known limit: the analysis does
 * not record the order BETWEEN kinds inside one section (a visual that follows an activity in the same section is placed
 * before it); fixing that needs an explicit order in the analysis contract, which is closed (docs/ADAPTATION.md).
 */
function sourceOrder(analysis: MaterialAnalysis, item: { id: string; page: number; section_id: string | null }, kindRank: number): Unit["order"] {
  const section = item.section_id === null ? -1 : analysis.sections.findIndex((s) => s.id === item.section_id);
  return [item.page, section, kindRank, Number(item.id.split("_")[1] ?? 0)];
}

function literalUnits(analysis: MaterialAnalysis, context: AdaptationContext, newId: () => string): Unit[] {
  const units: Unit[] = [];
  const visualIds = new Map<string, string>();
  const pages = [...new Set([...analysis.texts, ...analysis.visuals, ...analysis.activities].map((x) => x.page))].sort((a, b) => a - b);
  for (const page of pages) {
    for (const t of analysis.texts.filter((x) => x.page === page)) units.push({ ref: t.id, page, blocks: [textBlock(t, newId())], order: sourceOrder(analysis, t, 0) });
    for (const v of analysis.visuals.filter((x) => x.page === page)) {
      if (v.role === "decorative" && context.presentation.decoration === "none") continue;
      const block = visualBlock(v, newId());
      if (block) {
        visualIds.set(v.id, block.id);
        units.push({ ref: v.id, page, blocks: [block], order: sourceOrder(analysis, v, 1) });
      }
    }
  }
  const textIds = new Map(units.filter((u) => u.ref.startsWith("ctt_")).map((u) => [u.ref, u.blocks[0]!.id]));
  for (const a of analysis.activities) {
    const resource_block_ids = a.resource_ids.map((r) => visualIds.get(r) ?? textIds.get(r)).filter((x): x is string => x !== undefined);
    const prompt = a.context ? `${a.instruction}\n\n${a.context}` : a.instruction;
    units.push({
      ref: a.id,
      page: a.page,
      order: sourceOrder(analysis, a, 2),
      blocks: [{ id: newId(), type: "activity", label: a.label ?? undefined, prompt, resource_block_ids, response: responseFor(a), trace: { origin: "original", source_refs: [a.id], decision_ids: [] } }],
    });
  }
  return units.sort((x, y) => x.order[0] - y.order[0] || x.order[1] - y.order[1] || x.order[2] - y.order[2] || x.order[3] - y.order[3]);
}

function rekeyBlocks(target: string, blocks: DraftBlock[], decisions: Decision[], units: Unit[], newId: () => string): { blocks: Block[]; ids: Map<string, string> } {
  const ids = new Map(blocks.map((b) => [b.id, newId()]));
  const unitFirstBlock = (ref: string) => units.find((u) => u.ref === ref)?.blocks[0]?.id;
  const resolve = (ref: string) => ids.get(ref) ?? unitFirstBlock(ref);
  const decisionIds = decisions.map((d) => d.id);
  const out = blocks.map((b) => {
    // A block written for a target traces back to it even if the generator forgot to say so.
    const source_refs = b.trace.source_refs.length > 0 || target === "document" ? b.trace.source_refs : [target];
    const trace = { ...b.trace, source_refs, decision_ids: b.trace.decision_ids.length > 0 ? b.trace.decision_ids : decisionIds };
    const id = ids.get(b.id)!;
    if (b.type === "activity") return { ...b, id, trace, resource_block_ids: (b.resource_block_ids ?? []).map(resolve).filter((x): x is string => x !== undefined) };
    return { ...b, id, trace };
  }) as Block[];
  return { blocks: out, ids };
}

export interface BuildDocumentInput {
  analysis: MaterialAnalysis;
  plan: AdaptationPlan;
  context: AdaptationContext;
  generated: GeneratedSegments | null;
  newBlockId?: () => string;
}

export function buildDocument({ analysis, plan, context, generated, newBlockId = createBlockId }: BuildDocumentInput): MaterialDocument {
  const units = literalUnits(analysis, context, newBlockId);
  const answerKey: MaterialDocument["answer_key"] = [];
  const decisionsFor = (ref: string) => plan.decisions.filter((d) => d.target === ref);

  const head: Block[] = [];
  const tail: Block[] = [];
  const after = new Map<string, Block[]>();
  const replaced = new Map<string, Block[]>();

  for (const segment of generated?.segments ?? []) {
    const decisions = plan.decisions.filter((d) => segment.decision_ids.includes(d.id));
    if (decisions.length === 0) continue;
    const { blocks, ids } = rekeyBlocks(segment.target, segment.blocks, decisions, units, newBlockId);
    for (const entry of segment.new_item_answers) {
      const blockId = ids.get(entry.block_id);
      if (blockId) answerKey.push({ block_id: blockId, basis: "new_item", correct_option_ids: entry.correct_option_ids, blanks: entry.blanks });
    }
    if (segment.target === "document") {
      (decisions.every((d) => d.action === "extend") ? tail : head).push(...blocks);
    } else if (decisions.some((d) => REPLACING.has(d.action)) && blocks.some((b) => b.type === "activity" || b.type === "paragraph" || b.type === "reading_text")) {
      // Only a segment that carries the rewritten target itself replaces it; a segment of supports for a decision that "segments"
      // goes after the untouched original (generator v2 supports-only segments would otherwise erase the activity).
      replaced.set(segment.target, [...(replaced.get(segment.target) ?? []), ...blocks]);
    } else {
      after.set(segment.target, [...(after.get(segment.target) ?? []), ...blocks]);
    }
  }

  // The visual part of each decision (docs/VISUAL_RESOURCES.md): an original visual is linked to its activity; a visual the
  // original does not have gets its place (an `image` of source `requested`) right before its target, for the teacher to fill.
  const visuals = plan.decisions.flatMap((d) => {
    const treatment = VISUAL_ACTIONS.has(d.action) ? visualTreatment(d, analysis) : null;
    return treatment ? [{ decision: d, treatment }] : [];
  });
  const placeholders = new Map<string, Block[]>();
  const linked = new Map<string, string[]>();
  const link = (target: string, id: string) => linked.set(target, [...(linked.get(target) ?? []), id]);
  for (const { decision, treatment } of visuals) {
    if (treatment.kind !== "requested") continue;
    const block = placeholderBlock(decision, treatment, newBlockId());
    if (decision.target === "document") head.push(block);
    else placeholders.set(decision.target, [...(placeholders.get(decision.target) ?? []), block]);
    link(decision.target, block.id);
  }

  const ordered: Array<{ page: number; block: Block }> = [];
  for (const unit of units) {
    const decisions = decisionsFor(unit.ref);
    if (decisions.some((d) => d.action === "remove")) continue;
    for (const block of placeholders.get(unit.ref) ?? []) ordered.push({ page: unit.page, block });
    // Segmenting a source text is deterministic: the paragraphs stay word for word, only labelled. No model rewrites them.
    const segmenting = decisions.filter((d) => d.action === "segment");
    // An open answer format is set by the assembler too (a shorter area, the keyboard, an oral answer): the prompt is untouched.
    const responding = decisions.find(isDeterministicResponse);
    const activity = analysis.activities.find((a) => a.id === unit.ref);
    const literal = unit.blocks.map((b) =>
      segmenting.length > 0 && b.type === "reading_text"
        ? { ...b, segment_labels: b.paragraphs.map((_, i) => `Parte ${i + 1}`), trace: { origin: "adapted" as const, source_refs: b.trace.source_refs, decision_ids: segmenting.map((d) => d.id) } }
        : responding && activity && b.type === "activity"
          ? { ...b, response: responseForDecision(activity, responding.response_target), trace: { origin: "adapted" as const, source_refs: b.trace.source_refs, decision_ids: [responding.id] } }
          : { ...b, trace: { ...b.trace, decision_ids: decisions.filter((d) => d.action === "keep").map((d) => d.id) } },
    );
    const blocks = replaced.get(unit.ref) ?? literal;
    for (const block of [...blocks, ...(after.get(unit.ref) ?? [])]) ordered.push({ page: unit.page, block });
  }

  // Resources point at the final block of each original element (it may have been replaced or removed).
  const originalRef = new Map(units.flatMap((u) => u.blocks.map((b) => [b.id, u.ref] as const)));
  const RESOURCE_TYPES = new Set(["reading_text", "paragraph", "table", "chart", "image", "instruction", "heading"]);
  const finalBlockOf = (ref: string) => ordered.find((o) => RESOURCE_TYPES.has(o.block.type) && o.block.trace.source_refs.includes(ref))?.block.id;
  const finalIds = new Set(ordered.map((o) => o.block.id));
  for (const o of ordered) {
    if (o.block.type !== "activity" || !o.block.resource_block_ids) continue;
    const remapped = o.block.resource_block_ids
      .map((id) => (finalIds.has(id) ? id : originalRef.has(id) ? finalBlockOf(originalRef.get(id)!) : undefined))
      .filter((x): x is string => x !== undefined);
    o.block = { ...o.block, resource_block_ids: [...new Set(remapped)] };
  }
  for (const { decision, treatment } of visuals) {
    if (treatment.kind !== "original") continue;
    const visualBlock = ordered.find((o) => RESOURCE_TYPES.has(o.block.type) && o.block.trace.source_refs.includes(treatment.visualId));
    if (!visualBlock) continue;
    visualBlock.block = { ...visualBlock.block, trace: { ...visualBlock.block.trace, decision_ids: [...new Set([...visualBlock.block.trace.decision_ids, decision.id])] } };
    link(decision.target, visualBlock.block.id);
  }
  for (const o of ordered) {
    if (o.block.type !== "activity") continue;
    const extra = o.block.trace.source_refs.flatMap((ref) => linked.get(ref) ?? []);
    if (extra.length > 0) o.block = { ...o.block, resource_block_ids: [...new Set([...(o.block.resource_block_ids ?? []), ...extra])] };
  }

  // Original stated answers go to the teacher's key; inferred ones never do.
  for (const a of analysis.activities) {
    const stated = statedAnswer(a);
    const block = ordered.find((o) => o.block.type === "activity" && o.block.trace.source_refs.includes(a.id));
    if (stated && block) answerKey.push({ block_id: block.block.id, basis: "source", value: stated });
  }

  const title: Block = { id: newBlockId(), type: "heading", level: 1, text: analysis.identification.title ?? "Ficha adaptada", trace: { origin: "structure", source_refs: [], decision_ids: [] } };
  const maxTasks = context.presentation.max_tasks_per_page;
  const pages: Array<{ blocks: Block[] }> = [{ blocks: [title, ...head] }];
  let currentPage = ordered[0]?.page ?? 1;
  let tasks = 0;
  for (const { page, block } of ordered) {
    const isTask = block.type === "activity";
    const overflow = isTask && maxTasks !== null && tasks >= maxTasks;
    if ((page !== currentPage || overflow) && pages[pages.length - 1]!.blocks.length > 0) {
      pages.push({ blocks: [] });
      tasks = 0;
    }
    currentPage = page;
    pages[pages.length - 1]!.blocks.push(block);
    if (isTask) tasks += 1;
  }
  if (tail.length > 0) pages[pages.length - 1]!.blocks.push(...tail);

  const adminSeen = new Set<string>();
  const admin_fields = analysis.administrative_fields
    .filter((f) => !adminSeen.has(`${f.type}:${f.label}`) && adminSeen.add(`${f.type}:${f.label}`))
    .map((f) => ({ type: f.type, label: f.label }));

  return MaterialDocumentSchema.parse({
    schema_version: MATERIAL_DOCUMENT_SCHEMA_VERSION,
    meta: {
      title: analysis.identification.title ?? "Ficha adaptada",
      language: context.education.language,
      stage: context.education.stage,
      grade: context.education.grade,
      subject: context.education.subject,
      topic: analysis.identification.topic.value,
    },
    presentation: context.presentation,
    admin_fields,
    pages: pages.filter((p) => p.blocks.length > 0),
    answer_key: answerKey,
  });
}

/** The reserved place of a visual the original does not have. Its accessible name is neutral until the teacher provides it. */
function placeholderBlock(decision: Decision, treatment: Extract<VisualTreatment, { kind: "requested" }>, id: string): Block {
  return {
    id,
    type: "image",
    source: { kind: "requested", decision_id: decision.id, purpose: treatment.purpose.slice(0, 300), style: treatment.style, essential: treatment.essential },
    alt_text: "Recurso visual de la actividad",
    trace: { origin: "adapted", source_refs: decision.target === "document" ? [] : [decision.target], decision_ids: [decision.id] },
  };
}

/** Deterministic id factory for tests and evals (`blk_0001`, `blk_0002`…). */
export function sequentialIds(prefix = ""): () => string {
  let n = 0;
  return () => `blk_${prefix}${String(++n).padStart(4, "0")}`;
}
