import { z } from "zod";
import type { AIRunRecord } from "@/lib/ai/types";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";
import type { RecreationOutcome } from "./pilot";

/**
 * What a recreation leaves stored, once (ADR-051): everything the screen needs to show it again — the student's material, the
 * materials to cut out, the teacher's explanation and the pictures' private assets — plus, apart, what only the server reads (the
 * plan, the verification, the provenance, the model runs without content). Opening, printing or reloading reads this record; nothing
 * is generated again. A new generation is a NEW version, never an overwrite.
 *
 * Persistence: `RecreationStore`. In tests and the demo, in memory; for the product, the proposed table `recreations`
 * (docs/qa/recreacion-plataforma/propuesta-migracion.sql), NOT applied.
 */

export const RECREATION_RECORD_VERSION = 1;

const ExplanationSchema = z.object({
  adapted: z.array(z.string()).min(1),
  why: z.array(z.string()).min(1),
  how_to_use: z.array(z.string()).min(1),
  observe: z.array(z.object({ activity: z.string(), text: z.string() })),
});

/**
 * What the teacher is told about the state of the material, in words, never a verifier's code:
 *   ready       the material passed every essential check;
 *   incomplete  something essential is missing (a picture an activity needs): do not use it yet, and say what;
 * A plan that failed an essential check is never stored as a material (the route returns «rejected»): there is nothing to show.
 */
export const RecreationStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("incomplete"), message: z.string() }),
]);

export const RecreationRecordSchema = z.object({
  record_version: z.literal(RECREATION_RECORD_VERSION),
  id: z.string().uuid(),
  version: z.number().int().min(1),
  workspace_id: z.string().uuid(),
  material_id: z.string().uuid(),
  title: z.string(),
  created_at: z.string(),
  state: RecreationStateSchema,
  student: MaterialDocumentSchema,
  materials: MaterialDocumentSchema.nullable(),
  explanation: ExplanationSchema,
  /** The private pictures the documents point to (`generated_assets`): read with signed URLs, never generated again. */
  assets: z.array(z.object({ asset_id: z.string().uuid(), sha256: z.string(), width: z.number(), height: z.number() })),
  /** Server-only: never sent to a screen. */
  internal: z.object({
    plan: z.unknown(),
    verification: z.unknown(),
    provenance: z.unknown(),
    visuals: z.unknown(),
    runs: z.array(z.object({ purpose: z.string(), provider: z.string(), model: z.string(), promptKey: z.string(), promptVersion: z.number(), status: z.string(), estimatedCostUsd: z.number().nullable() })),
    pipeline: z.object({ contract: z.string(), verifier: z.string(), visuals: z.string(), planner: z.string() }),
  }),
});
export type RecreationRecord = z.infer<typeof RecreationRecordSchema>;

export interface RecreationStore {
  get(id: string): Promise<RecreationRecord | null>;
  /** The latest version of a recreation's line (the same `id` keeps every version). */
  latest(id: string): Promise<RecreationRecord | null>;
  save(record: RecreationRecord): Promise<void>;
}

/** In-memory store (tests, the demo). Every version kept; `get` and `latest` give the newest. */
export class MemoryRecreationStore implements RecreationStore {
  private readonly versions = new Map<string, RecreationRecord[]>();
  reads = 0;
  async get(id: string) {
    this.reads++;
    return this.versions.get(id)?.at(-1) ?? null;
  }
  async latest(id: string) {
    return this.get(id);
  }
  async save(record: RecreationRecord) {
    const list = this.versions.get(record.id) ?? [];
    if (list.some((r) => r.version === record.version)) throw new Error("recreation_version_exists");
    this.versions.set(record.id, [...list, RecreationRecordSchema.parse(record)]);
  }
  history(id: string) {
    return this.versions.get(id) ?? [];
  }
}

const slim = (r: AIRunRecord) => ({ purpose: r.purpose, provider: r.provider, model: r.model, promptKey: r.promptKey, promptVersion: r.promptVersion, status: r.status, estimatedCostUsd: r.estimatedCostUsd });

/** A ready outcome of the route → the record to store (or null: a rejected or unfinished generation is not a material). */
export function recordOf(outcome: RecreationOutcome, ids: { id: string; version: number; workspaceId: string; materialId: string; now: string }, runs: readonly AIRunRecord[], pipeline: RecreationRecord["internal"]["pipeline"]): RecreationRecord | null {
  if (outcome.status !== "ready") return null;
  const { plan, compiled, visuals } = outcome;
  const label = (activityId: string) => compiled.trace.find((t) => t.activity_id === activityId)?.label ?? "?";
  const missing = visuals.filter((v) => v.route === "none" && v.essential);
  return RecreationRecordSchema.parse({
    record_version: RECREATION_RECORD_VERSION,
    id: ids.id,
    version: ids.version,
    workspace_id: ids.workspaceId,
    material_id: ids.materialId,
    title: plan.title,
    created_at: ids.now,
    state: missing.length
      ? { kind: "incomplete", message: `Falta una imagen necesaria para la actividad ${missing.map((m) => label(m.activity_ids[0]!)).join(", ")}. No uses la ficha hasta tenerla: puedes regenerarla o pedir la imagen.` }
      : { kind: "ready" },
    student: compiled.student,
    materials: compiled.materials,
    explanation: {
      adapted: plan.explanation.adapted,
      why: plan.explanation.why.map((w) => w.text),
      how_to_use: plan.explanation.how_to_use,
      observe: plan.guide.per_activity.map((g) => ({ activity: label(g.activity_id), text: g.observe })),
    },
    assets: visuals.flatMap((v) => (v.source?.kind === "generated" ? [{ asset_id: v.source.asset_id, sha256: v.source.sha256, width: v.source.width, height: v.source.height }] : [])),
    internal: { plan, verification: outcome.verification, provenance: outcome.provenance, visuals, runs: runs.map(slim), pipeline },
  });
}
