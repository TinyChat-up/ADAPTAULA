import { createHash } from "node:crypto";
import { allBlocks, type MaterialDocument } from "@/lib/schemas/material-document";

/**
 * The teacher's answer to a visual a plan decision asked for and the original does not have (docs/VISUAL_RESOURCES.md): an image
 * of theirs, or the explicit decision to go on without it. Scoped to ONE adaptation and its current delivered version; it never
 * creates another adaptation, regenerates anything or touches the quota. Original visuals go through the locator (materials).
 */

export const RESOURCE_DECISION = /^dec_[0-9]{1,4}$/;

export interface ResourceRow {
  id: string;
  decision_id: string;
  resolution: "provided" | "omitted";
  storage_path: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

/** A visual the current delivered version reserves a place for (an `image` of source `requested`). */
export interface RequestedVisual {
  decisionId: string;
  essential: boolean;
  /** For the teacher: what the decision wanted the visual for. Never the student's text. */
  purpose: string;
}

export type ResourceState =
  | { decisionId: string; status: "pending" }
  | { decisionId: string; status: "omitted" }
  | { decisionId: string; status: "provided"; resourceId: string; sha256: string }
  /** A row says an image was provided, but its object is missing or its bytes do not match: treated as not provided. */
  | { decisionId: string; status: "unavailable" };

export interface ResourceDeps {
  /** Reads with the USER's rights (RLS on the adaptation, the version, the rows and the private object). */
  reader: {
    adaptation(id: string): Promise<{ id: string; workspace_id: string } | null>;
    /** The document of the adaptation's current, delivered version; null if there is none. */
    currentDocument(adaptationId: string): Promise<MaterialDocument | null>;
    activeResources(adaptationId: string): Promise<ResourceRow[]>;
    readObject(path: string): Promise<Uint8Array | null>;
  };
  /** Service role, only after the reader authorised the adaptation. */
  admin: {
    /** Never replaces an object: an existing path answers `exists` (paths are addressed by content). */
    putObject(path: string, png: Uint8Array): Promise<"stored" | "exists" | "failed">;
    setResource(input: { workspaceId: string; adaptationId: string; decisionId: string; resolution: "provided" | "omitted"; storagePath: string | null; sha256: string | null; width: number | null; height: number | null; bytes: number | null; rightsConfirmed: boolean; userId: string }): Promise<{ id: string; reused: boolean }>;
  };
}

export interface ResourceActor {
  userId: string;
  workspaceId: string;
  canWrite: boolean;
}

export type ResourceResult = { ok: true; state: ResourceState; reused: boolean } | { ok: false; code: "forbidden" | "not_found" | "invalid" | "storage_failed" };

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function requestedVisuals(document: MaterialDocument): RequestedVisual[] {
  const seen = new Set<string>();
  return allBlocks(document).flatMap((b) => {
    if (b.type !== "image" || b.source.kind !== "requested" || seen.has(b.source.decision_id)) return [];
    seen.add(b.source.decision_id);
    return [{ decisionId: b.source.decision_id, essential: b.source.essential === true, purpose: b.source.purpose }];
  });
}

/** The private path of a provided image: under the workspace (what the storage policy checks), addressed by content. */
export const resourcePath = (workspaceId: string, adaptationId: string, sha: string) => `${workspaceId}/${adaptationId}/resources/${sha}.png`;

async function authorised(deps: ResourceDeps, actor: ResourceActor, adaptationId: string, decisionId: string) {
  if (!actor.canWrite) return { ok: false as const, code: "forbidden" as const };
  const adaptation = await deps.reader.adaptation(adaptationId);
  if (!adaptation || adaptation.workspace_id !== actor.workspaceId) return { ok: false as const, code: "not_found" as const };
  const document = await deps.reader.currentDocument(adaptationId);
  const requested = document ? requestedVisuals(document).find((r) => r.decisionId === decisionId) : undefined;
  if (!requested) return { ok: false as const, code: "not_found" as const };
  return { ok: true as const, adaptation, requested };
}

/** «Añadir recurso»: a normalised PNG (see image.ts) becomes the visual of that decision. Same bytes twice: one row, one object. */
export async function provideVisualResource(deps: ResourceDeps, actor: ResourceActor, input: { adaptationId: string; decisionId: string; png: Uint8Array; width: number; height: number; rightsConfirmed: boolean }): Promise<ResourceResult> {
  if (!RESOURCE_DECISION.test(input.decisionId) || !input.rightsConfirmed) return { ok: false, code: "invalid" };
  const auth = await authorised(deps, actor, input.adaptationId, input.decisionId);
  if (!auth.ok) return auth;
  const sha = sha256(input.png);
  const path = resourcePath(auth.adaptation.workspace_id, auth.adaptation.id, sha);
  const put = await deps.admin.putObject(path, input.png);
  if (put === "failed") return { ok: false, code: "storage_failed" };
  const row = await deps.admin.setResource({
    workspaceId: auth.adaptation.workspace_id,
    adaptationId: auth.adaptation.id,
    decisionId: input.decisionId,
    resolution: "provided",
    storagePath: path,
    sha256: sha,
    width: input.width,
    height: input.height,
    bytes: input.png.byteLength,
    rightsConfirmed: true,
    userId: actor.userId,
  });
  return { ok: true, state: { decisionId: input.decisionId, status: "provided", resourceId: row.id, sha256: sha }, reused: row.reused };
}

/** «Continuar sin esta imagen»: recorded as the teacher's explicit decision (who and when), never a silent drop. */
export async function omitVisualResource(deps: ResourceDeps, actor: ResourceActor, input: { adaptationId: string; decisionId: string }): Promise<ResourceResult> {
  if (!RESOURCE_DECISION.test(input.decisionId)) return { ok: false, code: "invalid" };
  const auth = await authorised(deps, actor, input.adaptationId, input.decisionId);
  if (!auth.ok) return auth;
  const row = await deps.admin.setResource({ workspaceId: auth.adaptation.workspace_id, adaptationId: auth.adaptation.id, decisionId: input.decisionId, resolution: "omitted", storagePath: null, sha256: null, width: null, height: null, bytes: null, rightsConfirmed: false, userId: actor.userId });
  return { ok: true, state: { decisionId: input.decisionId, status: "omitted" }, reused: row.reused };
}

export interface ResolvedResources {
  states: Record<string, ResourceState>;
  /** Verified bytes of provided images (only when asked for). */
  bytes: Record<string, Uint8Array>;
}

/**
 * The state of each requested visual, read with the user's rights. A provided image counts only if its object exists AND its
 * bytes match the recorded sha-256: the row alone is not enough (the same rule as the crops of the original).
 */
export async function resolveResources(deps: ResourceDeps, adaptationId: string, decisionIds: readonly string[], options: { withBytes?: boolean } = {}): Promise<ResolvedResources> {
  const states: Record<string, ResourceState> = {};
  const bytes: Record<string, Uint8Array> = {};
  const rows = decisionIds.length > 0 ? await deps.reader.activeResources(adaptationId) : [];
  for (const decisionId of decisionIds) {
    const row = rows.find((r) => r.decision_id === decisionId);
    if (!row) states[decisionId] = { decisionId, status: "pending" };
    else if (row.resolution === "omitted") states[decisionId] = { decisionId, status: "omitted" };
    else {
      const object = row.storage_path ? await deps.reader.readObject(row.storage_path) : null;
      if (object && row.sha256 && sha256(object) === row.sha256) {
        states[decisionId] = { decisionId, status: "provided", resourceId: row.id, sha256: row.sha256 };
        if (options.withBytes) bytes[decisionId] = object;
      } else states[decisionId] = { decisionId, status: "unavailable" };
    }
  }
  return { states, bytes };
}
