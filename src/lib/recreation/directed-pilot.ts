import "server-only";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import type { StructuredRequest } from "@/lib/ai/types";
import { MaterialAnalysisV4Schema } from "@/lib/analysis/activity-comprehension";
import type { DirectorActivity } from "@/lib/schemas/pedagogical-direction";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { assetRef, verifyPinnedAsset, type PinnedAsset } from "@/lib/render/print/pinned-assets";
import type { AssetSource } from "@/lib/render/model";
import { directPedagogy, type DirectorInput } from "./director";
import { createDirectedRecreationPlanner } from "./planner";
import { recreationInput } from "./input";
import { checkReplacement, verifyDirectedLinks, type DirectedIssue } from "./directed-checks";
import { fabricateDirectedDocument } from "./directed-document";
import { verifyPlan } from "./verify";
import { compileRecreation } from "./compile";
import { auditFidelity } from "./fidelity";

type Direction = Extract<ReturnType<typeof directPedagogy>, { ok: true }>["direction"];
type Fabricated = Extract<ReturnType<typeof fabricateDirectedDocument>, { ok: true }>;
export type DirectedOriginalAsset = { original_sha256: string; visual_ref: string; pin: PinnedAsset; widthMm?: number };

export type DirectedPilotResult =
  | { status: "blocked"; issues: DirectedIssue[]; direction?: Direction }
  | (Omit<Fabricated, "ok"> & {
      status: "review_pending"; direction: Direction;
      provenance: { direction: string; plan: string; document: string; assets: string; trace: string };
      checks: { links: "passed"; legacy_replacement: "passed" | "not_applicable"; fabrication: "passed"; supports: "complete" | "partial"; pdf: "pending"; semantic: "pending" };
      assets: Record<string, AssetSource>; pins: PinnedAsset[];
    });

const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

function requestFor(direction: Direction, source: ReturnType<typeof recreationInput>, candidates: readonly DirectorActivity[]) {
  const instructions = {
    scope: direction.scope, audience: direction.audience_register,
    education: { ...source.context.education, subject: direction.verified_subject },
    activities: candidates.map(({ activity_id, decision, changes, needs, prohibition, retains }) => ({
      activity_id, decision, changes, needs, prohibition, retains,
    })),
  };
  const material = { ...source.material,
    evidence: candidates.map(({ activity_id, obligations }) => ({ activity_id, obligations })),
  };
  // Only the provider-visible request is echoed. The private profile, its fingerprint and observation references stay on the server.
  const hash = fingerprint({ instructions, material });
  return { hash, text: `<direction>\n${safeJson({ request_fingerprint: hash, ...instructions })}\n</direction>\n<untrusted_material>\n${safeJson(material)}\n</untrusted_material>` };
}

function pinnedOriginals(analysis: MaterialAnalysis, sourceHash: string, originals: readonly DirectedOriginalAsset[]) {
  const assets: Record<string, AssetSource> = {};
  const byId = new Map<string, PinnedAsset>();
  const refs = new Set(analysis.visuals.map(({ id }) => id));
  for (const { original_sha256, visual_ref, pin, widthMm } of originals) {
    if (original_sha256 !== sourceHash || !refs.has(visual_ref) || assets[visual_ref] ||
        (widthMm !== undefined && (!Number.isFinite(widthMm) || widthMm <= 0 || widthMm > 210))) return null;
    try { verifyPinnedAsset(pin); } catch { return null; }
    if (byId.has(pin.assetId) && byId.get(pin.assetId)!.sha256 !== pin.sha256) return null;
    assets[visual_ref] = { src: assetRef(pin), ...(widthMm === undefined ? {} : { widthMm }) };
    byId.set(pin.assetId, pin);
  }
  return { assets, pins: [...byId.values()] };
}

/** Offline only. This entry point has no production flag, persistence, external provider or route caller. */
export async function runDirectedRecreation(input: DirectorInput, options: {
  original: Uint8Array;
  plannerFixture: (request: StructuredRequest) => unknown;
  candidate?: unknown;
  originalAssets?: readonly DirectedOriginalAsset[];
}): Promise<DirectedPilotResult> {
  const sourceHash = createHash("sha256").update(options.original).digest("hex");
  if (sourceHash !== input.originalSha256) return { status: "blocked", issues: [{ code: "original_hash_mismatch" }] };
  const snapshot = structuredClone(input);
  const directed = directPedagogy(snapshot, options.candidate);
  if (!directed.ok) return { status: "blocked", issues: [{ code: directed.code }] };

  const { direction } = directed;
  const blocked = (issues: DirectedIssue[]): DirectedPilotResult => ({ status: "blocked", issues, direction });
  const unresolved = direction.activities.filter(({ status }) => status === "needs_evidence" || status === "rejected");
  if (unresolved.length) return blocked(unresolved.map(({ activity_id, status }) => ({ code: status, original_id: activity_id })));
  const { base: analysis } = MaterialAnalysisV4Schema.parse(snapshot.analysis);
  const pinned = pinnedOriginals(analysis, sourceHash, structuredClone(options.originalAssets ?? []));
  if (!pinned) return blocked([{ code: "original_asset_binding_invalid" }]);

  const context = buildAdaptationContext({
    profile: snapshot.profile, analysis, education: { ...snapshot.education, subject: snapshot.verifiedSubject },
    adaptationType: direction.scope, sheet: { scope: direction.scope, subjectSlug: snapshot.verifiedSubject },
  }).context;
  const candidates = direction.activities.filter(({ status }) => status === "design_candidate");
  const request = requestFor(direction, recreationInput(analysis, context, direction.scope), candidates);
  const answer = candidates.length > 0 ? await createDirectedRecreationPlanner(options.plannerFixture)(request.text) : null;
  if (candidates.length > 0 && !answer?.draft) return blocked([{ code: "planner_contract_invalid" }]);
  const draft = answer?.draft ?? { version: 1 as const, request_fingerprint: request.hash, links: [], replacement: null };
  const errors = verifyDirectedLinks(draft, request.hash, candidates);
  if (errors.length) return blocked(errors);

  let compiled = null;
  if (draft.replacement) {
    const issues = checkReplacement(draft.replacement, draft.links, analysis, candidates);
    if (issues.length) return blocked(issues);
    const ids = new Set(draft.links.filter(({ changes }) => changes.includes("replacement")).map(({ original_id }) => original_id));
    const activities = analysis.activities.filter(({ id }) => ids.has(id));
    const objectives = new Set(activities.flatMap(({ objective_ids }) => objective_ids));
    const view = { ...analysis, activities, pedagogical_intent: { ...analysis.pedagogical_intent,
      objectives: analysis.pedagogical_intent.objectives.filter(({ id }) => objectives.has(id)),
    } };
    const needs = candidates.filter(({ activity_id }) => ids.has(activity_id)).flatMap((row) => row.needs.map(({ dimension }) => dimension));
    const plan = draft.replacement;
    const verification = verifyPlan(plan, view, { needs });
    if (!verification.ok) return blocked(verification.issues.filter(({ severity }) => severity === "error").map(({ code, path }) => ({ code: `legacy_${code}`, ref: path })));
    try {
      compiled = compileRecreation({ plan, verification, analysis: view, presentation: context.presentation, visuals: [], reword: false });
    } catch (error) {
      if (error instanceof ZodError) return blocked([{ code: "recreation_document_contract_invalid" }]);
      throw error;
    }
    if (compiled.unresolved.length || auditFidelity(plan, compiled, [], view).length) return blocked([{ code: "recreation_fabrication_incomplete" }]);
  }

  const result = fabricateDirectedDocument({
    analysis, context, profile: snapshot.profile, originalImages: new Set(Object.keys(pinned.assets)),
    rows: direction.activities, links: draft.links, replacements: compiled,
  });
  if (!result.ok) return blocked(result.issues);
  const document = { ...result.document, meta: { ...result.document.meta, stage: direction.audience_register === "young_adult" ? "bachillerato" :
    direction.audience_register === "adolescent" ? "eso" : context.education.stage } };
  return {
    status: "review_pending", direction, document, trace: result.trace, ...pinned,
    provenance: { direction: fingerprint(direction), plan: fingerprint(draft), document: fingerprint(document), assets: fingerprint(pinned.assets), trace: fingerprint(result.trace) },
    // `partial`: a requested support could not be made without adding information; the trace says which and where.
    checks: { links: "passed", legacy_replacement: compiled ? "passed" : "not_applicable", fabrication: "passed",
      supports: result.trace.some(({ unfabricated }) => unfabricated.length > 0) ? "partial" : "complete", pdf: "pending", semantic: "pending" },
  };
}
