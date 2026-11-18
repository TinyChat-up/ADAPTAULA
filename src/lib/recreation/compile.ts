import type { Presentation } from "@/lib/schemas/adaptation-context";
import { MaterialDocumentSchema, type Block, type MaterialDocument, type ResponseSpec } from "@/lib/schemas/material-document";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { VISUAL_SPEC_VERSION } from "@/lib/visuals/spec";
import type { RecreationActivity, RecreationPlan } from "./contract";
import type { Solution, Verification, VerifiedActivity } from "./verify";
import type { ResolvedVisual } from "./visuals";

/**
 * A verified recreation plan → the student's material, as existing `MaterialDocument`s printed by the one renderer we have:
 *   student    the new activities, the original's reading in parts, each picture right before the activity that uses it (an essential
 *              picture that could not be made is a visible gap and the sheet is not printable); the closed answers go to `answer_key`,
 *              which no student view renders (ADR-008) and no screen of this mode shows: it stays for the server's checks;
 *   materials  the manipulatives of each activity on their own sheet: cards to cut out and the board to sort them on.
 * Nothing else is produced: no answer key and no report for the teacher (ADR-051). The teacher's explanation is the plan's own
 * `explanation`, shown on screen. Block ids are deterministic for one plan, so the same plan prints the same sheet.
 */

const LETTERS = "ABCDEFGH";

export interface CompiledRecreation {
  student: MaterialDocument;
  /** The manipulatives (cards, boards), when the plan has them. */
  materials: MaterialDocument | null;
  /** One row per activity: its printed label, the block it became and what it is traced to. */
  trace: Array<{ activity_id: string; label: string; block_id: string; objective_ids: string[]; operations: string[]; status: VerifiedActivity["status"] }>;
}

export interface CompileInput {
  plan: RecreationPlan;
  verification: Verification;
  analysis: MaterialAnalysis;
  presentation: Presentation;
  visuals: readonly ResolvedVisual[];
}

export function compileRecreation({ plan, verification, analysis, presentation, visuals }: CompileInput): CompiledRecreation {
  if (!verification.ok) throw new Error("recreation_plan_not_verified");
  let n = 0;
  const id = () => `blk_r${String(++n).padStart(4, "0")}`;
  const decisionOf = new Map(plan.strategies.map((s, i) => [s.id, `dec_${i + 1}`]));
  const decisions = (ids: readonly string[]) => ids.map((s) => decisionOf.get(s)!).filter(Boolean).slice(0, 6);
  const solutions = new Map(verification.activities.map((v) => [v.id, v]));
  const factRefs = (a: RecreationActivity) => [...new Set(plan.facts.filter((f) => JSON.stringify(a.executor).includes(`"${f.id}"`)).map((f) => f.source_ref))];

  const meta = {
    title: plan.title,
    language: "es",
    stage: analysis.identification.stage.value ?? "",
    grade: analysis.identification.grade.value,
    subject: analysis.identification.subject.value,
    topic: analysis.identification.topic.value,
  };

  const blocks: Block[] = [{ id: id(), type: "heading", level: 1, text: plan.title, trace: { origin: "structure", source_refs: [], decision_ids: [] } }];
  /** The block a resolved picture becomes (the original, the exact scheme, the generated image, or the gap of an essential one). */
  const imageBlock = (v: ResolvedVisual, a: RecreationActivity): Block => {
    const src = v.source!;
    const dec = decisions(a.strategy_ids)[0] ?? "dec_1";
    const source =
      src.kind === "original" ? { kind: "original" as const, visual_ref: src.visual_ref }
      : src.kind === "figure" ? { kind: "figure" as const, spec: src.spec, provenance: "reconstruction" as const, visual_ref: src.visual_ref }
      : src.kind === "generated" ? { kind: "generated" as const, asset_id: src.asset_id, sha256: src.sha256, decision_id: dec }
      : { kind: "requested" as const, decision_id: dec, purpose: src.purpose.slice(0, 300), style: "illustration" as const, essential: true };
    return { id: id(), type: "image", alt_text: v.alt.slice(0, 300), source, trace: { origin: "support", source_refs: a.objective_ids, decision_ids: decisions(a.strategy_ids) } };
  };
  // A CONTEXT picture is looked at before reading (to recognise what the text names): it opens the sheet, before the reading.
  const isContext = (v: ResolvedVisual) => plan.visual_requests.find((r) => r.id === v.request_id)?.function === "context" && plan.reading !== null;
  for (const v of visuals.filter((x) => x.source && isContext(x))) {
    const a = plan.activities.find((x) => x.id === v.activity_ids[0]);
    if (a) blocks.push(imageBlock(v, a));
  }
  if (plan.reading) {
    const source = analysis.texts.find((t) => t.id === plan.reading!.source_ref)!;
    const paragraphs = source.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const reading = plan.strategies.find((s) => s.method === "segmented_reading");
    blocks.push({ id: id(), type: "instruction", text: "Lee el texto por partes. Después, haz las actividades.", trace: { origin: "structure", source_refs: [], decision_ids: [] } });
    blocks.push({
      id: id(),
      type: "reading_text",
      literal: true,
      paragraphs,
      ...(paragraphs.length === plan.reading.part_titles.length ? { segment_labels: plan.reading.part_titles } : {}),
      trace: { origin: "original", source_refs: [source.id], decision_ids: reading ? decisions([reading.id]) : [] },
    });
  }

  const answerKey: MaterialDocument["answer_key"] = [];
  const trace: CompiledRecreation["trace"] = [];
  plan.activities.forEach((a, index) => {
    const label = String(index + 1);
    const t = { origin: "adapted" as const, source_refs: [...a.objective_ids, ...factRefs(a)].slice(0, 12), decision_ids: decisions(a.strategy_ids) };
    const resources: string[] = [];
    // The other pictures this activity is the first to use, right before it.
    for (const v of visuals.filter((x) => x.activity_ids[0] === a.id && x.source && !isContext(x))) {
      const block = imageBlock(v, a);
      resources.push(block.id);
      blocks.push(block);
    }
    for (const v of plan.visuals.filter((x) => a.visual_ids.includes(x.id))) {
      const block = id();
      resources.push(block);
      blocks.push({ id: block, type: "image", alt_text: `${v.title}: ${v.items.join(", ")}, unidos por flechas.`, source: { kind: "figure", spec: { kind: "flow", spec_version: VISUAL_SPEC_VERSION, title: v.title, items: v.items }, provenance: "reconstruction", visual_ref: v.source_ref }, trace: { origin: "original", source_refs: [v.source_ref], decision_ids: decisions(a.strategy_ids) } });
    }
    const verified = solutions.get(a.id)!;
    const { response, key } = responseOf(a, verified.solution);
    const block = id();
    blocks.push({ id: block, type: "activity", label, prompt: a.prompt, ...(a.steps.length ? { steps: a.steps } : {}), ...(resources.length ? { resource_block_ids: resources } : {}), response, trace: t });
    if (a.executor.kind === "short_answer" && a.executor.starters.length > 0) blocks.push({ id: id(), type: "sentence_starters", items: a.executor.starters, trace: { origin: "support", source_refs: a.objective_ids, decision_ids: decisions(a.strategy_ids) } });
    answerKey.push({ block_id: block, basis: "new_item", ...key });
    trace.push({ activity_id: a.id, label, block_id: block, objective_ids: a.objective_ids, operations: a.operations, status: verified.status });
  });

  const student = MaterialDocumentSchema.parse({
    schema_version: 1,
    meta,
    presentation,
    admin_fields: analysis.administrative_fields.map((f) => ({ type: f.type, label: f.label })),
    pages: [{ blocks }],
    answer_key: answerKey,
  });
  return { student, materials: compileMaterials(plan, presentation, meta, trace, decisionOf, visuals), trace };
}

/** The manipulatives on their own sheet, by activity: what to do, then the cards (large, with cutting lines) and the board. */
function compileMaterials(plan: RecreationPlan, presentation: Presentation, meta: MaterialDocument["meta"], trace: CompiledRecreation["trace"], decisionOf: ReadonlyMap<string, string>, visuals: readonly ResolvedVisual[]): MaterialDocument | null {
  if (plan.materials.length === 0) return null;
  let n = 0;
  const id = () => `blk_c${String(++n).padStart(4, "0")}`;
  const structure = { origin: "structure" as const, source_refs: [], decision_ids: [] };
  // One sheet per material: the cards to cut out on one, the board to sort them on the next, each with its own instruction.
  const pages: Array<{ blocks: Block[] }> = [];
  for (const m of plan.materials) {
    const blocks: Block[] = pages.length === 0 ? [{ id: id(), type: "heading", level: 1, text: "Materiales para recortar", trace: structure }] : [];
    const label = trace.find((t) => t.activity_id === m.activity_id)?.label ?? "?";
    const activity = plan.activities.find((a) => a.id === m.activity_id);
    const dec = activity?.strategy_ids.map((s) => decisionOf.get(s)).find(Boolean) ?? "dec_1";
    const t = { origin: "support" as const, source_refs: activity?.objective_ids ?? [], decision_ids: [dec] };
    // The cards' approved pictures, card by card (none when generation was not available: the card keeps its printed name).
    const illustrated = m.kind === "cut_out_cards" ? visuals.find((v) => plan.visual_requests.find((r) => r.id === v.request_id)?.for_cards === m.id)?.cards : undefined;
    const pictures = m.kind === "cut_out_cards" && illustrated?.some((c) => c.asset) ? m.cards.map((card) => illustrated.find((c) => c.text === card)?.asset?.asset_id ?? null) : undefined;
    const spec = m.kind === "cut_out_cards" ? { kind: "cut_cards" as const, spec_version: VISUAL_SPEC_VERSION, items: m.cards, ...(pictures ? { pictures } : {}) } : { kind: "sort_board" as const, spec_version: VISUAL_SPEC_VERSION, columns: m.columns };
    const alt = m.kind === "cut_out_cards" ? `Tarjetas para recortar: ${m.cards.join(", ")}.` : `Tablero con ${m.columns.length} columnas: ${m.columns.join(", ")}.`;
    blocks.push(
      { id: id(), type: "heading", level: 2, text: `${m.kind === "cut_out_cards" ? "Tarjetas" : "Tablero"} · actividad ${label}`, trace: structure },
      { id: id(), type: "instruction", text: m.instructions, trace: t },
      { id: id(), type: "image", alt_text: alt, source: { kind: "figure", spec, provenance: "generated", decision_id: dec }, trace: t },
    );
    pages.push({ blocks });
  }
  return MaterialDocumentSchema.parse({ schema_version: 1, meta: { ...meta, title: `Materiales: ${meta.title}` }, presentation: { ...presentation, max_tasks_per_page: null }, admin_fields: [], pages, answer_key: [] });
}

function responseOf(a: RecreationActivity, s: Solution): { response: ResponseSpec; key: Omit<MaterialDocument["answer_key"][number], "block_id" | "basis"> } {
  const e = a.executor;
  switch (e.kind) {
    case "classify": {
      const pairs = s.kind === "pairs" ? s.pairs : [];
      const right = e.categories.map((c, i) => ({ id: `c${i + 1}`, text: c.label }));
      const letter = (category: string) => LETTERS[e.categories.findIndex((c) => c.label === category)] ?? "?";
      return { response: { kind: "match", left: pairs.map((p, i) => ({ id: `i${i + 1}`, text: p.item })), right }, key: { value: pairs.map((p, i) => `${i + 1}-${letter(p.category)}`).join(", ") } };
    }
    case "sequence": {
      const order: { solution: string[]; printed: string[] } = s.kind === "order" ? s : { solution: [], printed: [] };
      return { response: { kind: "sequence", items: order.printed }, key: { value: order.printed.map((item) => `${order.solution.indexOf(item) + 1}. ${item}`).join(" · ") } };
    }
    case "compute":
      return { response: { kind: "fields", fields: [{ label: "Operación", space: "lines", lines: 1 }, { label: "Resultado", space: "lines", lines: 1, unit: true }] }, key: { value: s.kind === "number" ? `${s.operation} ${s.unit}` : "" } };
    case "select": {
      const options = e.options.map((o, i) => ({ id: `o${i + 1}`, text: o.text }));
      return { response: { kind: "choice", multiple: e.correct_count > 1, options }, key: { correct_option_ids: options.filter((_, i) => e.options[i]!.correct).map((o) => o.id) } };
    }
    case "true_false":
      return { response: { kind: "true_false", statements: e.statements.map((st, i) => ({ id: `s${i + 1}`, text: st.text })) }, key: { value: e.statements.map((st, i) => `${i + 1}: ${st.value ? "V" : "F"}`).join(", ") } };
    case "short_answer":
      return { response: { kind: "lines", lines: e.lines }, key: { value: e.criteria.join(" ").slice(0, 500) } };
  }
}

