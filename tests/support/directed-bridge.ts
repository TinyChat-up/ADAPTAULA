import { createHash } from "node:crypto";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { resolvePipelineVersions } from "@/lib/adaptation/orchestration/versions";
import type { PipelineSnapshot } from "@/lib/adaptation/orchestration/store";
import type { DirectedBridgeDeps } from "@/lib/adaptation/directed/bridge";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import type { PdfEngine } from "@/lib/render/print/engine";
import { directorFixture } from "./directed-recreation";

export const WORKSPACE = "11111111-1111-4111-8111-111111111111";
export const ADAPTATION = "22222222-2222-4222-8222-222222222222";
const MATERIAL = "33333333-3333-4333-8333-333333333333";
const PROFILE = "44444444-4444-4444-8444-444444444444";
const CREATED = "2026-11-22T10:00:00.000Z";

/**
 * An adaptation as the application stores it, built the way `createAdaptation` builds it, over the director's synthetic V4 original:
 * the stored V4 analysis, the frozen context and its fingerprints, the material with its file hash and the learner profile row.
 */
export async function appAdaptation(engine: PdfEngine) {
  const { input, original } = await directorFixture();
  const parsed = parseStoredAnalysis(input.analysis);
  const versions = resolvePipelineVersions({});
  const { context } = buildAdaptationContext({
    profile: input.profile, analysis: parsed.analysis!, education: { stage: "eso", grade: "1-eso", subject: "lengua" },
    adaptationType: "methodological", visualSupports: false, sheet: { scope: "methodological", subjectSlug: "lengua" }, policy: versions.context_policy,
  });
  const snapshot = {
    adaptation: {
      id: ADAPTATION, workspace_id: WORKSPACE, material_id: MATERIAL, learner_profile_id: PROFILE, title: "Ficha", adaptation_type: "methodological",
      status: "ready", current_version: 1, pipeline_versions: versions, context_snapshot: context, context_fingerprint: fingerprint(context),
      analysis_fingerprint: fingerprint(parsed.analysis), failure_code: null, delivered_at: null, created_at: CREATED, creation_mode: "automatic",
    },
    analysis: { analysis: input.analysis, prompt_version: "4", status: "analyzed" },
    jobs: [],
  } as unknown as PipelineSnapshot;
  const material = { id: MATERIAL, workspace_id: WORKSPACE, subject_slug: "lengua", content_hash: createHash("sha256").update(original).digest("hex"), source_path: "w/m/original.pdf", deletion_requested_at: null };
  const profile = { id: PROFILE, workspace_id: WORKSPACE, functional_profile: input.profile as unknown, updated_at: "2026-11-21T09:00:00.000Z" };
  const deps: DirectedBridgeDeps = {
    pipeline: async (id) => (id === ADAPTATION ? snapshot : null),
    material: async (id) => (id === MATERIAL ? material : null),
    profile: async (id) => (id === PROFILE ? profile : null),
    original: async (path) => (path === material.source_path ? original : null),
    engine,
  };
  return { deps, snapshot, material, profile, original, input };
}
