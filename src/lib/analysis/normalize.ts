import { computeCounts } from "@/lib/analysis/counts";
import { extractAdministrative, isPageNumberOnly, type AdminField } from "@/lib/analysis/admin-fields";
import { normalizeForComparison } from "@/lib/analysis/answers";
import {
  ID_PREFIXES,
  MATERIAL_ANALYSIS_SCHEMA_VERSION,
  MaterialAnalysisSchema,
  type MaterialAnalysis,
  type MaterialAnalysisDraft,
} from "@/lib/schemas/material-analysis";
import { matchSubjectSlug, type SubjectOption } from "./subjects";

export interface NormalizeOptions {
  /** Real number of pages (PDF) or 1 (image). Pages claimed by the model beyond it are clamped. */
  pageCount: number | null;
  subjects?: readonly SubjectOption[];
}

export interface NormalizeResult {
  analysis: MaterialAnalysis;
  /** Short machine-readable notes about what had to be repaired (counts, never content). */
  warnings: string[];
}

const empty = (value: string | undefined): string | null => (value === undefined || value.trim() === "" ? null : value.trim());
const KEY = (page: number, type: string, label: string) => `${type}|${page}|${normalizeForComparison(label)}`;

/**
 * Turns what the model produced into what we store (ADR-008). Everything that can be derived is derived HERE, so the
 * graph is consistent by construction:
 *
 * - persistent ids are assigned by position; the model's local ids only exist to link entities in its answer;
 * - every relation is written once by the model (activity → resources/objectives, protected → targets, uncertainty → targets,
 *   item → section) and the inverse sides are derived, so activity ↔ text and activity ↔ visual can never disagree;
 * - sections are inferred when the model omitted them and the answer is unambiguous;
 * - counts come from the final graph (`counts.ts`), never from the model;
 * - administrative lines and page numbers that slipped into text are moved out; an answer the model only inferred is never
 *   promoted to a protected element;
 * - ambiguous relations are dropped, not guessed, and each repair leaves a warning (a code and a count, never content).
 */
export function normalizeAnalysis(draft: MaterialAnalysisDraft, options: NormalizeOptions): NormalizeResult {
  const counters = new Map<string, number>();
  const bump = (key: string, n = 1) => counters.set(key, (counters.get(key) ?? 0) + n);

  const clampPage = (page: number): number => {
    if (options.pageCount !== null && page > options.pageCount) {
      bump("pages_clamped");
      return options.pageCount;
    }
    return page;
  };

  /** local id → stored id, first occurrence wins. */
  function idMap(items: ReadonlyArray<{ id: string }>, stored: readonly string[], label: string) {
    const map = new Map<string, string>();
    items.forEach((item, index) => {
      if (map.has(item.id)) bump(`duplicate_ids:${label}`);
      else map.set(item.id, stored[index]!);
    });
    return map;
  }
  const sequence = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}_${i + 1}`);

  const { identification: ident } = draft;
  const title = empty(ident.title);

  // --- administrative fields and texts ----------------------------------------------------------------------
  const admin: Array<AdminField & { page: number }> = [];
  const addAdmin = (field: AdminField, page: number) => {
    if (!admin.some((a) => KEY(a.page, a.type, a.label) === KEY(page, field.type, field.label))) admin.push({ ...field, page });
  };
  for (const field of draft.admin) {
    // Only the label: a value typed after the colon would be personal data.
    const label = field.label.split(":")[0]!.trim();
    if (label !== field.label.trim()) bump("admin_value_dropped");
    if (label !== "") addAdmin({ type: field.type, label }, clampPage(field.page));
  }

  const keptTexts: Array<{ local: string; draft: MaterialAnalysisDraft["texts"][number]; text: string }> = [];
  for (const t of draft.texts) {
    if (isPageNumberOnly(t.text)) {
      bump("page_number_dropped");
      continue;
    }
    const { rest, fields, valuesDropped } = extractAdministrative(t.text);
    for (const field of fields) {
      addAdmin(field, clampPage(t.page));
      bump("admin_fields_moved");
    }
    if (valuesDropped > 0) bump("admin_value_dropped", valuesDropped);
    if (rest === "") continue;
    if (title !== null && t.kind === "heading" && normalizeForComparison(rest) === normalizeForComparison(title)) {
      bump("title_text_dropped");
      continue;
    }
    keptTexts.push({ local: t.id, draft: t, text: rest });
  }

  const objectiveIds = sequence(ID_PREFIXES.objective, draft.intent.objectives.length);
  const sectionIds = sequence(ID_PREFIXES.section, draft.sections.length);
  const textIds = sequence(ID_PREFIXES.text, keptTexts.length);
  const visualIds = sequence(ID_PREFIXES.visual, draft.visuals.length);
  const activityIds = sequence(ID_PREFIXES.activity, draft.activities.length);

  const objectiveMap = idMap(draft.intent.objectives, objectiveIds, "objectives");
  const sectionMap = idMap(draft.sections, sectionIds, "sections");
  const textMap = idMap(
    keptTexts.map((t) => ({ id: t.local })),
    textIds,
    "texts",
  );
  const visualMap = idMap(draft.visuals, visualIds, "visuals");
  const activityMap = idMap(draft.activities, activityIds, "activities");

  /** Resolves a local id in the given namespaces; an id present in more than one is ambiguous and is dropped. */
  const lookup = (local: string, maps: ReadonlyArray<Map<string, string>>): string | null => {
    const hits = maps.flatMap((m) => (m.has(local) ? [m.get(local)!] : []));
    if (hits.length === 1) return hits[0]!;
    bump(hits.length === 0 ? "dropped_references" : "ambiguous_references");
    return null;
  };
  const refs = (locals: readonly string[], maps: ReadonlyArray<Map<string, string>>): string[] => {
    const out: string[] = [];
    for (const local of locals) {
      const id = lookup(local, maps);
      if (id !== null && !out.includes(id)) out.push(id);
    }
    return out;
  };

  const storedSections = draft.sections.map((s, i) => {
    const start = clampPage(s.page_start);
    return { id: sectionIds[i]!, title: empty(s.title), page_start: start, page_end: Math.max(start, clampPage(s.page_end)) };
  });
  /** The model's explicit choice if valid; otherwise inferred only when unambiguous (one section, or one covering the page). */
  const resolveSection = (local: string | undefined, page: number): string | null => {
    if (local !== undefined) {
      const mapped = sectionMap.get(local);
      if (mapped !== undefined) return mapped;
      bump("dropped_references");
    }
    if (storedSections.length === 0) return null;
    if (storedSections.length === 1) return storedSections[0]!.id;
    const covering = storedSections.filter((s) => s.page_start <= page && page <= s.page_end);
    if (covering.length === 1) return covering[0]!.id;
    bump("section_unassigned");
    return null;
  };

  // --- visuals ------------------------------------------------------------------------------------------------
  const autoUncertainties: Array<{ target: string; page: number }> = [];
  const storedVisuals = draft.visuals.map((v, i) => {
    const id = visualIds[i]!;
    const page = clampPage(v.page);
    let kind = v.kind;
    let role = v.role;
    let table = v.table ?? null;
    let chart = v.chart ?? null;

    if (table && table.headers.length === 0 && table.rows.length === 0) {
      table = null;
      bump("visual_data_dropped");
    }
    if (table && chart) {
      // One entity, one kind: keep the data that matches it.
      if (kind === "chart") table = null;
      else chart = null;
      bump("visual_data_dropped");
    }
    if (table && kind !== "table") {
      kind = "table";
      bump("visual_kind_adjusted");
    }
    if (chart && kind !== "chart") {
      kind = "chart";
      bump("visual_kind_adjusted");
    }
    if (chart && chart.series.some((s) => s.values.length !== chart!.categories.length)) {
      chart = null;
      bump("chart_data_dropped");
      autoUncertainties.push({ target: id, page });
    }
    if (kind === "decorative" && role !== "decorative") {
      role = "decorative";
      bump("visual_role_adjusted");
    }
    return {
      id,
      section_id: resolveSection(v.section, page),
      page,
      kind,
      role,
      title: empty(v.title),
      description: v.description.trim(),
      text: empty(v.text),
      table: table ? { headers: table.headers, rows: table.rows, unit: empty(table.unit) } : null,
      chart: chart ? { type: chart.type, categories: chart.categories, series: chart.series, x_label: empty(chart.x_label), y_label: empty(chart.y_label), unit: empty(chart.unit) } : null,
      activity_ids: [] as string[],
    };
  });

  const storedTexts = keptTexts.map((t, i) => {
    const page = clampPage(t.draft.page);
    return {
      id: textIds[i]!,
      section_id: resolveSection(t.draft.section, page),
      page,
      kind: t.draft.kind,
      text: t.text,
      activity_ids: [] as string[],
    };
  });

  // --- activities ---------------------------------------------------------------------------------------------
  const storedActivities = draft.activities.map((a, i) => {
    const page = clampPage(a.page);
    const instruction = a.instruction.trim();
    let context = empty(a.context);
    if (context !== null) {
      if (normalizeForComparison(context) === normalizeForComparison(instruction)) {
        context = null;
        bump("context_duplicates_instruction");
      } else if (context.includes(instruction)) {
        context = empty(context.replace(instruction, "").replace(/^[\s:;,\-–—]+|[\s:;,\-–—]+$/g, ""));
        bump("context_overlap_trimmed");
      }
    }

    const answerValue = empty(a.answer?.value);
    const expected_answer = a.answer && answerValue !== null ? { basis: a.answer.basis, value: answerValue } : { basis: "not_inferable" as const, value: null };

    const linesWanted = a.answer_lines !== undefined && a.answer_lines > 0;
    const linesFit = a.answer_area === "line" || a.answer_area === "lines";
    if (linesWanted && !linesFit) bump("answer_lines_ignored");

    return {
      id: activityIds[i]!,
      section_id: resolveSection(a.section, page),
      page,
      label: empty(a.label),
      type: a.type,
      instruction,
      context,
      resource_ids: refs(a.resources, [textMap, visualMap]),
      objective_ids: refs(a.objectives, [objectiveMap]),
      response_format: a.response,
      answer_area: { type: a.answer_area, lines: linesWanted && linesFit ? a.answer_lines! : null },
      expected_answer,
      difficulty: a.difficulty,
      confidence: a.confidence,
    };
  });

  // Derived inverse links: whichever side the model wrote, both sides now agree.
  for (const activity of storedActivities) {
    for (const resourceId of activity.resource_ids) {
      const resource = [...storedTexts, ...storedVisuals].find((r) => r.id === resourceId);
      resource?.activity_ids.push(activity.id);
    }
  }

  // --- protected elements --------------------------------------------------------------------------------------
  const inferredAnswers = new Set(storedActivities.flatMap((a) => (a.expected_answer.basis === "inferred" && a.expected_answer.value ? [normalizeForComparison(a.expected_answer.value)] : [])));
  const storedProtected: Array<{ type: (typeof draft.protected)[number]["type"]; importance: (typeof draft.protected)[number]["importance"]; value: string; activity_ids: string[]; resource_ids: string[] }> = [];
  for (const p of draft.protected) {
    const value = p.value.trim();
    if (inferredAnswers.has(normalizeForComparison(value))) {
      bump("protected_inferred_answer_dropped");
      continue;
    }
    const activity_ids = refs(p.activities, [activityMap]);
    const resource_ids = refs(p.resources, [textMap, visualMap]);
    if (p.type === "necessary_visual") {
      // A protected visual protects it for every activity that uses it.
      for (const activity of storedActivities) {
        if (activity.resource_ids.some((r) => resource_ids.includes(r)) && !activity_ids.includes(activity.id)) {
          activity_ids.push(activity.id);
          bump("protected_activities_completed");
        }
      }
    }
    const twin = storedProtected.find((s) => s.type === p.type && normalizeForComparison(s.value) === normalizeForComparison(value));
    if (twin) {
      for (const id of activity_ids) if (!twin.activity_ids.includes(id)) twin.activity_ids.push(id);
      for (const id of resource_ids) if (!twin.resource_ids.includes(id)) twin.resource_ids.push(id);
      bump("protected_duplicates_merged");
      continue;
    }
    storedProtected.push({ type: p.type, importance: p.importance, value, activity_ids, resource_ids });
  }

  // --- uncertainties -------------------------------------------------------------------------------------------
  const pageOf = new Map<string, number>([...storedActivities, ...storedTexts, ...storedVisuals].map((e) => [e.id, e.page]));
  const storedUncertainties = [
    ...draft.uncertainties.map((u) => {
      const target_ids = refs(u.targets, [activityMap, textMap, visualMap]);
      return { kind: u.kind as MaterialAnalysis["uncertainties"][number]["kind"], target_ids, note: u.note.trim(), confidence: u.confidence, page: target_ids.length > 0 ? (pageOf.get(target_ids[0]!) ?? null) : null };
    }),
    ...autoUncertainties.map((u) => ({ kind: "unstructured_data" as const, target_ids: [u.target], note: "Los datos del gráfico no se han podido estructurar con seguridad.", confidence: 0.5, page: u.page })),
  ];

  const candidate = {
    schema_version: MATERIAL_ANALYSIS_SCHEMA_VERSION,
    identification: {
      title,
      language: /^[a-z]{2}$/.test(ident.language.trim().toLowerCase()) ? ident.language.trim().toLowerCase() : null,
      stage: { value: ident.stage === "unknown" ? null : ident.stage, confidence: ident.confidence.stage },
      grade: { value: ident.grade === "unknown" ? null : ident.grade, confidence: ident.confidence.grade },
      subject: {
        value: empty(ident.subject),
        confidence: ident.confidence.subject,
        slug: empty(ident.subject) && options.subjects ? matchSubjectSlug(ident.subject.trim(), options.subjects) : null,
      },
      topic: { value: empty(ident.topic), confidence: ident.confidence.topic },
    },
    pedagogical_intent: {
      purpose: draft.intent.purpose,
      objectives: draft.intent.objectives.map((o, i) => ({ id: objectiveIds[i]!, text: o.text })),
      knowledge: draft.intent.knowledge,
      prerequisites: draft.intent.prerequisites,
      difficulty: draft.intent.difficulty,
    },
    structure: { page_count: options.pageCount, counts: computeCounts({ sections: storedSections, texts: storedTexts, visuals: storedVisuals, activities: storedActivities }) },
    sections: storedSections,
    texts: storedTexts,
    visuals: storedVisuals,
    administrative_fields: admin,
    activities: storedActivities,
    protected_elements: storedProtected.map((p, i) => ({ id: `${ID_PREFIXES.protected}_${i + 1}`, ...p })),
    uncertainties: storedUncertainties.map((u, i) => ({ id: `${ID_PREFIXES.uncertainty}_${i + 1}`, ...u })),
    quality: draft.quality,
  };

  const analysis = MaterialAnalysisSchema.parse(candidate);
  const warnings = [...counters.entries()].map(([key, count]) => `${key}:${count}`);
  return { analysis, warnings };
}
