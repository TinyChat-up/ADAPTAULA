import type { Presentation } from "@/lib/schemas/adaptation-context";
import { MaterialDocumentSchema, type Block, type MaterialDocument, type ResponseSpec } from "@/lib/schemas/material-document";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { VISUAL_SPEC_VERSION } from "@/lib/visuals/spec";
import type { RecreationActivity, RecreationPlan } from "./contract";
import type { ProvenanceRecord } from "./pilot";
import type { Solution, Verification, VerifiedActivity } from "./verify";
import type { ResolvedVisual } from "./visuals";

/**
 * A verified recreation plan → existing `MaterialDocument`s, printed by the one renderer we have:
 *   student  the new activities, the original's reading in parts, each picture right before the activity that uses it (an essential
 *            picture that could not be made is printed as a visible gap); the closed answers go to `answer_key`, which the student
 *            view never renders (ADR-008);
 *   cards    the manipulatives on their own sheet, large, with cutting lines (only when the plan has them);
 *   guide    for the teacher only, brief: the state of the review, how to apply the sheet and what to observe in each activity;
 *   key      for the teacher only, separate: the answer key with HOW each answer is known (verified, not verified, open), the
 *            equivalence review, the pictures and why each was made that way, and who produced and checked each resource.
 * Block ids are assigned here (`blk_r…`), deterministic for one plan, so the same plan prints the same sheet.
 */

const LETTERS = "ABCDEFGH";
const STATUS_ES: Record<VerifiedActivity["status"], string> = { verified: "Comprobada por el sistema", anchored: "SIN COMPROBAR: apoyada en el texto; revísela antes de corregir", teacher_review: "Abierta: valore con los criterios" };
const ROUTE_ES: Record<ResolvedVisual["route"], string> = { A_original: "imagen original reutilizada", B_code: "esquema exacto dibujado por el sistema", C_generated: "ilustración generada y revisada", none: "no incluida" };
const OP_ES: Record<string, string> = { identify: "identificar", locate_evidence: "localizar pruebas", classify: "clasificar", sequence: "ordenar", interpret_relation: "interpretar relaciones", predict: "predecir", calculate: "calcular", evaluate_claim: "valorar una afirmación", justify: "justificar", propose: "proponer" };
const METHOD_ES: Record<string, string> = { selection_response: "respuesta por selección", guided_sequence: "secuencia guiada", segmented_reading: "lectura por partes", visual_organizer: "organizador visual", sentence_frames: "inicios de frase", manipulative_sorting: "clasificación manipulativa", worked_contrast: "contraste con ejemplo" };

export interface CompiledRecreation {
  student: MaterialDocument;
  cards: MaterialDocument | null;
  /** Brief: how to apply the sheet, the state of the review and what to observe. */
  guide: MaterialDocument;
  /** Separate: the answer key with how each answer is known, the equivalence review, the pictures and the provenance. */
  key: MaterialDocument;
  /** One row per activity: its printed label, the block it became and what it is traced to. */
  trace: Array<{ activity_id: string; label: string; block_id: string; objective_ids: string[]; operations: string[]; status: VerifiedActivity["status"] }>;
}

export interface CompileInput {
  plan: RecreationPlan;
  verification: Verification;
  analysis: MaterialAnalysis;
  presentation: Presentation;
  visuals: readonly ResolvedVisual[];
  provenance: readonly ProvenanceRecord[];
}

export function compileRecreation({ plan, verification, analysis, presentation, visuals, provenance }: CompileInput): CompiledRecreation {
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
    // The pictures this activity is the first to use, right before it.
    for (const v of visuals.filter((x) => x.activity_ids[0] === a.id && x.source)) {
      const block = id();
      resources.push(block);
      const src = v.source!;
      const dec = decisions(a.strategy_ids)[0] ?? "dec_1";
      const source =
        src.kind === "original" ? { kind: "original" as const, visual_ref: src.visual_ref }
        : src.kind === "figure" ? { kind: "figure" as const, spec: src.spec, provenance: "reconstruction" as const, visual_ref: src.visual_ref }
        : src.kind === "generated" ? { kind: "generated" as const, asset_id: src.asset_id, sha256: src.sha256, decision_id: dec }
        : { kind: "requested" as const, decision_id: dec, purpose: src.purpose.slice(0, 300), style: "illustration" as const, essential: true };
      blocks.push({ id: block, type: "image", alt_text: v.alt.slice(0, 300), source, trace: { origin: "support", source_refs: a.objective_ids, decision_ids: decisions(a.strategy_ids) } });
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
  return { student, cards: compileCards(plan, presentation, meta, trace, decisionOf), guide: compileGuide({ plan, verification, analysis, presentation, visuals, provenance }, meta, trace), key: compileKey({ plan, verification, analysis, presentation, visuals, provenance }, meta, trace), trace };
}

/** The manipulatives on their own sheet: what to do with them and the cards themselves, large and with cutting lines. */
function compileCards(plan: RecreationPlan, presentation: Presentation, meta: MaterialDocument["meta"], trace: CompiledRecreation["trace"], decisionOf: ReadonlyMap<string, string>): MaterialDocument | null {
  if (plan.materials.length === 0) return null;
  let n = 0;
  const id = () => `blk_c${String(++n).padStart(4, "0")}`;
  const structure = { origin: "structure" as const, source_refs: [], decision_ids: [] };
  const blocks: Block[] = [{ id: id(), type: "heading", level: 1, text: "Tarjetas para recortar", trace: structure }];
  for (const m of plan.materials) {
    const label = trace.find((t) => t.activity_id === m.activity_id)?.label ?? "?";
    const activity = plan.activities.find((a) => a.id === m.activity_id);
    const dec = activity?.strategy_ids.map((s) => decisionOf.get(s)).find(Boolean) ?? "dec_1";
    blocks.push(
      { id: id(), type: "instruction", text: `Para la actividad ${label}. ${m.instructions}`, trace: { origin: "support", source_refs: activity?.objective_ids ?? [], decision_ids: [dec] } },
      { id: id(), type: "image", alt_text: `Tarjetas para recortar: ${m.cards.join(", ")}.`, source: { kind: "figure", spec: { kind: "cut_cards", spec_version: VISUAL_SPEC_VERSION, items: m.cards }, provenance: "generated", decision_id: dec }, trace: { origin: "support", source_refs: activity?.objective_ids ?? [], decision_ids: [dec] } },
    );
  }
  return MaterialDocumentSchema.parse({ schema_version: 1, meta: { ...meta, title: `Tarjetas: ${meta.title}` }, presentation: { ...presentation, max_tasks_per_page: null }, admin_fields: [], pages: [{ blocks }], answer_key: [] });
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

const teacherPresentation = (presentation: Presentation): Presentation => ({ ...presentation, font_scale: 1, line_spacing: "normal", spacing: "normal", max_tasks_per_page: null, answer_space: "standard" });

/** The brief guide: what the teacher needs to apply the sheet. The teacher's documents use standard type; contrast is kept. */
function compileGuide(input: CompileInput, meta: MaterialDocument["meta"], trace: CompiledRecreation["trace"]): MaterialDocument {
  const { plan, verification, presentation, visuals } = input;
  let n = 0;
  const id = () => `blk_g${String(++n).padStart(4, "0")}`;
  const structure = { origin: "structure" as const, source_refs: [], decision_ids: [] };
  const count = (status: VerifiedActivity["status"]) => verification.activities.filter((v) => v.status === status).length;
  const missing = visuals.filter((v) => v.route === "none" && v.essential);
  const blocks: Block[] = [
    { id: id(), type: "heading", level: 1, text: `Guía docente: ${plan.title}`, trace: structure },
    { id: id(), type: "help_box", variant: "key_idea", title: "Solo para el profesorado", text: plan.guide.overview, trace: structure },
    {
      id: id(),
      type: "help_box",
      variant: "reminder",
      title: "Antes de usarla",
      text: `${count("verified")} soluciones comprobadas por el sistema, ${count("anchored")} sin comprobar (apoyadas en el texto) y ${count("teacher_review")} abiertas: revise la clave aparte antes de corregir. La equivalencia del razonamiento con el original está pendiente de su revisión.${missing.length ? ` FALTA ${missing.length} imagen imprescindible: la ficha no está completa.` : ""}`,
      trace: structure,
    },
    { id: id(), type: "heading", level: 2, text: "Cómo aplicarla", trace: structure },
    { id: id(), type: "list", style: "numbered", items: plan.guide.application, trace: structure },
    { id: id(), type: "heading", level: 2, text: "Qué observar", trace: structure },
    { id: id(), type: "list", style: "bullet", items: plan.guide.per_activity.map((g) => `${trace.find((t) => t.activity_id === g.activity_id)?.label ?? "?"}. ${g.observe}`).slice(0, 20), trace: structure },
  ];
  return MaterialDocumentSchema.parse({ schema_version: 1, meta: { ...meta, title: `Guía docente: ${meta.title}` }, presentation: teacherPresentation(presentation), admin_fields: [], pages: [{ blocks }], answer_key: [] });
}

/** The answer key and the review, apart from the guide. */
function compileKey(input: CompileInput, meta: MaterialDocument["meta"], trace: CompiledRecreation["trace"]): MaterialDocument {
  const { plan, verification, analysis, presentation, visuals, provenance } = input;
  let n = 0;
  const id = () => `blk_k${String(++n).padStart(4, "0")}`;
  const structure = { origin: "structure" as const, source_refs: [], decision_ids: [] };
  const objectiveText = new Map(analysis.pedagogical_intent.objectives.map((o) => [o.id, o.text]));
  const byId = new Map(plan.activities.map((a) => [a.id, a]));
  const strategies = new Map(plan.strategies.map((s) => [s.id, s]));
  const blocks: Block[] = [{ id: id(), type: "heading", level: 1, text: `Clave de respuestas: ${plan.title}`, trace: structure }];
  for (const row of trace) {
    const a = byId.get(row.activity_id)!;
    const solution = verification.activities.find((v) => v.id === row.activity_id)!;
    const method = a.strategy_ids.map((s) => METHOD_ES[strategies.get(s)?.method ?? ""] ?? s).join(", ");
    blocks.push(
      { id: id(), type: "heading", level: 3, text: `Actividad ${row.label}`, trace: structure },
      {
        id: id(),
        type: "list",
        style: "bullet",
        items: [
          `Solución: ${solutionText(solution.solution, a)}`.slice(0, 300),
          `Cómo se sabe: ${STATUS_ES[row.status]}.`,
          `Objetivo: ${row.objective_ids.map((o) => objectiveText.get(o) ?? o).join("; ")} (${row.operations.map((op) => OP_ES[op] ?? op).join(", ")})${method ? `. Estrategia: ${method}` : ""}.`.slice(0, 300),
        ],
        trace: { origin: "structure", source_refs: row.objective_ids, decision_ids: [] },
      },
    );
  }
  const warnings = verification.issues.filter((i) => i.severity === "warning").map((i) => i.message);
  if (warnings.length > 0) blocks.push({ id: id(), type: "help_box", variant: "reminder", title: "Avisos de la verificación", text: warnings.join(" ").slice(0, 2900), trace: structure });
  const pending = verification.equivalence.find((e) => e.checks.some((c) => c.code === "reasoning"))?.checks.find((c) => c.code === "reasoning")?.note;
  blocks.push(
    { id: id(), type: "heading", level: 2, text: "Equivalencia con el original", trace: structure },
    {
      id: id(),
      type: "table",
      headers: ["Objetivo", "Comprobado por el sistema"],
      rows: verification.equivalence.map((e) => [
        objectiveText.get(e.objective_id) ?? e.objective_id,
        (e.checks.filter((c) => c.status === "passed").map((c) => c.note).join(" ") || "Solo la conservación de sus operaciones.").slice(0, 300),
      ]),
      trace: structure,
    },
    ...(pending ? [{ id: id(), type: "help_box" as const, variant: "reminder" as const, title: "Pendiente en todos los objetivos", text: pending, trace: structure }] : []),
  );
  if (visuals.length > 0) {
    blocks.push(
      { id: id(), type: "heading", level: 2, text: "Imágenes", trace: structure },
      { id: id(), type: "list", style: "bullet", items: visuals.map((v) => `${v.request_id} (actividad ${trace.find((t) => t.activity_id === v.activity_ids[0])?.label ?? "?"}): ${ROUTE_ES[v.route]}${v.route === "none" && v.essential ? " — FALTA, IMPRESCINDIBLE" : ""}. ${v.attempts.join(" · ")}`.slice(0, 300)), trace: structure },
    );
  }
  blocks.push(
    { id: id(), type: "heading", level: 2, text: "Procedencia", trace: structure },
    { id: id(), type: "table", headers: ["Recurso", "Lo produjo · lo comprobó", "Estado"], rows: provenance.map((p) => [p.resource, `${p.produced_by} · ${p.checked_by}`.slice(0, 300), p.status]), trace: structure },
  );
  return MaterialDocumentSchema.parse({ schema_version: 1, meta: { ...meta, title: `Clave: ${meta.title}` }, presentation: teacherPresentation(presentation), admin_fields: [], pages: [{ blocks }], answer_key: [] });
}
