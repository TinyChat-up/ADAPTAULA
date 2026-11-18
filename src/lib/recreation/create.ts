import "server-only";
import type { AIRunRecord } from "@/lib/ai/types";
import { RECREATION_CONTRACT } from "./contract";
import { runRecreation, type Planner, type RecreationOutcome, type RecreationRequest } from "./pilot";
import { recordOf, type RecreationRecord, type RecreationStore } from "./record";
import { RECREATION_VERIFIER_VERSION } from "./verify";
import { RECREATION_VISUALS_VERSION } from "./visuals";

/**
 * Generating is the only step that calls models, and it happens once per version (ADR-051):
 *   createRecreation      runs the route and stores version 1; the explanation for the teacher comes in the same plan call.
 *   regenerateRecreation  an explicit request: it checks the teacher may write, the plan's allowance and the budget BEFORE anything,
 *                         asks for confirmation (a new version will be created; the current one is kept), then runs and stores v+1.
 * Viewing is `loadRecreationView` (view.ts), which has no access to any of this.
 */

export interface GenerationDeps {
  store: RecreationStore;
  planner: Planner;
  /** Who may generate in this workspace (a writer role), resolved on the server. */
  canWrite(): Promise<boolean>;
  /** The plan's allowance for one more recreation (`checkEntitlement` / `consume_quota` in the product). */
  entitlement(): Promise<{ allowed: true } | { allowed: false; reason: "quota" | "plan" }>;
  /** Whether the spending ceiling still covers a generation's worst case. */
  budgetAllows(): Promise<boolean>;
  newId(): string;
  now(): string;
  runs: AIRunRecord[];
}

export type GenerationResult =
  | { status: "created"; record: RecreationRecord }
  | { status: "confirm"; message: string }
  | { status: "forbidden" | "quota" | "plan" | "budget"; message: string }
  | { status: "not_found" }
  | { status: "failed"; outcome: Exclude<RecreationOutcome["status"], "ready">; message: string };

const MESSAGES = {
  forbidden: "No tienes permiso para crear materiales en este espacio.",
  quota: "Has alcanzado el límite de adaptaciones de tu plan.",
  plan: "Tu plan no incluye esta función.",
  budget: "No se puede generar ahora: se ha alcanzado el límite de gasto previsto.",
  confirm: "Se creará una versión nueva del material y se usará una adaptación de tu plan. La versión actual se conserva.",
  failed: "No hemos podido crear un material fiable con esta ficha. No se ha guardado nada y no se ha descontado la adaptación.",
} as const;

async function gate(deps: GenerationDeps): Promise<Extract<GenerationResult, { status: "forbidden" | "quota" | "plan" | "budget" }> | null> {
  if (!(await deps.canWrite())) return { status: "forbidden", message: MESSAGES.forbidden };
  const entitled = await deps.entitlement();
  if (!entitled.allowed) return { status: entitled.reason, message: MESSAGES[entitled.reason] };
  if (!(await deps.budgetAllows())) return { status: "budget", message: MESSAGES.budget };
  return null;
}

async function generate(deps: GenerationDeps, request: RecreationRequest & { workspaceId: string; materialId: string }, id: string, version: number): Promise<GenerationResult> {
  const outcome = await runRecreation(deps.planner, request);
  const record = recordOf(outcome, { id, version, workspaceId: request.workspaceId, materialId: request.materialId, now: deps.now() }, deps.runs, {
    contract: RECREATION_CONTRACT,
    verifier: RECREATION_VERIFIER_VERSION,
    visuals: RECREATION_VISUALS_VERSION,
    planner: request.plannerLabel,
  });
  if (!record) return { status: "failed", outcome: outcome.status as Exclude<RecreationOutcome["status"], "ready">, message: MESSAGES.failed };
  await deps.store.save(record);
  return { status: "created", record };
}

export async function createRecreation(deps: GenerationDeps, request: RecreationRequest & { workspaceId: string; materialId: string }): Promise<GenerationResult> {
  const denied = await gate(deps);
  if (denied) return denied;
  return generate(deps, request, deps.newId(), 1);
}

export async function regenerateRecreation(deps: GenerationDeps, input: { id: string; confirmed: boolean; request: RecreationRequest & { workspaceId: string; materialId: string } }): Promise<GenerationResult> {
  const current = await deps.store.latest(input.id);
  if (!current || current.workspace_id !== input.request.workspaceId) return { status: "not_found" };
  const denied = await gate(deps);
  if (denied) return denied;
  if (!input.confirmed) return { status: "confirm", message: MESSAGES.confirm };
  return generate(deps, input.request, current.id, current.version + 1);
}
