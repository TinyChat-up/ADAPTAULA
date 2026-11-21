import { assessSupports } from "@/lib/adaptation/assessment-safety";
import { ZodError } from "zod";
import { buildDocument, responseForDecision, sequentialIds } from "@/lib/adaptation/document";
import { containsActivityQuote } from "@/lib/analysis/activity-comprehension";
import { studentText } from "@/lib/adaptation/document-text";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import { allBlocks, MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { DirectorActivity } from "@/lib/schemas/pedagogical-direction";
import type { DirectedPlan } from "./directed-plan";
import { checkResource, type DirectedIssue } from "./directed-checks";
import { emphasise, explicitRequirements, extendedWriting, finalChecklist, withoutAddedEmphasis, workspaceLines } from "./directed-supports";
import type { CompiledRecreation } from "./compile";

type ActivityBlock = Extract<Block, { type: "activity" }>;
const isActivity = (b: Block): b is ActivityBlock => b.type === "activity";
const compact = (value: string) => value.replace(/\s+/gu, " ").trim();

/**
 * `emphasised`: the requirements Adaptaula put in bold (removed again, exactly, by the literal checks). `unfabricated`: a support the
 * director asked for that could not be made without adding information (declared, never claimed as applied).
 */
export type DirectedTrace = { original_id: string; result_id: string; block_id: string; obligations: string[]; emphasised: string[]; unfabricated: Array<"visual_navigation"> };
type Fabrication = { ok: true; document: MaterialDocument; trace: DirectedTrace[] } | { ok: false; issues: DirectedIssue[] };

export function fabricateDirectedDocument(input: {
  analysis: MaterialAnalysis;
  context: AdaptationContext;
  profile: FunctionalProfile;
  originalImages: ReadonlySet<string>;
  rows: readonly DirectorActivity[];
  links: DirectedPlan["links"];
  replacements: CompiledRecreation | null;
}): Fabrication {
  const { analysis, context, rows } = input;
  const issue = (code: string, original_id?: string): Fabrication => ({ ok: false, issues: [{ code, ...(original_id ? { original_id } : {}) }] });
  const allPresentation = rows.every((row) => row.changes.some(({ kind }) => kind === "change_presentation"));
  if (!allPresentation && rows.some((row) => row.changes.some(({ kind }) => kind === "change_presentation"))) {
    return issue("per_activity_presentation_unavailable");
  }
  const supports = allPresentation ? Object.fromEntries(rows[0]!.changes.flatMap((change) =>
    change.kind === "change_presentation" && rows.every((row) => row.changes.some((item) => item.kind === "change_presentation" && item.need === change.need))
      ? [[change.need, input.profile.supports[change.need]]] : [])) : {};
  if (allPresentation && Object.keys(supports).length === 0) return issue("per_activity_presentation_unavailable");
  const baseContext = buildAdaptationContext({ profile: { ...emptyFunctionalProfile(), supports }, analysis,
    education: context.education, adaptationType: context.adaptation_type }).context;
  const presentation = { ...baseContext.presentation, decoration: "standard" as const };
  const newBlockId = sequentialIds("d");
  let baseline: MaterialDocument;
  try {
    baseline = buildDocument({
      analysis, context: { ...baseContext, presentation }, newBlockId, generated: null, preserveResponseLayout: true,
      plan: {
        schema_version: 1, analysis: { schema_version: 3, fingerprint: fingerprint(analysis) },
        context_fingerprint: fingerprint(baseContext), adaptation_type: context.adaptation_type, decisions: [], summary: [],
      },
    });
  } catch (error) {
    if (error instanceof ZodError) return issue("original_document_contract_invalid");
    throw error;
  }
  const replacementBlocks = input.replacements ? allBlocks(input.replacements.student).filter(isActivity) : [];
  const replacements = new Map(input.replacements?.trace.map((row) => [row.activity_id, replacementBlocks.find(({ id }) => id === row.block_id)]));
  const directed = new Map(rows.map((row) => [row.activity_id, row]));
  const trace: DirectedTrace[] = [];
  const pages: MaterialDocument["pages"] = [];
  for (const page of baseline.pages) {
    const pageBlocks: Block[] = [];
    for (const block of page.blocks) {
      if (!isActivity(block)) { pageBlocks.push(block); continue; }
      const original_id = block.trace.source_refs[0]!;
      const original = analysis.activities.find(({ id }) => id === original_id)!;
      const row = directed.get(original_id)!;
      const result_id = input.links.find((link) => link.original_id === original_id)?.result_id ?? original_id;
      const changes = new Set(row.changes.map(({ kind }) => kind));
      const replacement = replacements.get(result_id);
      if (changes.has("replacement") && !replacement) return issue("compiled_activity_missing", original_id);
      let activity: ActivityBlock = replacement
        ? { ...block, prompt: replacement.prompt, response: replacement.response, trace: { ...block.trace, origin: "adapted" } }
        : { ...block };
      if (changes.has("segment_instruction")) {
        if (!activity.prompt.startsWith(original.instruction)) return issue("literal_segmentation_unavailable", original_id);
        activity.prompt = original.instruction.split(/(?<=[.!?])\s+(?=\S)/u).join("\n\n") + activity.prompt.slice(original.instruction.length);
      }
      // Requirements of how to answer, emphasised where the prompt already states them (never data: see directed-supports.ts).
      const requirements = changes.has("segment_instruction") || changes.has("visual_navigation") ? explicitRequirements(activity.prompt, row, original) : [];
      if (requirements.length > 0) activity.prompt = emphasise(activity.prompt, requirements);
      const extended = extendedWriting(row);
      if (changes.has("blank_workspace")) {
        const response = activity.response;
        if (response.kind === "lines" && response.lines <= 38) activity.response = { ...response, lines: workspaceLines(response.lines, extended) };
        else if (response.kind === "grid") {
          const rows = "rows" in response ? response.rows : undefined;
          if (rows === undefined || rows > 58) return issue("unlabelled_workspace_unavailable", original_id);
          activity.response = { ...response, rows: rows + 2 };
        }
        else return issue("unlabelled_workspace_unavailable", original_id);
      }
      if (changes.has("oral_response")) activity.response = responseForDecision(original, "oral_or_alternative");
      if (!replacement && compact(withoutAddedEmphasis(activity.prompt, requirements)) !== compact(block.prompt)) return issue("source_text_changed", original_id);
      // Navigation is made by the emphasised requirements (and their final check). Without any, nothing safe is left to print:
      // the support is declared as not fabricated rather than replaced by a generic box.
      const unfabricated: DirectedTrace["unfabricated"] = changes.has("visual_navigation") && requirements.length === 0 ? ["visual_navigation"] : [];
      if (changes.size > unfabricated.length) activity = { ...activity, trace: { ...activity.trace, origin: "adapted" } };
      pageBlocks.push(activity);
      // The navigation support is the activity's own requirements to check before handing it in, or nothing: never a generic box.
      const checklist = changes.has("visual_navigation") ? finalChecklist(requirements, extended) : null;
      if (checklist) {
        pageBlocks.push({ id: newBlockId(), type: "checklist", title: "Antes de entregar, comprueba", items: checklist,
          trace: { origin: "support", source_refs: [original_id], decision_ids: [] } });
      }
      trace.push({ original_id, result_id, block_id: activity.id, obligations: row.retains, emphasised: requirements, unfabricated });
    }
    pages.push({ blocks: pageBlocks });
  }
  const doc = MaterialDocumentSchema.safeParse({ ...baseline, pages });
  if (!doc.success) return issue("document_contract_invalid");
  const issues = reviewDirectedDocument(doc.data, trace, rows, input.originalImages, baseline, replacements);
  for (const finding of assessSupports(analysis, doc.data).findings) {
    if (finding.action === "block" || finding.literal) issues.push({ code: finding.code, original_id: finding.activity_id, ref: finding.block_id });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, document: doc.data, trace };
}

// This gate tests the manufactured links, including resource identity, after assembly and before rendering.
function reviewDirectedDocument(
  document: MaterialDocument,
  trace: readonly DirectedTrace[],
  rows: readonly DirectorActivity[],
  images: ReadonlySet<string>,
  baseline: MaterialDocument,
  replacements: ReadonlyMap<string, ActivityBlock | undefined>,
): DirectedIssue[] {
  const blocks = new Map(allBlocks(document).map((block) => [block.id, block]));
  const issues: DirectedIssue[] = [];
  const originalBlocks = new Map(allBlocks(baseline).map((block) => [block.id, block]));
  const act = [...blocks.values()].filter(isActivity);
  if (trace.length !== rows.length || act.length !== rows.length || new Set(trace.map(({ block_id }) => block_id)).size !== rows.length ||
      new Set(trace.map(({ result_id }) => result_id)).size !== rows.length) issues.push({ code: "fabricated_links_invalid" });
  for (const row of rows) {
    const original_id = row.activity_id;
    const matching = trace.filter((item) => item.original_id === original_id);
    const link = matching[0];
    const block = link ? blocks.get(link.block_id) : undefined;
    if (matching.length !== 1 || block?.type !== "activity" || !block.trace.source_refs.includes(original_id)) {
      issues.push({ code: "fabricated_activity_missing", original_id });
      continue;
    }
    const literal = originalBlocks.get(block.id);
    const replacement = link && replacements.get(link.result_id);
    const expected = replacement || (literal?.type === "activity" ? literal : undefined);
    if (!expected || compact(expected.prompt) !== compact(withoutAddedEmphasis(block.prompt, link?.emphasised ?? []))) issues.push({ code: "fabricated_prompt_changed", original_id });
    const changes = new Set(row.changes.map(({ kind }) => kind));
    if (expected && !changes.has("blank_workspace") && !changes.has("oral_response") &&
        fingerprint(expected.response) !== fingerprint(block.response)) issues.push({ code: "fabricated_response_changed", original_id });
    if (changes.has("oral_response") && (block.response.kind !== "oral_or_alternative" || block.response.mode !== "oral")) {
      issues.push({ code: "fabricated_response_changed", original_id });
    }
    const linkedResources = (block.resource_block_ids ?? []).flatMap((id) => blocks.get(id) ?? []);
    // Only the marks Adaptaula added to this activity are removed; the original's own bold, here and in its resources, stays.
    const own = { ...block, prompt: withoutAddedEmphasis(block.prompt, link?.emphasised ?? []) };
    const visible = [own, ...linkedResources.filter((item) => item.type !== "image")].map(studentText);
    for (const { kind, evidence, ref } of row.obligations) {
      if ((kind === "condition" || kind === "information") && evidence?.source_ref === original_id && evidence.quote &&
          !visible.some((text) => containsActivityQuote(text, evidence.quote!))) {
        issues.push({ code: "fabricated_condition_or_data_missing", original_id, ref });
      }
    }
    for (const obligation of row.obligations.filter(({ kind }) => kind === "resource")) {
      const ref = obligation.value!;
      const resource = linkedResources.find((item) => item.trace.source_refs.includes(ref));
      const error = checkResource(original_id, resource, ref, images);
      if (error) issues.push(error);
      else if (resource && fingerprint(resource) !== fingerprint(originalBlocks.get(resource.id))) {
        issues.push({ code: "fabricated_resource_changed", original_id, ref });
      }
    }
  }
  return issues;
}
