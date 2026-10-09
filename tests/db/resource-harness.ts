import type { PGlite } from "@electric-sql/pglite";
import type { ResourceDeps, ResourceRow } from "@/lib/adaptation/resources/service";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";
import { as } from "./harness";
import type { User } from "./orchestration-harness";

/**
 * `ResourceDeps` over PGlite with the real migrations: the reader runs as the user (RLS on adaptations, versions, resources AND on
 * storage.objects, as the private bucket policy checks in production); the writer as service_role. Bytes live in memory.
 */
const BUCKET = "generated-assets";
const COLUMNS = "id, decision_id, resolution, storage_path, sha256, width, height, created_at";

export function resourceHarness(db: PGlite, user: User, objects: Map<string, Uint8Array> = new Map()) {
  const asUser = <T>(fn: () => Promise<T>) => as(db, "authenticated", user.id, fn);
  const asService = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);
  const deps: ResourceDeps = {
    reader: {
      adaptation: async (id) => (await asUser(() => db.query<{ id: string; workspace_id: string }>("select id, workspace_id from public.adaptations where id = $1", [id]))).rows[0] ?? null,
      currentDocument: async (adaptationId) => {
        const row = (await asUser(() => db.query<{ document: unknown }>("select v.document from public.adaptations a join public.adaptation_versions v on v.adaptation_id = a.id and v.version = a.current_version where a.id = $1 and a.status = 'ready' and a.delivered_at is not null", [adaptationId]))).rows[0];
        const parsed = MaterialDocumentSchema.safeParse(row?.document);
        return parsed.success ? parsed.data : null;
      },
      activeResources: async (adaptationId) => (await asUser(() => db.query<ResourceRow>(`select ${COLUMNS} from public.adaptation_visual_resources where adaptation_id = $1 and superseded_at is null`, [adaptationId]))).rows,
      readObject: async (path) => {
        const visible = (await asUser(() => db.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [BUCKET, path]))).rows.length > 0;
        return visible ? (objects.get(path) ?? null) : null;
      },
    },
    admin: {
      putObject: async (path, png) => {
        if (objects.has(path)) return "exists";
        objects.set(path, png);
        await asService(() => db.query("insert into storage.objects (bucket_id, name) values ($1, $2) on conflict do nothing", [BUCKET, path]));
        return "stored";
      },
      setResource: async (i) =>
        (
          await asService(() =>
            db.query<{ data: { id: string; reused: boolean } }>("select public.set_adaptation_visual_resource($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as data", [
              i.workspaceId,
              i.adaptationId,
              i.decisionId,
              i.resolution,
              i.storagePath,
              i.sha256,
              i.width,
              i.height,
              i.bytes,
              i.rightsConfirmed,
              i.userId,
            ]),
          )
        ).rows[0]!.data,
    },
  };
  return { deps, objects };
}
