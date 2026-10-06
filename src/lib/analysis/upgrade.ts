import { extractAdministrative, isPageNumberOnly, type AdminField } from "@/lib/analysis/admin-fields";
import { normalizeForComparison } from "@/lib/analysis/answers";
import { computeCounts } from "@/lib/analysis/counts";
import type { MaterialAnalysisV2 } from "@/lib/schemas/material-analysis-v2";
import { MATERIAL_ANALYSIS_SCHEMA_VERSION, MaterialAnalysisSchema, type MaterialAnalysis } from "@/lib/schemas/material-analysis";

/** A v2 title below this confidence was never applied to a material (see `detectedContextUpdate`); it is not carried over either. */
const TITLE_CONFIDENCE = 0.6;

const TEXT_KIND = { heading: "heading", general_instruction: "instruction", reading_text: "reading_text", example: "example", definition: "definition", formula: "formula", note: "note", other: "other" } as const;
const VISUAL_KIND = {
  photo: "image", illustration: "image", diagram: "diagram", chart_or_graph: "chart", map: "map", table_image: "table", scheme: "diagram",
  icon: "image", decorative_border: "decorative", logo: "image", other: "other",
} as const;
const VISUAL_ROLE = { required_for_task: "required", informative: "informative", illustrative: "illustrative", decorative: "decorative" } as const;
const PROTECTED_TYPE = {
  scientific_vocabulary: "required_vocabulary", target_operation: "target_operation", concept: "concept", grammar_structure: "concept",
  necessary_figure: "necessary_visual", inference_question: "reasoning_constraint", units_or_magnitudes: "units_or_magnitudes", formula: "formula", other: "other",
} as const;

export interface UpgradeResult {
  analysis: MaterialAnalysis;
  warnings: string[];
}

/**
 * Lifts a stored v2 analysis (written by `material_analyzer@v1`) to the current v3 shape IN MEMORY. Nothing is rewritten in
 * the database and nothing is re-analyzed. What v2 got wrong is repaired deterministically where that is unambiguous:
 * a table that existed twice (as content and as `table_image`) becomes one entity, asymmetric activity ↔ visual links are
 * completed, administrative lines and page numbers leave the text, `content` that repeated `instruction` disappears and the
 * counts are recomputed from the resulting graph. Fields v3 no longer carries (rationales, per-activity knowledge, complexity…)
 * are simply not shown for old analyses. Throws if the result is not a valid v3 analysis.
 */
export function upgradeAnalysisV2(v2: MaterialAnalysisV2): UpgradeResult {
  const counters = new Map<string, number>();
  const bump = (key: string, n = 1) => counters.set(key, (counters.get(key) ?? 0) + n);
  const title = v2.identification.title.value !== null && v2.identification.title.confidence >= TITLE_CONFIDENCE ? v2.identification.title.value : null;

  // --- sections / objectives --------------------------------------------------------------------------------
  const sections = v2.sections.map((s) => ({ id: s.id, title: s.title, page_start: s.page_start, page_end: s.page_end }));
  /** Section of an item that v2 did not link to one: only when exactly one section can contain its page. */
  const sectionOfPage = (page: number): string | null => {
    const covering = sections.filter((s) => s.page_start <= page && page <= s.page_end);
    return covering.length === 1 ? covering[0]!.id : null;
  };

  // --- texts (tables become visuals) --------------------------------------------------------------------------
  const admin: Array<AdminField & { page: number }> = [];
  const textMap = new Map<string, string>();
  const texts: MaterialAnalysis["texts"] = [];
  for (const c of v2.contents) {
    if (c.kind === "table") continue;
    if (isPageNumberOnly(c.text)) {
      bump("page_number_dropped");
      continue;
    }
    const { rest, fields, valuesDropped } = extractAdministrative(c.text);
    if (valuesDropped > 0) bump("admin_value_dropped", valuesDropped);
    for (const field of fields) {
      if (!admin.some((a) => a.page === c.page && a.type === field.type && normalizeForComparison(a.label) === normalizeForComparison(field.label))) admin.push({ ...field, page: c.page });
      bump("admin_fields_moved");
    }
    if (rest === "") continue;
    if (title !== null && c.kind === "heading" && normalizeForComparison(rest) === normalizeForComparison(title)) {
      bump("title_text_dropped");
      continue;
    }
    const id = `ctt_${texts.length + 1}`;
    textMap.set(c.id, id);
    texts.push({ id, section_id: c.section_id, page: c.page, kind: TEXT_KIND[c.kind], text: rest, activity_ids: [] });
  }

  // --- visuals, merging a table that v2 stored twice ---------------------------------------------------------
  const tableContents = v2.contents.filter((c) => c.kind === "table" && c.table !== null);
  const tableImages = v2.visual_elements.filter((v) => v.kind === "table_image");
  const mergedContent = new Set<string>();
  const mergedWith = new Map<string, (typeof tableContents)[number]>();
  for (const page of new Set(tableImages.map((v) => v.page))) {
    const images = tableImages.filter((v) => v.page === page);
    const contents = tableContents.filter((c) => c.page === page);
    if (images.length === 1 && contents.length === 1) {
      mergedWith.set(images[0]!.id, contents[0]!);
      mergedContent.add(contents[0]!.id);
      bump("table_merged");
    } else if (images.length > 0 && contents.length > 0) bump("table_duplicate_unresolved", images.length);
  }

  const visualMap = new Map<string, string>();
  const visuals: MaterialAnalysis["visuals"] = [];
  const pushVisual = (draft: Omit<MaterialAnalysis["visuals"][number], "id">, oldId?: string) => {
    const id = `vis_${visuals.length + 1}`;
    if (oldId) visualMap.set(oldId, id);
    visuals.push({ id, ...draft });
    return id;
  };
  for (const v of v2.visual_elements) {
    const content = mergedWith.get(v.id);
    const kind = VISUAL_KIND[v.kind];
    const role = kind === "decorative" ? "decorative" : VISUAL_ROLE[v.pedagogical_function];
    pushVisual(
      {
        section_id: sectionOfPage(v.page),
        page: v.page,
        kind: content ? "table" : kind,
        role,
        title: content ? content.text : null,
        description: v.description,
        text: content ? null : v.text_in_image,
        table: content?.table ? { headers: content.table.headers, rows: content.table.rows, unit: null } : null,
        chart: null,
        activity_ids: [],
      },
      v.id,
    );
  }
  for (const c of tableContents.filter((t) => !mergedContent.has(t.id))) {
    pushVisual({ section_id: c.section_id, page: c.page, kind: "table", role: "informative", title: c.text, description: "", text: null, table: { headers: c.table!.headers, rows: c.table!.rows, unit: null }, chart: null, activity_ids: [] });
  }

  // --- activities ---------------------------------------------------------------------------------------------
  const activityMap = new Map(v2.activities.map((a) => [a.id, a.id]));
  const objectiveMap = new Map(v2.pedagogical_intent.learning_objectives.map((o) => [o.id, o.id]));
  const activities: MaterialAnalysis["activities"] = v2.activities.map((a) => {
    const linkedBySelf = a.visual_ids.map((v) => visualMap.get(v)).filter((v): v is string => v !== undefined);
    const linkedByVisual = v2.visual_elements.filter((v) => v.activity_ids.includes(a.id)).map((v) => visualMap.get(v.id)!);
    const missing = linkedByVisual.filter((v) => !linkedBySelf.includes(v)).length + linkedBySelf.filter((v) => !linkedByVisual.includes(v)).length;
    if (missing > 0) bump("relation_completed", missing);
    const resource_ids = [...new Set([...linkedBySelf, ...linkedByVisual])];

    let context: string | null = a.content.trim() === "" ? null : a.content.trim();
    if (context !== null) {
      if (normalizeForComparison(context) === normalizeForComparison(a.instruction)) {
        context = null;
        bump("context_duplicates_instruction");
      } else if (context.includes(a.instruction)) {
        context = context.replace(a.instruction, "").replace(/^[\s:;,\-–—]+|[\s:;,\-–—]+$/g, "").trim() || null;
        bump("context_overlap_trimmed");
      }
    }
    const basis = a.expected_answer.basis === "stated_in_material" ? ("source" as const) : a.expected_answer.basis;
    return {
      id: a.id,
      section_id: a.section_id,
      page: a.page,
      label: a.label,
      type: a.type,
      instruction: a.instruction,
      context,
      resource_ids,
      objective_ids: a.objective_ids.filter((o) => objectiveMap.has(o)),
      response_format: a.response_format,
      // v2 only knew WHETHER there was space, not what kind: "unknown" says so honestly.
      answer_area: { type: a.has_answer_space ? ("unknown" as const) : ("none" as const), lines: null },
      expected_answer: basis === "not_inferable" || a.expected_answer.value === null ? { basis: "not_inferable" as const, value: null } : { basis, value: a.expected_answer.value },
      difficulty: a.difficulty,
      confidence: a.confidence,
    };
  });

  for (const activity of activities) {
    for (const resourceId of activity.resource_ids) [...texts, ...visuals].find((r) => r.id === resourceId)?.activity_ids.push(activity.id);
  }

  // --- protected elements and uncertainties --------------------------------------------------------------------
  const protectedElements: MaterialAnalysis["protected_elements"] = v2.protected_elements.map((p) => {
    const resource_ids = p.visual_ids.map((v) => visualMap.get(v)).filter((v): v is string => v !== undefined);
    const activity_ids = p.activity_ids.filter((a) => activityMap.has(a));
    const type = PROTECTED_TYPE[p.kind];
    if (type === "necessary_visual") {
      for (const activity of activities) {
        if (activity.resource_ids.some((r) => resource_ids.includes(r)) && !activity_ids.includes(activity.id)) {
          activity_ids.push(activity.id);
          bump("protected_activities_completed");
        }
      }
    }
    return { id: p.id, type, importance: p.importance, value: p.description, activity_ids, resource_ids };
  });

  const uncertainties: MaterialAnalysis["uncertainties"] = v2.uncertainties.map((u) => ({
    id: u.id,
    kind: u.kind,
    target_ids: u.activity_ids,
    note: u.description,
    confidence: u.confidence,
    page: u.page,
  }));

  const candidate: MaterialAnalysis = {
    schema_version: MATERIAL_ANALYSIS_SCHEMA_VERSION,
    identification: {
      title,
      language: v2.identification.language.value,
      stage: v2.identification.stage,
      grade: v2.identification.grade,
      subject: v2.identification.subject,
      topic: v2.identification.topic,
    },
    pedagogical_intent: {
      purpose: v2.pedagogical_intent.purpose,
      objectives: v2.pedagogical_intent.learning_objectives.map((o) => ({ id: o.id, text: o.text })),
      knowledge: v2.pedagogical_intent.knowledge_involved,
      prerequisites: v2.pedagogical_intent.prerequisites,
      difficulty: v2.pedagogical_intent.difficulty,
    },
    structure: { page_count: v2.structure.page_count, counts: computeCounts({ sections, texts, visuals, activities }) },
    sections,
    texts,
    visuals,
    administrative_fields: admin,
    activities,
    protected_elements: protectedElements,
    uncertainties,
    quality: { confidence: v2.quality.overall_confidence, readability: v2.quality.readability },
  };

  return { analysis: MaterialAnalysisSchema.parse(candidate), warnings: [...counters.entries()].map(([key, count]) => `${key}:${count}`) };
}
