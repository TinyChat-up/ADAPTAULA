import "server-only";
import { getAdaptationStatus, getAdaptationVersion, type Actor, type AdaptationVersionDto, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { serviceDeps } from "@/lib/adaptation/orchestration/server";
import type { AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES, type WorkspaceContext } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { AdaptationContextSchema } from "@/lib/schemas/adaptation-context";
import { MaterialDocumentSchema, type MaterialDocument } from "@/lib/schemas/material-document";
import { resolveVisuals, type ResolvedVisuals, type VisualDeps } from "@/lib/materials/visuals/service";
import { visualDeps } from "@/lib/materials/visuals/server";
import type { DeferredInput } from "./deferred";
import { buildRenderModel, type RenderMode, type RenderModel, type RenderValidation } from "./model";
import { assetRef, type PinnedAsset } from "./print/pinned-assets";
import { failureOfState, type VisualAssetFailure, type VisualState } from "./visual-assets";

export type RenderLoad =
  | { kind: "not_found" }
  | { kind: "not_ready"; status: AdaptationStatusDto }
  | { kind: "invalid_document"; status: AdaptationStatusDto }
  | { kind: "ok"; status: AdaptationStatusDto; version: Pick<AdaptationVersionDto, "version" | "createdAt">; document: MaterialDocument; deferred: DeferredInput[] | null; requiredVisuals: string[]; assets: Record<string, { src: string }>; assetFailures: Record<string, VisualAssetFailure>; materialId: string; visuals: VisualState[]; pinned: PinnedAsset[] };

export interface RenderLoadOptions {
  /**
   * For a PDF: every ready visual becomes the exact instance read now (`asset:<id>@<sha256>` as its source, the verified bytes
   * in `pinned`), instead of the authorised image route the screen uses. Same states, same failures, same model otherwise.
   */
  pin?: boolean;
}

/** The authorised route that streams a verified crop. Never a signed URL: authorisation never depends on knowing a link. */
export const visualSrc = (adaptationId: string, visualId: string) => `/api/adaptations/${adaptationId}/visuals/${visualId}`;

/**
 * What the sheet viewer needs, from the USER's client (RLS): another workspace's adaptation and a missing one are both
 * `not_found`. Only the CURRENT, DELIVERED version is ever shown (no version or account is chosen from the URL); an adaptation
 * that is blocked, failed or unfinished has no final sheet to present. The answer key stays in the document and is never read here.
 */
export async function loadRenderInput(ctx: WorkspaceContext, id: string): Promise<RenderLoad> {
  const supabase = await getSupabase();
  const actor: Actor = { userId: ctx.user.id, workspaceId: ctx.workspace.id, canWrite: hasRole(ctx.role, WRITE_ROLES) };
  return loadRenderInputWith(serviceDeps(supabase), actor, id, visualDeps(supabase));
}

/** The same, over explicit dependencies (what the tests drive against a real database with the user's RLS reader). */
export async function loadRenderInputWith(deps: ServiceDeps, actor: Actor, id: string, visuals?: VisualDeps, options: RenderLoadOptions = {}): Promise<RenderLoad> {
  const statusResult = await getAdaptationStatus(deps, actor, id);
  if (!statusResult.ok) return { kind: "not_found" };
  const status = statusResult.data;
  if (!status.delivered) return { kind: "not_ready", status };

  const versionResult = await getAdaptationVersion(deps, actor, id);
  if (!versionResult.ok || !versionResult.data.delivered) return { kind: "not_ready", status };
  const parsed = MaterialDocumentSchema.safeParse(versionResult.data.document);
  if (!parsed.success) return { kind: "invalid_document", status };

  // The deferred decisions of the review this version came from (matched by plan fingerprint); unknown stays unknown.
  const planFingerprint = (versionResult.data.review as { plan_fingerprint?: string } | null)?.plan_fingerprint;
  const reports = await deps.reader.getArtifacts(id, ["execution_report"]);
  const report = reports.filter((a) => (a.payload as { plan_fingerprint?: string }).plan_fingerprint === planFingerprint).at(-1)?.payload as { execution?: { deferred?: DeferredInput[] } } | undefined;
  const deferred = report?.execution?.deferred ? report.execution.deferred.map((d) => ({ id: d.id, target: d.target, action: d.action })) : null;

  const snapshot = await deps.orchestrator.store.getPipeline(id);
  const context = AdaptationContextSchema.safeParse(snapshot?.adaptation.context_snapshot);
  const materialId = snapshot?.adaptation.material_id ?? "";
  const visualIds = [...new Set(parsed.data.pages.flatMap((p) => p.blocks).flatMap((b) => (b.type === "image" && b.source.kind === "original" ? [b.source.visual_ref] : [])))];
  // The visuals of THIS adaptation's analysis (its pinned fingerprint) and of the material's original file: a locator made for
  // another analysis or file is never used. The current preview follows the active locator (a later correction shows here).
  const material = visuals && materialId ? await visuals.reader.material(materialId) : null;
  const resolved: ResolvedVisuals =
    visuals && material && snapshot?.adaptation.analysis_fingerprint
      ? await resolveVisuals(visuals, { materialId, analysisFingerprint: snapshot.adaptation.analysis_fingerprint, sourceSha256: material.content_hash, visualIds, withBytes: options.pin })
      : { states: Object.fromEntries(visualIds.map((v) => [v, { visualId: v, status: "missing_locator" as const }])), bytes: {}, instances: {} };
  const states = visualIds.map((v) => resolved.states[v]!);
  const pinned: Record<string, PinnedAsset> = {};
  if (options.pin) {
    for (const s of states) {
      const instance = resolved.instances[s.visualId];
      const bytes = resolved.bytes[s.visualId];
      if (s.status === "ready" && instance && bytes) pinned[s.visualId] = { ...instance, mime: "image/png", bytes };
    }
  }
  const sourceOf = (visualId: string) => (options.pin ? assetRef(pinned[visualId]!) : visualSrc(id, visualId));
  return {
    kind: "ok",
    status,
    version: { version: versionResult.data.version, createdAt: versionResult.data.createdAt },
    document: parsed.data,
    deferred,
    requiredVisuals: context.success ? context.data.material.required_visuals : [],
    assets: Object.fromEntries(states.filter((s) => s.status === "ready" && (!options.pin || pinned[s.visualId])).map((s) => [s.visualId, { src: sourceOf(s.visualId) }])),
    assetFailures: Object.fromEntries(states.flatMap((s) => {
      const failure = failureOfState(s);
      return failure ? [[s.visualId, failure]] : [];
    })),
    materialId,
    visuals: states,
    pinned: Object.values(pinned),
  };
}

/** The one way a loaded sheet becomes a `RenderModel`: the viewer (both modes) and the PDF export both go through here. */
export function sheetModel(loaded: Extract<RenderLoad, { kind: "ok" }>, mode: RenderMode): { model: RenderModel; validation: RenderValidation } {
  return buildRenderModel(loaded.document, { mode, requiredVisuals: loaded.requiredVisuals, assets: loaded.assets, assetFailures: loaded.assetFailures, deferred: loaded.deferred });
}
