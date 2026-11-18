import "server-only";
import type { AIRunRecord } from "@/lib/ai/types";
import { RECREATION_CONTRACT } from "./contract";
import { runRecreation, type Planner, type RecreationOutcome, type RecreationRequest } from "./pilot";
import { versionOf, type RecreationLine, type RecreationStore, type RecreationVersion } from "./record";
import { RECREATION_VERIFIER_VERSION } from "./verify";
import { RECREATION_VISUALS_VERSION } from "./visuals";

/**
 * Generating is the only step that calls models, once per version (ADR-051, ADR-052). Every generation goes through the same
 * gate, in this order, BEFORE any call:
 *   1. permission (a writer role, resolved on the server);
 *   2. idempotency (the same request key returns the line already created: a double click or a network retry is not a second bill);
 *   3. budget (the ceiling still covers the generation's worst case);
 *   4. reservation of the plan's unit with an idempotent key (`consume_quota` in the product), given back if nothing is stored.
 * In the product, 4 and the store's `addVersion` share a transaction (supabase/migrations/20261001003700_recreation_engine.sql).
 *
 *   createRecreation       version 1 of a new line.
 *   regenerateRecreation   explicit: asks for confirmation, then version n+1; earlier versions and their pictures stay.
 *   restoreVersion         makes an earlier version the current one: no model, no unit, nothing generated.
 * Viewing is `loadRecreationView` (view.ts), which has no access to any of this.
 */

export interface GenerationDeps {
  store: RecreationStore;
  planner: Planner;
  canWrite(): Promise<boolean>;
  quota: { reserve(key: string): Promise<"reserved" | "quota" | "plan">; refund(key: string): Promise<void> };
  budgetAllows(): Promise<boolean>;
  newId(): string;
  now(): string;
  runs: AIRunRecord[];
}

type Request = RecreationRequest & { workspaceId: string; materialId: string };

export type GenerationResult =
  | { status: "created"; line: RecreationLine; version: RecreationVersion; reused: boolean }
  | { status: "confirm"; message: string }
  | { status: "forbidden" | "quota" | "plan" | "budget"; message: string }
  | { status: "not_found" }
  | { status: "failed"; outcome: Exclude<RecreationOutcome["status"], "ready">; message: string };

const MESSAGES = {
  forbidden: "No tienes permiso para crear materiales en este espacio.",
  quota: "Has alcanzado el límite de adaptaciones de tu plan.",
  plan: "Tu plan no incluye esta función.",
  budget: "No se puede generar ahora: se ha alcanzado el límite de gasto previsto.",
  confirm: "Se creará una versión nueva del material y se usará una adaptación de tu plan. Las versiones anteriores se conservan y puedes volver a ellas.",
  failed: "No hemos podido crear un material fiable con esta ficha. No se ha guardado nada y no se ha descontado la adaptación.",
} as const;

async function generate(deps: GenerationDeps, request: Request, line: RecreationLine, version: number): Promise<GenerationResult> {
  if (!(await deps.budgetAllows())) return { status: "budget", message: MESSAGES.budget };
  const reservation = `recreation:${line.id}:v${version}`;
  const reserved = await deps.quota.reserve(reservation);
  if (reserved !== "reserved") return { status: reserved, message: MESSAGES[reserved] };
  try {
    const outcome = await runRecreation(deps.planner, request);
    const stored = versionOf(outcome, { id: deps.newId(), lineId: line.id, version, workspaceId: request.workspaceId, now: deps.now() }, deps.runs, {
      contract: RECREATION_CONTRACT,
      verifier: RECREATION_VERIFIER_VERSION,
      visuals: RECREATION_VISUALS_VERSION,
      planner: request.plannerLabel,
    });
    if (!stored) {
      await deps.quota.refund(reservation);
      return { status: "failed", outcome: outcome.status as Exclude<RecreationOutcome["status"], "ready">, message: MESSAGES.failed };
    }
    await deps.store.addVersion(line, stored.version, stored.internal);
    return { status: "created", line: { ...line, current_version: version }, version: stored.version, reused: false };
  } catch (error) {
    await deps.quota.refund(reservation);
    throw error;
  }
}

export async function createRecreation(deps: GenerationDeps, request: Request & { idempotencyKey: string }): Promise<GenerationResult> {
  if (!(await deps.canWrite())) return { status: "forbidden", message: MESSAGES.forbidden };
  const existing = await deps.store.findLineByKey(request.workspaceId, request.idempotencyKey);
  if (existing) {
    const version = await deps.store.getVersion(existing.id, existing.current_version);
    if (version) return { status: "created", line: existing, version, reused: true };
  }
  const line: RecreationLine = { id: deps.newId(), workspace_id: request.workspaceId, material_id: request.materialId, current_version: 1, idempotency_key: request.idempotencyKey };
  return generate(deps, request, line, 1);
}

export async function regenerateRecreation(deps: GenerationDeps, input: { lineId: string; confirmed: boolean; request: Request }): Promise<GenerationResult> {
  const line = await deps.store.getLine(input.lineId);
  if (!line || line.workspace_id !== input.request.workspaceId) return { status: "not_found" };
  if (!(await deps.canWrite())) return { status: "forbidden", message: MESSAGES.forbidden };
  if (!(await deps.budgetAllows())) return { status: "budget", message: MESSAGES.budget };
  if (!input.confirmed) return { status: "confirm", message: MESSAGES.confirm };
  const latest = Math.max(...(await deps.store.listVersions(line.id)).map((v) => v.version));
  return generate(deps, input.request, line, latest + 1);
}

/** Going back to an earlier version: a pointer change. No model, no unit, no picture generated. */
export async function restoreVersion(deps: Pick<GenerationDeps, "store" | "canWrite">, input: { lineId: string; version: number; workspaceId: string }): Promise<{ status: "restored" | "forbidden" | "not_found" }> {
  const line = await deps.store.getLine(input.lineId);
  if (!line || line.workspace_id !== input.workspaceId) return { status: "not_found" };
  if (!(await deps.canWrite())) return { status: "forbidden" };
  if (!(await deps.store.getVersion(line.id, input.version))) return { status: "not_found" };
  await deps.store.setCurrent(line.id, input.version);
  return { status: "restored" };
}
