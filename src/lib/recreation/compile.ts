import type { Presentation } from "@/lib/schemas/adaptation-context";
import { MaterialDocumentSchema, type Block, type MaterialDocument, type ResponseSpec } from "@/lib/schemas/material-document";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { VISUAL_SPEC_VERSION } from "@/lib/visuals/spec";
import type { RecreationActivity, RecreationPlan } from "./contract";
import type { Solution, Verification, VerifiedActivity } from "./verify";
import { mentions, resolveReferences } from "./references";
import { calculationResponse, writtenResponse } from "./response-space";
import { diagramSpecOf, diagramsFor } from "./diagrams";
import { describeDiagram } from "@/lib/visuals/diagram";
import type { Diagram } from "./contract";
import { chooseScheme, type Flow } from "./relations";
import { originalFlow, type ResolvedVisual } from "./visuals";

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
  /** Activities (by printed label) whose instruction pointed only at something that does not exist: the sheet is not usable as it is. */
  unresolved: string[];
  /** What was lost between the plan and the documents (ADR-057, designed policy): a named reason per activity. */
  lost?: string[];
  /**
   * The specific resources behind each block (ADR-058), for the fidelity audit: which block printed each request (`vr:<id>`) and scheme
   * (`rv:<id>` of the plan, `orig:<id>` of the original), which of them each activity uses, and the image block of each material.
   */
  links?: { printed: Record<string, string>; activities: Record<string, string[]>; materials: Record<string, string> };
}

export interface CompileInput {
  plan: RecreationPlan;
  verification: Verification;
  analysis: MaterialAnalysis;
  presentation: Presentation;
  visuals: readonly ResolvedVisual[];
  /** Whether a sentence that only points at a missing picture may be removed (adaptations before ADR-054). Default: yes. */
  reword?: boolean;
  /** ADR-057: every relation an activity depends on must be DRAWN in the document (a scheme), and the document is audited against the plan. */
  designed?: boolean;
}

export function compileRecreation({ plan, verification, analysis, presentation, visuals, reword = true, designed = false }: CompileInput): CompiledRecreation {
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
  const isContext = (v: ResolvedVisual) => {
    const request = plan.visual_requests.find((r) => r.id === v.request_id);
    return plan.reading !== null && (request?.function === "context" ||
      (designed && request?.function === "vocabulary" && !request.essential && !request.for_cards && v.source?.kind === "generated"));
  };
  // Each resource is printed ONCE; every activity that uses it points at that block (the renderer repeats it on a later sheet).
  const printed = new Map<string, string>();
  for (const v of visuals.filter((x) => x.source && isContext(x))) {
    const a = plan.activities.find((x) => x.id === v.activity_ids[0]);
    if (!a) continue;
    const block = imageBlock(v, a);
    printed.set(`vr:${v.request_id}`, block.id);
    blocks.push(block);
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
  const unresolved: string[] = [];
  const lost: string[] = [];
  const usedBy: Record<string, string[]> = {};
  plan.activities.forEach((a, index) => {
    const label = String(index + 1);
    const t = { origin: "adapted" as const, source_refs: [...a.objective_ids, ...factRefs(a)].slice(0, 12), decision_ids: decisions(a.strategy_ids) };
    const resources: string[] = [];
    const used: string[] = (usedBy[a.id] = []);
    const cards = plan.materials.filter((m) => m.activity_id === a.id);
    // The note is part of the activity, not a loose block that can end up on a different physical page.
    const materialNote = cards.length > 0
      ? `Usa ${[cards.some((m) => m.kind === "cut_out_cards") ? "las tarjetas" : null, cards.some((m) => m.kind === "sorting_board") ? "el tablero" : null].filter(Boolean).join(" y ")} del documento «Materiales para recortar».`
      : null;
    const use = (key: string, make: () => Block) => {
      used.push(key);
      const known = printed.get(key);
      if (known) return void resources.push(known);
      const made = make();
      printed.set(key, made.id);
      resources.push(made.id);
      blocks.push(made);
    };
    // ITS pictures (the requests that list it; a missing essential one prints as a visible gap where it is first used).
    const mine = visuals.filter((x) => x.source && x.activity_ids.includes(a.id) && (x.source.kind !== "missing" || x.activity_ids[0] === a.id));
    for (const v of mine) use(`vr:${v.request_id}`, () => imageBlock(v, a));
    // ITS exact schemes, drawn by code from the original's labels.
    const flowBlock = (v: Pick<Flow, "title" | "items" | "source_ref">) => (): Block => ({ id: id(), type: "image", alt_text: `${v.title}: ${v.items.join(", ")}, unidos por flechas.`, source: { kind: "figure", spec: { kind: "flow", spec_version: VISUAL_SPEC_VERSION, title: v.title, items: v.items }, provenance: "reconstruction", visual_ref: v.source_ref }, trace: { origin: "original", source_refs: [v.source_ref], decision_ids: decisions(a.strategy_ids) } });
    for (const v of plan.visuals.filter((x) => a.visual_ids.includes(x.id))) use(`rv:${v.id}`, flowBlock(v));
    // ITS new schemes (ADR-059): the ones that declare it, drawn by code from their nodes and relations (no picture of the original behind them).
    const diagramBlock = (d: Diagram) => (): Block => {
      const spec = diagramSpecOf(d);
      const refs = [...new Set(plan.facts.filter((f) => [...d.nodes, ...d.relations].some((x) => x.fact_id === f.id)).map((f) => f.source_ref))];
      return { id: id(), type: "image", alt_text: describeDiagram(spec).slice(0, 300), source: { kind: "figure", spec, provenance: "generated", decision_id: decisions(a.strategy_ids)[0] ?? "dec_1" }, trace: { origin: "support", source_refs: [...a.objective_ids, ...refs].slice(0, 12), decision_ids: decisions(a.strategy_ids) } };
    };
    const ownDiagrams = diagramsFor(plan, a.id);
    for (const d of ownDiagrams) use(`rd:${d.id}`, diagramBlock(d));
    const hasPicture = mine.some((v) => v.source!.kind !== "missing");
    let hasFlow = plan.visuals.some((x) => a.visual_ids.includes(x.id)) || ownDiagrams.length > 0 || mine.some((v) => v.source!.kind === "figure" && v.source!.spec.kind === "flow");
    const text = [a.prompt, ...a.steps].join(" ");
    // Arrows or a scheme it names and does not have: drawn by code from the original's own diagram when the analysis has one.
    // A request Claude marked as needing exact arrows or labels makes the relation part of the activity (ADR-057), mentioned or not.
    const exactRelation = designed && plan.visual_requests.some((r) => r.activity_ids.includes(a.id) && (r.needs_exact.arrows || r.needs_exact.labels));
    if (!hasFlow && (mentions(text, "arrows") || (mentions(text, "scheme") && !hasPicture) || exactRelation)) {
      if (designed) {
        // The scheme that CORRESPONDS to this activity (never the first of the plan): see relations.ts. Ambiguous or absent: not guessed.
        const choice = chooseScheme(a, plan, analysis);
        if (choice.ok) {
          use(choice.flow.key, choice.flow.diagram ? diagramBlock(choice.flow.diagram) : flowBlock(choice.flow));
          hasFlow = true;
        } else lost.push(`actividad ${label}: ${choice.reason === "ambiguous" ? `varios esquemas posibles (${choice.candidates.join(", ")}) y ninguno enlazado` : "ningún esquema corresponde"}`);
      } else {
        const preferred = plan.visual_requests.find((r) => r.activity_ids.includes(a.id) && r.original_ref)?.original_ref ?? null;
        const flow = originalFlow(analysis, preferred);
        if (flow) {
          use(`orig:${flow.visual_ref}`, flowBlock({ title: flow.title, items: flow.items, source_ref: flow.visual_ref }));
          hasFlow = true;
        }
      }
    }
    // The relation the activity depends on could not be drawn: the sheet cannot be delivered as if it had it.
    if (exactRelation && !hasFlow) unresolved.push(label);
    const verified = solutions.get(a.id)!;
    const { response, key } = responseOf(a, verified.solution);
    const block = id();
    // What THIS activity may point at is what THIS activity has.
    const available = { picture: hasPicture, scheme: hasPicture || hasFlow, arrows: hasFlow, cards: cards.length > 0 };
    const resolution = resolveReferences(a, available, { reword });
    if (resolution.unresolved.length > 0) unresolved.push(label);
    const shown = resolution.unresolved.length === 0 ? resolution : { prompt: a.prompt, steps: a.steps as string[] };
    blocks.push({ id: block, type: "activity", label, prompt: shown.prompt, ...(shown.steps.length ? { steps: shown.steps } : {}), ...(materialNote ? { requirements: [materialNote] } : {}), ...(resources.length ? { resource_block_ids: resources } : {}), response, trace: t });
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
  const materials = compileMaterials(plan, presentation, meta, trace, decisionOf, visuals);
  return { student, materials: materials.doc, trace, unresolved, ...(designed ? { lost, links: { printed: Object.fromEntries(printed), activities: usedBy, materials: materials.blocks } } : {}) };
}

/** The manipulatives on their own sheet, by activity: what to do, then the cards (large, with cutting lines) and the board. */
function compileMaterials(plan: RecreationPlan, presentation: Presentation, meta: MaterialDocument["meta"], trace: CompiledRecreation["trace"], decisionOf: ReadonlyMap<string, string>, visuals: readonly ResolvedVisual[]): { doc: MaterialDocument | null; blocks: Record<string, string> } {
  const imageOf: Record<string, string> = {};
  if (plan.materials.length === 0) return { doc: null, blocks: imageOf };
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
      { id: (imageOf[m.id] = id()), type: "image", alt_text: alt, source: { kind: "figure", spec, provenance: "generated", decision_id: dec }, trace: t },
    );
    pages.push({ blocks });
  }
  return { doc: MaterialDocumentSchema.parse({ schema_version: 1, meta: { ...meta, title: `Materiales: ${meta.title}` }, presentation: { ...presentation, max_tasks_per_page: null }, admin_fields: [], pages, answer_key: [] }), blocks: imageOf };
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
      return { response: calculationResponse(), key: { value: s.kind === "number" ? `${s.operation} ${s.unit}` : "" } };
    case "select": {
      const options = e.options.map((o, i) => ({ id: `o${i + 1}`, text: o.text }));
      return { response: { kind: "choice", multiple: e.correct_count > 1, options }, key: { correct_option_ids: options.filter((_, i) => e.options[i]!.correct).map((o) => o.id) } };
    }
    case "true_false":
      return { response: { kind: "true_false", statements: e.statements.map((st, i) => ({ id: `s${i + 1}`, text: st.text })) }, key: { value: e.statements.map((st, i) => `${i + 1}: ${st.value ? "V" : "F"}`).join(", ") } };
    case "short_answer":
      return { response: writtenResponse({ ...a, executor: e }), key: { value: e.criteria.join(" ").slice(0, 500) } };
  }
}

