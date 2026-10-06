import {
  ID_PREFIXES,
  MATERIAL_ANALYSIS_SCHEMA_VERSION,
  MaterialAnalysisSchema,
  type MaterialAnalysisV2,
  type MaterialAnalysisDraft,
} from "@/lib/schemas/material-analysis-v2";
import { matchSubjectSlug, type SubjectOption } from "./subjects";

export interface NormalizeOptionsV2 {
  /** Real number of pages (PDF) or 1 (image). Pages claimed by the model beyond it are clamped. */
  pageCount: number | null;
  subjects?: readonly SubjectOption[];
}

export interface NormalizeResultV2 {
  analysis: MaterialAnalysisV2;
  /** Short machine-readable notes about what had to be repaired (counts, never content). */
  warnings: string[];
}

const empty = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * Turns what the model produced into what we store (ADR-008): the server assigns stable ids,
 * dangling references are dropped, sentinels become null and derived data is computed here
 * instead of trusting the model's arithmetic. The model never controls persistent ids.
 */
export function normalizeAnalysisV2(draft: MaterialAnalysisDraft, options: NormalizeOptionsV2): NormalizeResultV2 {
  const counters = new Map<string, number>();
  const bump = (key: string, n = 1) => counters.set(key, (counters.get(key) ?? 0) + n);

  function assignIds<T extends { id: string }>(items: readonly T[], prefix: string, label: string) {
    const map = new Map<string, string>();
    const ids = items.map((item, index) => {
      const id = `${prefix}_${index + 1}`;
      if (map.has(item.id)) bump(`duplicate_ids:${label}`);
      else map.set(item.id, id);
      return id;
    });
    return { map, ids };
  }

  const refs = (values: readonly string[], map: Map<string, string>): string[] => {
    const out: string[] = [];
    for (const value of values) {
      const mapped = map.get(value);
      if (mapped === undefined) bump("dropped_references");
      else if (!out.includes(mapped)) out.push(mapped);
    }
    return out;
  };
  const ref = (value: string, map: Map<string, string>): string | null => {
    if (value.trim() === "") return null;
    const mapped = map.get(value);
    if (mapped === undefined) bump("dropped_references");
    return mapped ?? null;
  };
  const clampPage = (page: number): number => {
    if (options.pageCount !== null && page > options.pageCount) {
      bump("pages_clamped");
      return options.pageCount;
    }
    return page;
  };

  const objectives = assignIds(draft.pedagogical_intent.learning_objectives, ID_PREFIXES.objective, "objectives");
  const sections = assignIds(draft.sections, ID_PREFIXES.section, "sections");
  const activities = assignIds(draft.activities, ID_PREFIXES.activity, "activities");
  const visuals = assignIds(draft.visual_elements, ID_PREFIXES.visual, "visuals");
  const contents = assignIds(draft.contents, ID_PREFIXES.content, "contents");
  const protectedElements = assignIds(draft.protected_elements, ID_PREFIXES.protected, "protected");
  const uncertainties = assignIds(draft.uncertainties, ID_PREFIXES.uncertainty, "uncertainties");

  const { identification: ident } = draft;
  const subjectText = empty(ident.subject.value);

  const storedVisuals = draft.visual_elements.map((v, i) => {
    let fn = v.pedagogical_function;
    let necessary = v.necessary_to_solve;
    if (necessary && fn !== "required_for_task") {
      fn = "required_for_task";
      bump("visual_function_adjusted");
    } else if (!necessary && fn === "required_for_task") {
      necessary = true;
      bump("visual_function_adjusted");
    }
    return {
      id: visuals.ids[i]!,
      page: clampPage(v.page),
      kind: v.kind,
      description: v.description,
      pedagogical_function: fn,
      necessary_to_solve: necessary,
      activity_ids: refs(v.activity_ids, activities.map),
      text_in_image: empty(v.text_in_image),
      confidence: v.confidence,
    };
  });

  const storedContents = draft.contents.map((c, i) => ({
    id: contents.ids[i]!,
    section_id: ref(c.section_id, sections.map),
    page: clampPage(c.page),
    kind: c.kind,
    text: c.text,
    table: c.kind === "table" && c.table_headers.length > 0 ? { headers: c.table_headers, rows: c.table_rows } : null,
    legible: c.legible,
  }));

  const storedActivities = draft.activities.map((a, i) => {
    const value = empty(a.expected_answer.value);
    const basis = value === null ? ("not_inferable" as const) : a.expected_answer.basis === "not_inferable" ? ("inferred" as const) : a.expected_answer.basis;
    if (value === null && a.expected_answer.basis !== "not_inferable") bump("answer_basis_adjusted");
    return {
      id: activities.ids[i]!,
      section_id: ref(a.section_id, sections.map),
      page: clampPage(a.page),
      label: empty(a.label),
      type: a.type,
      instruction: a.instruction,
      content: a.content,
      response_format: a.response_format,
      has_answer_space: a.has_answer_space,
      // A stated "not inferable" answer never carries a value, whatever the model wrote.
      expected_answer: { value: a.expected_answer.basis === "not_inferable" ? null : value, basis, confidence: a.expected_answer.confidence },
      difficulty: a.difficulty,
      knowledge_required: a.knowledge_required,
      objective_ids: refs(a.objective_ids, objectives.map),
      visual_ids: refs(a.visual_ids, visuals.map),
      confidence: a.confidence,
    };
  });

  const candidate = {
    schema_version: MATERIAL_ANALYSIS_SCHEMA_VERSION,
    identification: {
      title: { value: empty(ident.title.value), confidence: ident.title.confidence },
      stage: { value: ident.stage.value === "unknown" ? null : ident.stage.value, confidence: ident.stage.confidence },
      grade: { value: ident.grade.value === "unknown" ? null : ident.grade.value, confidence: ident.grade.confidence },
      subject: {
        value: subjectText,
        confidence: ident.subject.confidence,
        slug: subjectText && options.subjects ? matchSubjectSlug(subjectText, options.subjects) : null,
      },
      topic: { value: empty(ident.topic.value), confidence: ident.topic.confidence },
      language: { value: /^[a-z]{2}$/.test(ident.language.value.trim().toLowerCase()) ? ident.language.value.trim().toLowerCase() : null, confidence: ident.language.confidence },
    },
    pedagogical_intent: {
      ...draft.pedagogical_intent,
      learning_objectives: draft.pedagogical_intent.learning_objectives.map((o, i) => ({ id: objectives.ids[i]!, text: o.text, confidence: o.confidence })),
    },
    structure: {
      page_count: options.pageCount,
      counts: {
        sections: draft.sections.length,
        activities: storedActivities.length,
        examples: storedContents.filter((c) => c.kind === "example").length,
        reading_texts: storedContents.filter((c) => c.kind === "reading_text").length,
        tables: storedContents.filter((c) => c.kind === "table").length + storedVisuals.filter((v) => v.kind === "table_image").length,
        formulas: storedContents.filter((c) => c.kind === "formula").length,
        figures: storedVisuals.filter((v) => v.pedagogical_function !== "decorative").length,
        answer_spaces: storedActivities.filter((a) => a.has_answer_space).length,
      },
    },
    sections: draft.sections.map((s, i) => {
      const start = clampPage(s.page_start);
      return { id: sections.ids[i]!, title: empty(s.title), page_start: start, page_end: Math.max(start, clampPage(s.page_end)), summary: s.summary };
    }),
    contents: storedContents,
    activities: storedActivities,
    visual_elements: storedVisuals,
    protected_elements: draft.protected_elements.map((p, i) => ({
      id: protectedElements.ids[i]!,
      kind: p.kind,
      description: p.description,
      rationale: p.rationale,
      activity_ids: refs(p.activity_ids, activities.map),
      visual_ids: refs(p.visual_ids, visuals.map),
      importance: p.importance,
    })),
    uncertainties: draft.uncertainties.map((u, i) => ({
      id: uncertainties.ids[i]!,
      kind: u.kind,
      page: u.page === 0 ? null : clampPage(u.page),
      description: u.description,
      activity_ids: refs(u.activity_ids, activities.map),
      confidence: u.confidence,
    })),
    quality: draft.quality,
  };

  const analysis = MaterialAnalysisSchema.parse(candidate);
  const warnings = [...counters.entries()].map(([key, count]) => (key.includes(":") ? `${key}:${count}` : `${key}:${count}`));
  return { analysis, warnings };
}
