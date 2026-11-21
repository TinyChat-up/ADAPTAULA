import { z } from "zod";
import {
  ACTIVITY_COMPREHENSION_VERSION,
  ActivityComprehensionDocumentSchema,
  type ActivityComprehension,
  type ActivityEvidence,
  type MaterialAnalysisV4Draft,
} from "@/lib/schemas/activity-comprehension";
import { MaterialAnalysisSchema, type AnalysisActivity, type MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { normalizeAnalysisWithReferences, type NormalizeOptions } from "./normalize";

const space = (value: string) => value.replace(/\s+/gu, " ").trim();

export function containsActivityQuote(source: string, quote: string): boolean {
  const literal = space(quote);
  if (!literal) return false;
  // Keep signs, accents and punctuation. A shorter number or word inside a longer one is not a citation.
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^\p{N}/u.test(literal) ? "(?<![\\p{L}\\p{N}+−-]|\\p{N}[.,/])" : "(?<![\\p{L}\\p{N}])";
  const right = /\p{N}$/u.test(literal) ? "(?![\\p{L}\\p{N}]|[.,/]\\p{N})" : "(?![\\p{L}\\p{N}])";
  return new RegExp(`${left}${escaped}${right}`, "u").test(space(source));
}

type EvidenceSource = { page: number; texts: readonly string[]; visual: boolean };

function activitySources(base: MaterialAnalysis, activity: AnalysisActivity) {
  const resources = new Set(activity.resource_ids);
  const texts = base.texts.filter((item) => resources.has(item.id));
  const visuals = base.visuals.filter((item) => resources.has(item.id) && item.role !== "decorative");
  const sources = new Map<string, EvidenceSource>([
    [activity.id, { page: activity.page, texts: [activity.instruction, activity.context ?? ""], visual: false }],
    ...texts.map((item) => [item.id, { page: item.page, texts: [item.text], visual: false }] as const),
    ...visuals.map((item) => [item.id, { page: item.page, texts: [item.text ?? ""], visual: true }] as const),
  ]);
  const linked = new Set([...texts, ...visuals].map((item) => item.id));
  return {
    sources,
    linked,
    incompleteVisuals: new Set(visuals.filter((item) => (item.kind === "chart" && !item.chart) || (item.kind === "table" && !item.table)).map((item) => item.id)),
    requiredVisuals: visuals.filter((item) => item.role === "required").map((item) => item.id),
    originalUncertainties: base.uncertainties.filter((item) => item.target_ids.length === 0 || item.target_ids.some((id) => id === activity.id || resources.has(id))).map((item) => item.id),
  };
}

function matchesEvidence(source: EvidenceSource, quote: string | null, allowVisualReference: boolean) {
  return quote === null ? allowVisualReference && source.visual : source.texts.some((text) => containsActivityQuote(text, quote));
}

function contradictsAccessRole(
  format: AnalysisActivity["response_format"],
  row: Pick<ActivityComprehension, "conditions" | "evaluation" | "operations">,
) {
  return row.conditions.some(({ kind }) => kind === "response_format" || kind === "response_length") ||
    row.evaluation.some(({ kind }) => kind === "written_production" || kind === "response_format") ||
    (format === "write_text" && row.operations.some(({ kind }) => kind === "compose"));
}

function validComprehension(base: MaterialAnalysis, rows: ActivityComprehension[]) {
  if (rows.length !== base.activities.length) return false;
  const objectives = new Map(base.pedagogical_intent.objectives.map((item) => [item.id, item.text]));
  return base.activities.every((activity, index) => {
    const row = rows[index]!;
    if (row.activity_id !== activity.id || row.response.format !== activity.response_format) return false;
    const { sources, linked, requiredVisuals, originalUncertainties } = activitySources(base, activity);
    const cited = (e: ActivityEvidence, allowVisualReference = false) => {
      const source = sources.get(e.source_ref);
      return source?.page === e.page && matchesEvidence(source, e.quote, allowVisualReference);
    };
    const formatRole = row.response.format_role;
    const pending = new Set(row.uncertainties.map(({ field }) => field));
    const missingRequiredVisual = requiredVisuals.some((id) => !row.essential_resources.some((item) => item.resource_ref === id));
    return (row.objectives.length > 0 || pending.has("objectives")) &&
      (row.operations.length > 0 || pending.has("operations")) &&
      (row.evaluation.length > 0 || pending.has("evaluation")) &&
      (formatRole !== null || pending.has("response_format_role")) &&
      (!missingRequiredVisual || pending.has("essential_resources")) &&
      row.objectives.every((item) => activity.objective_ids.includes(item.objective_ref) && cited(item.evidence) &&
        (item.basis === "interpreted" || containsActivityQuote(item.evidence.quote ?? "", objectives.get(item.objective_ref) ?? ""))) &&
      [...row.operations, ...row.student_decisions, ...row.evaluation, ...row.conditions].every((item) => cited(item.evidence)) &&
      row.information.every((item) => cited(item, true)) &&
      row.essential_resources.every((item) => linked.has(item.resource_ref) && cited(item.evidence, true)) &&
      (!formatRole || (cited(formatRole.evidence) && (formatRole.kind !== "access" || !contradictsAccessRole(activity.response_format, row)))) &&
      row.original_uncertainty_ids.length === originalUncertainties.length &&
      row.original_uncertainty_ids.every((id, i) => id === originalUncertainties[i]);
  });
}

export const MaterialAnalysisV4Schema = z.object({
  schema_version: z.literal(4),
  base: MaterialAnalysisSchema,
  comprehension: ActivityComprehensionDocumentSchema,
}).strict().superRefine((stored, ctx) => {
  if (!validComprehension(stored.base, stored.comprehension.activities)) {
    ctx.addIssue({ code: "custom", path: ["comprehension"], message: "Las actividades o sus evidencias no corresponden al análisis base." });
  }
  if (stored.base.activities.some((activity) => activity.expected_answer.basis !== "not_inferable")) {
    ctx.addIssue({ code: "custom", path: ["base", "activities"], message: "El análisis v4 no contiene soluciones." });
  }
});

type DraftEvidence = MaterialAnalysisV4Draft["activities"][number]["comprehension"]["information"][number];
type Pending = ActivityComprehension["uncertainties"][number];

export function normalizeActivityComprehension(draft: MaterialAnalysisV4Draft, options: NormalizeOptions) {
  const { analysis: base, warnings, textMap, visualMap, objectiveMap } = normalizeAnalysisWithReferences(draft, options);

  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const item of [...draft.activities, ...draft.texts, ...draft.visuals, ...draft.intent.objectives]) {
    if (seen.has(item.id)) ambiguous.add(item.id);
    seen.add(item.id);
  }

  let withheldEvidence = 0;
  const activities = base.activities.map((activity, index): ActivityComprehension => {
    const local = draft.activities[index]!;
    const input = local.comprehension;
    const { sources, linked, incompleteVisuals, requiredVisuals, originalUncertainties } = activitySources(base, activity);
    const pending = new Map<string, Pending>();
    const note = (field: Pending["field"], reason: Pending["reason"]) => pending.set(`${field}:${reason}`, { field, reason });
    const withhold = (field: Pending["field"]) => {
      note(field, "unverified_evidence");
      withheldEvidence += 1;
    };
    for (const issue of input.uncertainties) note(issue.field, issue.reason);

    const resourceId = (localId: string) => ambiguous.has(localId) ? undefined : textMap.get(localId) ?? visualMap.get(localId);
    const cite = (e: DraftEvidence, field: Pending["field"], allowVisualReference = false): ActivityEvidence | null => {
      const id = ambiguous.has(e.source_ref) ? undefined : e.source_ref === local.id ? activity.id : resourceId(e.source_ref);
      const source = id ? sources.get(id) : undefined;
      if (!id || !source || !matchesEvidence(source, e.quote, allowVisualReference)) {
        withhold(field);
        return null;
      }
      if (e.quote === null && incompleteVisuals.has(id)) note(field, "unavailable_resource_data");
      return { source_ref: id, page: source.page, quote: e.quote };
    };
    const keep = <K extends string>(items: Array<{ kind: K; evidence: DraftEvidence }>, field: Pending["field"]) => items.flatMap((item) => {
      const evidence = cite(item.evidence, field);
      return evidence ? [{ kind: item.kind, evidence }] : [];
    });

    const objectives = input.objectives.flatMap((item) => {
      const id = ambiguous.has(item.objective_ref) ? undefined : objectiveMap.get(item.objective_ref);
      if (!id || !activity.objective_ids.includes(id)) {
        withhold("objectives");
        return [];
      }
      const evidence = cite(item.evidence, "objectives");
      if (!evidence) return [];
      const text = base.pedagogical_intent.objectives.find((goal) => goal.id === id)!.text;
      if (item.basis === "explicit" && !containsActivityQuote(evidence.quote ?? "", text)) {
        withhold("objectives");
        return [];
      }
      return [{ objective_ref: id, basis: item.basis, evidence }];
    });
    const essentialResources = input.essential_resources.flatMap((item) => {
      const resource = resourceId(item.resource_ref);
      if (!resource || !linked.has(resource)) {
        withhold("essential_resources");
        return [];
      }
      if (incompleteVisuals.has(resource)) note("essential_resources", "unavailable_resource_data");
      const evidence = cite(item.evidence, "essential_resources", true);
      return evidence ? [{ resource_ref: resource, evidence }] : [];
    });
    const operations = keep(input.operations, "operations");
    const evaluation = keep(input.evaluation, "evaluation");
    const conditions = keep(input.conditions, "conditions");
    let formatRole: ActivityComprehension["response"]["format_role"] = null;
    if (input.response_format_role) {
      const evidence = cite(input.response_format_role.evidence, "response_format_role");
      if (evidence && input.response_format_role.kind === "access" && contradictsAccessRole(activity.response_format, { conditions, evaluation, operations })) {
        note("response_format_role", "ambiguous");
      } else if (evidence) {
        formatRole = { kind: input.response_format_role.kind, evidence };
      }
    }
    const studentDecisions = keep(input.student_decisions, "student_decisions");
    const information = input.information.flatMap((e) => cite(e, "information", true) ?? []);
    const unstated = (field: Pending["field"]) => {
      if (![...pending.values()].some((issue) => issue.field === field)) note(field, "not_stated");
    };
    if (objectives.length === 0) unstated("objectives");
    if (operations.length === 0) unstated("operations");
    if (evaluation.length === 0) unstated("evaluation");
    if (!formatRole) unstated("response_format_role");
    if (requiredVisuals.some((id) => !essentialResources.some((item) => item.resource_ref === id))) unstated("essential_resources");

    return {
      activity_id: activity.id, objectives, operations, student_decisions: studentDecisions, information,
      essential_resources: essentialResources, response: { format: activity.response_format, format_role: formatRole },
      evaluation, conditions, uncertainties: [...pending.values()], original_uncertainty_ids: originalUncertainties,
    };
  });

  return {
    stored: MaterialAnalysisV4Schema.parse({
      schema_version: 4,
      base,
      comprehension: { version: ACTIVITY_COMPREHENSION_VERSION, activities },
    }),
    warnings: withheldEvidence ? [...warnings, `comprehension_evidence_withheld:${withheldEvidence}`] : warnings,
  };
}
