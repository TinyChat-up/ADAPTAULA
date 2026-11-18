import type { Presentation } from "@/lib/schemas/adaptation-context";
import { MaterialDocumentSchema, type Block, type MaterialDocument, type ResponseSpec } from "@/lib/schemas/material-document";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { VISUAL_SPEC_VERSION } from "@/lib/visuals/spec";
import type { RecreationActivity, RecreationPlan } from "./contract";
import type { Solution, Verification, VerifiedActivity } from "./verify";

/**
 * A verified recreation plan → two existing `MaterialDocument`s, printed by the one renderer we have (no new layout code):
 *   student  the new activities, with the original's reading split in parts and the visual drawn from data; the closed answers go to
 *            `answer_key`, which the student view never renders (ADR-008);
 *   guide    for the teacher only: traceability of each activity to its objective, how each solution is known, what to observe and
 *            the cards to cut out. Solutions live here as text, never in the student's document.
 * Block ids are assigned here (`blk_r…`), deterministic for one plan, so the same plan prints the same sheet.
 */

const LETTERS = "ABCDEFGH";
const STATUS_ES: Record<VerifiedActivity["status"], string> = { verified: "Comprobada por el sistema", anchored: "Apoyada en el texto; revisar el sentido", teacher_review: "Respuesta abierta: valorar con los criterios" };
const OP_ES: Record<string, string> = { identify: "identificar", locate_evidence: "localizar pruebas", classify: "clasificar", sequence: "ordenar", interpret_relation: "interpretar relaciones", predict: "predecir", calculate: "calcular", evaluate_claim: "valorar una afirmación", justify: "justificar", propose: "proponer" };
const METHOD_ES: Record<string, string> = { selection_response: "respuesta por selección", guided_sequence: "secuencia guiada", segmented_reading: "lectura por partes", visual_organizer: "organizador visual", sentence_frames: "inicios de frase", manipulative_sorting: "clasificación manipulativa", worked_contrast: "contraste con ejemplo" };

export interface CompiledRecreation {
  student: MaterialDocument;
  guide: MaterialDocument;
  /** One row per activity: its printed label, the block it became and what it is traced to. */
  trace: Array<{ activity_id: string; label: string; block_id: string; objective_ids: string[]; operations: string[]; status: VerifiedActivity["status"] }>;
}

export function compileRecreation(plan: RecreationPlan, verification: Verification, analysis: MaterialAnalysis, presentation: Presentation): CompiledRecreation {
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
  return { student, guide: compileGuide(plan, verification, analysis, presentation, meta, trace), trace };
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

function solutionText(s: Solution, a: RecreationActivity): string {
  switch (s.kind) {
    case "pairs": {
      const e = a.executor.kind === "classify" ? a.executor : null;
      return s.pairs.map((p, i) => `${i + 1}-${LETTERS[e?.categories.findIndex((c) => c.label === p.category) ?? 0]} (${p.item}: ${p.category.toLowerCase()})`).join(", ");
    }
    case "order":
      return s.solution.map((x, i) => `${i + 1}. ${x}`).join(" → ");
    case "number":
      return `${s.operation} ${s.unit}`;
    case "options":
      return s.correct.join(" / ");
    case "truth":
      return s.values.map((v, i) => `${i + 1}: ${v.value ? "V" : "F"}`).join(", ");
    case "criteria":
      return `Criterios: ${s.criteria.join(" ")}`;
  }
}

function compileGuide(plan: RecreationPlan, verification: Verification, analysis: MaterialAnalysis, presentation: Presentation, meta: MaterialDocument["meta"], trace: CompiledRecreation["trace"]): MaterialDocument {
  let n = 0;
  const id = () => `blk_g${String(++n).padStart(4, "0")}`;
  const structure = { origin: "structure" as const, source_refs: [], decision_ids: [] };
  const objectiveText = new Map(analysis.pedagogical_intent.objectives.map((o) => [o.id, o.text]));
  const byId = new Map(plan.activities.map((a) => [a.id, a]));
  const strategies = new Map(plan.strategies.map((s) => [s.id, s]));
  const blocks: Block[] = [
    { id: id(), type: "heading", level: 1, text: `Guía docente: ${plan.title}`, trace: structure },
    { id: id(), type: "help_box", variant: "key_idea", title: "Solo para el profesorado", text: plan.guide.overview, trace: structure },
    { id: id(), type: "heading", level: 2, text: "Objetivos que se conservan", trace: structure },
    {
      id: id(),
      type: "table",
      headers: ["Objetivo del original", "Operaciones que se evalúan"],
      rows: plan.objectives.map((o) => [objectiveText.get(o.objective_id) ?? o.objective_id, o.operations.map((op) => OP_ES[op] ?? op).join(", ")]),
      trace: { origin: "structure", source_refs: plan.objectives.map((o) => o.objective_id), decision_ids: [] },
    },
    { id: id(), type: "heading", level: 2, text: "Actividades y soluciones", trace: structure },
  ];
  // One compact block per activity (a wide table of long solutions printed one word per line over nine pages).
  for (const row of trace) {
    const a = byId.get(row.activity_id)!;
    const solution = verification.activities.find((v) => v.id === row.activity_id)!;
    const observe = plan.guide.per_activity.find((g) => g.activity_id === row.activity_id)?.observe;
    const method = a.strategy_ids.map((s) => METHOD_ES[strategies.get(s)?.method ?? ""] ?? s).join(", ");
    blocks.push(
      { id: id(), type: "heading", level: 3, text: `Actividad ${row.label}`, trace: structure },
      {
        id: id(),
        type: "list",
        style: "bullet",
        items: [
          `Objetivo: ${row.objective_ids.map((o) => objectiveText.get(o) ?? o).join("; ")} (${row.operations.map((op) => OP_ES[op] ?? op).join(", ")}).`,
          ...(method ? [`Estrategia: ${method}.`] : []),
          `Solución: ${solutionText(solution.solution, a)}`.slice(0, 300),
          `Cómo se sabe: ${STATUS_ES[row.status]}.`,
          ...(observe ? [`Qué observar: ${observe}`] : []),
        ],
        trace: { origin: "structure", source_refs: row.objective_ids, decision_ids: [] },
      },
    );
  }
  const warnings = verification.issues.filter((i) => i.severity === "warning").map((i) => i.message);
  if (warnings.length > 0) blocks.push({ id: id(), type: "help_box", variant: "reminder", title: "Pendiente de revisar", text: warnings.join(" "), trace: structure });
  for (const m of plan.materials) {
    const label = trace.find((t) => t.activity_id === m.activity_id)?.label ?? "?";
    const rows: string[][] = [];
    for (let i = 0; i < m.cards.length; i += 3) rows.push([0, 1, 2].map((j) => m.cards[i + j] ?? ""));
    blocks.push(
      { id: id(), type: "heading", level: 2, text: `Tarjetas para recortar (actividad ${label})`, trace: structure },
      { id: id(), type: "paragraph", text: m.purpose, trace: structure },
      { id: id(), type: "table", headers: ["", "", ""], rows, trace: structure },
    );
  }
  // The guide is read by the teacher: the student's reading supports (larger type, wider spacing) do not apply; contrast does.
  const teacher: Presentation = { ...presentation, font_scale: 1, line_spacing: "normal", spacing: "normal", max_tasks_per_page: null, answer_space: "standard" };
  return MaterialDocumentSchema.parse({ schema_version: 1, meta: { ...meta, title: `Guía docente: ${meta.title}` }, presentation: teacher, admin_fields: [], pages: [{ blocks }], answer_key: [] });
}
