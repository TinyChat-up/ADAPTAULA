import "server-only";
import { createHash } from "node:crypto";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import type { PipelineSnapshot } from "@/lib/adaptation/orchestration/store";
import { parseStoredAnalysis } from "@/lib/analysis/parse";
import { runDirectedRecreation, type DirectedPilotResult } from "@/lib/recreation/directed-pilot";
import { printDirectedRecreation } from "@/lib/recreation/directed-print";
import type { DirectedTrace } from "@/lib/recreation/directed-document";
import type { PdfEngine } from "@/lib/render/print/engine";
import { AdaptationContextSchema } from "@/lib/schemas/adaptation-context";
import { FunctionalProfileSchema } from "@/lib/schemas/functional-profile";

/**
 * Bridge between the application's data and the pedagogical director (Fases 0–4.1). Given an adaptation the caller may already read,
 * it rebuilds the director's input ONLY from what the server trusts and checks every link before anything is fabricated:
 *   · the analysis is the V4 stored with the material, and the same one the adaptation was created with (its fingerprint);
 *   · the original file is the one the material was uploaded with (sha-256 of its bytes against `content_hash`);
 *   · the learner profile is the adaptation's, of the same workspace, unchanged since creation (date and rebuilt context fingerprint);
 *   · the per-sheet authorization is the adaptation's own scope (a curricular one is refused: there is no authorization contract yet).
 * Then the director decides, the Fase 4.1 fabrication builds the sheet and the existing print path renders it.
 *
 * No model is called (the director is code; a substitution, which would need a planner, is refused with its reason), nothing is
 * persisted, no quota or budget is touched, and no state of the adaptation changes: this is a preview of the new engine, not a delivery.
 */

export interface DirectedBridgeDeps {
  /** The adaptation as the server stores it. Read only AFTER the caller's access to it was checked with the user's own permissions. */
  pipeline(adaptationId: string): Promise<PipelineSnapshot | null>;
  material(id: string): Promise<{ id: string; workspace_id: string; subject_slug: string | null; content_hash: string | null; source_path: string | null; deletion_requested_at: string | null } | null>;
  profile(id: string): Promise<{ id: string; workspace_id: string; functional_profile: unknown; updated_at: string } | null>;
  original(storagePath: string): Promise<Uint8Array | null>;
  engine: PdfEngine;
}

export type DirectedBridgeIssue = { code: string; original_id?: string; ref?: string };
export type DirectedBridgeResult =
  | { status: "blocked"; issues: DirectedBridgeIssue[] }
  | { status: "review_pending"; pdf: Uint8Array; checks: Omit<Extract<DirectedPilotResult, { status: "review_pending" }>["checks"], "pdf"> & { pdf: "passed" }; trace: DirectedTrace[] };

const blocked = (...codes: string[]): DirectedBridgeResult => ({ status: "blocked", issues: codes.map((code) => ({ code })) });

export async function directedSheet(deps: DirectedBridgeDeps, workspaceId: string, adaptationId: string): Promise<DirectedBridgeResult> {
  const snapshot = await deps.pipeline(adaptationId);
  const row = snapshot?.adaptation;
  if (!snapshot || !row || row.workspace_id !== workspaceId) return blocked("not_found");
  if (!row.pipeline_versions || !row.context_snapshot || !row.context_fingerprint || !row.analysis_fingerprint) return blocked("invalid_input");
  const context = AdaptationContextSchema.safeParse(row.context_snapshot);
  if (!context.success || fingerprint(context.data) !== row.context_fingerprint) return blocked("invalid_input");

  // Only a current V4 analysis, and the very one this adaptation was created with.
  const parsed = parseStoredAnalysis(snapshot.analysis.analysis);
  if (parsed.storedVersion !== 4 || !parsed.analysis || parsed.outdated) return blocked("v4_required");
  if (fingerprint(parsed.analysis) !== row.analysis_fingerprint) return blocked("stale_analysis");

  // The per-sheet authorization is the adaptation's frozen scope. Curricular changes need a contract that does not exist yet.
  const scope = context.data.pedagogy?.scope ?? row.adaptation_type;
  if (scope === "curricular") return blocked("curricular_unavailable");
  if (scope !== "accessibility" && scope !== "methodological") return blocked("invalid_authorization");

  const material = await deps.material(row.material_id);
  if (!material || material.workspace_id !== workspaceId || material.deletion_requested_at || !material.content_hash) return blocked("material_unavailable");
  const original = material.source_path ? await deps.original(material.source_path) : null;
  if (!original) return blocked("original_unavailable");
  if (createHash("sha256").update(original).digest("hex") !== material.content_hash) return blocked("original_changed");

  // The profile the adaptation was made for, unchanged: a later edit would make the preview describe another student.
  if (!row.learner_profile_id) return blocked("profile_required");
  const stored = await deps.profile(row.learner_profile_id);
  if (!stored || stored.workspace_id !== workspaceId) return blocked("profile_unavailable");
  const profile = FunctionalProfileSchema.safeParse(stored.functional_profile);
  if (!profile.success) return blocked("profile_unavailable");
  if (Date.parse(stored.updated_at) > Date.parse(row.created_at)) return blocked("profile_changed");
  const { education } = context.data;
  const rebuilt = buildAdaptationContext({
    profile: profile.data, analysis: parsed.analysis, education: { stage: education.stage, grade: education.grade, subject: education.subject },
    adaptationType: context.data.adaptation_type, teacherRequest: context.data.teacher_request, visualSupports: context.data.visual_supports?.requested === true,
    ...(context.data.pedagogy ? { sheet: { scope: context.data.pedagogy.scope, subjectSlug: material.subject_slug } } : {}),
    policy: row.pipeline_versions.context_policy,
  }).context;
  if (fingerprint(rebuilt) !== row.context_fingerprint) return blocked("profile_changed");

  const draft = await runDirectedRecreation({
    analysis: snapshot.analysis.analysis, originalSha256: material.content_hash, profile: profile.data,
    verifiedSubject: material.subject_slug, education: { stage: education.stage, grade: education.grade },
    authorization: { version: 1, type: scope },
  }, { original });
  if (draft.status === "blocked") return { status: "blocked", issues: draft.issues };
  const printed = await printDirectedRecreation(draft, deps.engine);
  if (printed.status === "blocked") return blocked(...printed.issues);
  return { status: "review_pending", pdf: printed.pdf, checks: printed.checks, trace: draft.trace };
}
