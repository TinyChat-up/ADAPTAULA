import { z } from "zod";
import type { AIRunRecord } from "@/lib/ai/types";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";
import type { RecreationOutcome } from "./pilot";

/**
 * How a recreation is kept (ADR-051, ADR-052), in the same three parts as the proposed tables
 * (supabase/migrations/20261001003700_recreation_engine.sql):
 *
 *   line      its material, its current version and the idempotency key of the request that created it;
 *   version   ONLY what is shown: the student's sheet and the materials WITHOUT answers (the schema refuses a non-empty
 *             `answer_key`), the explanation, the state and the picture references; never overwritten, one per generation;
 *   internal  server-only: the answer key, the plan, the verification, the provenance, the visual decisions and the model runs
 *             (without content). Nothing that reads for a screen can reach it (`RecreationReader` has no method for it).
 *
 * Opening, printing, reloading or going back to an older version reads `line` + `version`: nothing is generated again.
 */

export const RECREATION_RECORD_VERSION = 2;

const ExplanationSchema = z.object({
  adapted: z.array(z.string()).min(1),
  why: z.array(z.string()).min(1),
  how_to_use: z.array(z.string()).min(1),
  observe: z.array(z.object({ activity: z.string(), text: z.string() })),
});

/** A document a member may read: same contract, with no answer. */
const AnswerlessDocument = MaterialDocumentSchema.refine((d) => d.answer_key.length === 0, { message: "Un documento visible no puede llevar respuestas" });

/**
 * What the teacher is told about the material, in plain words and never with an answer:
 *   ready       every closed answer was proven by the server (or the activity is open, judged with criteria);
 *   review      some activities' answers rest on the text but their meaning was not proven: they need the teacher's look first;
 *   incomplete  something essential is missing (a picture an activity needs).
 * A plan that fails an essential check is never stored (there is nothing to show).
 */
export const RECREATION_STATES = ["ready", "review", "incomplete"] as const;

export const RecreationLineSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  material_id: z.string().uuid(),
  current_version: z.number().int().min(1),
  idempotency_key: z.string().min(8).max(120),
});
export type RecreationLine = z.infer<typeof RecreationLineSchema>;

export const RecreationVersionSchema = z.object({
  record_version: z.literal(RECREATION_RECORD_VERSION),
  id: z.string().uuid(),
  line_id: z.string().uuid(),
  version: z.number().int().min(1),
  workspace_id: z.string().uuid(),
  title: z.string(),
  created_at: z.string(),
  state: z.enum(RECREATION_STATES),
  state_message: z.string().nullable(),
  review_activities: z.array(z.string()),
  student: AnswerlessDocument,
  materials: AnswerlessDocument.nullable(),
  explanation: ExplanationSchema,
  /** Private pictures (`generated_assets`) the documents point to: references only, never bytes or signed URLs. */
  assets: z.array(z.object({ asset_id: z.string().uuid(), sha256: z.string(), width: z.number(), height: z.number() })),
});
export type RecreationVersion = z.infer<typeof RecreationVersionSchema>;

export const RecreationInternalSchema = z.object({
  version_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  answer_key: z.object({ student: z.array(z.unknown()), materials: z.array(z.unknown()) }),
  plan: z.unknown(),
  verification: z.unknown(),
  provenance: z.unknown(),
  visuals: z.unknown(),
  runs: z.array(z.object({ purpose: z.string(), provider: z.string(), model: z.string(), promptKey: z.string(), promptVersion: z.number(), status: z.string(), estimatedCostUsd: z.number().nullable() })),
  pipeline: z.object({ contract: z.string(), verifier: z.string(), visuals: z.string(), planner: z.string() }),
});
export type RecreationInternal = z.infer<typeof RecreationInternalSchema>;

/** What a screen may use: lines and versions. There is no way to read `internal` through it. */
export interface RecreationReader {
  getLine(lineId: string): Promise<RecreationLine | null>;
  getVersion(lineId: string, version: number): Promise<RecreationVersion | null>;
  listVersions(lineId: string): Promise<Array<Pick<RecreationVersion, "version" | "created_at" | "state">>>;
}

/** The server's side: writes, and reads of the internal part. */
export interface RecreationStore extends RecreationReader {
  findLineByKey(workspaceId: string, idempotencyKey: string): Promise<RecreationLine | null>;
  /** Stores a version and its internal part together, and makes it the current one (a transaction in the database). */
  addVersion(line: RecreationLine, version: RecreationVersion, internal: RecreationInternal): Promise<void>;
  setCurrent(lineId: string, version: number): Promise<void>;
  getInternal(versionId: string): Promise<RecreationInternal | null>;
}

/** In-memory store (tests, the demo). Versions are never replaced; lines and versions are copied in and out. */
export class MemoryRecreationStore implements RecreationStore {
  private readonly lines = new Map<string, RecreationLine>();
  private readonly versions = new Map<string, RecreationVersion[]>();
  private readonly internals = new Map<string, RecreationInternal>();
  reads = 0;
  async getLine(lineId: string) {
    this.reads++;
    const line = this.lines.get(lineId);
    return line ? structuredClone(line) : null;
  }
  async getVersion(lineId: string, version: number) {
    this.reads++;
    const found = this.versions.get(lineId)?.find((v) => v.version === version);
    return found ? structuredClone(found) : null;
  }
  async listVersions(lineId: string) {
    this.reads++;
    return (this.versions.get(lineId) ?? []).map((v) => ({ version: v.version, created_at: v.created_at, state: v.state }));
  }
  async findLineByKey(workspaceId: string, key: string) {
    return [...this.lines.values()].find((l) => l.workspace_id === workspaceId && l.idempotency_key === key) ?? null;
  }
  async addVersion(line: RecreationLine, version: RecreationVersion, internal: RecreationInternal) {
    const parsed = RecreationVersionSchema.parse(version);
    const list = this.versions.get(line.id) ?? [];
    if (list.some((v) => v.version === parsed.version)) throw new Error("recreation_version_exists");
    this.lines.set(line.id, RecreationLineSchema.parse({ ...line, current_version: parsed.version }));
    this.versions.set(line.id, [...list, parsed]);
    this.internals.set(parsed.id, RecreationInternalSchema.parse(internal));
  }
  async setCurrent(lineId: string, version: number) {
    const line = this.lines.get(lineId);
    if (!line || !this.versions.get(lineId)?.some((v) => v.version === version)) throw new Error("version_not_found");
    this.lines.set(lineId, { ...line, current_version: version });
  }
  async getInternal(versionId: string) {
    return this.internals.get(versionId) ?? null;
  }
}

const slim = (r: AIRunRecord) => ({ purpose: r.purpose, provider: r.provider, model: r.model, promptKey: r.promptKey, promptVersion: r.promptVersion, status: r.status, estimatedCostUsd: r.estimatedCostUsd });

/**
 * A ready outcome of the route → the version to show and its internal part (or null: a rejected or unfinished generation is not
 * a material). The answer key moves out of the documents into the internal part here, before anything is stored.
 */
export function versionOf(
  outcome: RecreationOutcome,
  ids: { id: string; lineId: string; version: number; workspaceId: string; now: string },
  runs: readonly AIRunRecord[],
  pipeline: RecreationInternal["pipeline"],
): { version: RecreationVersion; internal: RecreationInternal } | null {
  if (outcome.status !== "ready") return null;
  const { plan, compiled, visuals, verification } = outcome;
  const label = (activityId: string) => compiled.trace.find((t) => t.activity_id === activityId)?.label ?? "?";
  const missing = visuals.filter((v) => v.route === "none" && v.essential);
  const review = compiled.trace.filter((t) => t.status === "anchored").map((t) => t.label);
  const list = (labels: string[]) => (labels.length === 1 ? `la actividad ${labels[0]}` : `las actividades ${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`);
  const state: RecreationVersion["state"] = missing.length || compiled.unresolved.length ? "incomplete" : review.length ? "review" : "ready";
  const state_message =
    state === "incomplete" && missing.length === 0
      ? "Una actividad se apoyaba en un recurso que no se ha podido crear. No se ha entregado la ficha."
      : state === "incomplete"
      ? `Falta una imagen necesaria para ${list(missing.map((m) => label(m.activity_ids[0]!)))}. No uses la ficha hasta tenerla: puedes regenerarla.`
      : state === "review"
        ? `Antes de usarla, revisa ${list(review)}: comprueba con el texto que cada pregunta tiene una sola respuesta correcta.`
        : null;
  return {
    version: RecreationVersionSchema.parse({
      record_version: RECREATION_RECORD_VERSION,
      id: ids.id,
      line_id: ids.lineId,
      version: ids.version,
      workspace_id: ids.workspaceId,
      title: plan.title,
      created_at: ids.now,
      state,
      state_message,
      review_activities: review,
      student: { ...compiled.student, answer_key: [] },
      materials: compiled.materials ? { ...compiled.materials, answer_key: [] } : null,
      explanation: {
        adapted: plan.explanation.adapted,
        why: plan.explanation.why.map((w) => w.text),
        how_to_use: plan.explanation.how_to_use,
        observe: plan.guide.per_activity.map((g) => ({ activity: label(g.activity_id), text: g.observe })),
      },
      assets: visuals.flatMap((v) => (v.source?.kind === "generated" ? [{ asset_id: v.source.asset_id, sha256: v.source.sha256, width: v.source.width, height: v.source.height }] : [])).concat(outcome.cardAssets ?? []),
    }),
    internal: RecreationInternalSchema.parse({
      version_id: ids.id,
      workspace_id: ids.workspaceId,
      answer_key: { student: compiled.student.answer_key, materials: compiled.materials?.answer_key ?? [] },
      plan,
      verification,
      provenance: outcome.provenance,
      visuals,
      runs: runs.map(slim),
      pipeline,
    }),
  };
}
