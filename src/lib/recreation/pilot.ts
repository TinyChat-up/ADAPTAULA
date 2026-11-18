import "server-only";
import type { AIRunRecord } from "@/lib/ai/types";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { compileRecreation, type CompiledRecreation } from "./compile";
import { RecreationPlanSchema, type RecreationPlan, type RecreationScope } from "./contract";
import { recreationInput, type RecreationInput } from "./input";
import { verifyPlan, type PlanIssue, type Verification } from "./verify";
import { resolveVisuals, type IllustrationGate, type ResolvedVisual } from "./visuals";

/**
 * The isolated recreation route (ADR-049, ADR-050):
 *
 *   analysis + context → planner (Claude through src/lib/ai, or a fixed plan) → recreation_plan@v1 → verification
 *     → [one repair, told the issues] → visuals (A original · B code · C illustration pipeline) → MaterialDocuments → PDF
 *
 * Not wired to «Hacer magia», to a route or to the database: the caller injects the planner and the illustration gate (built with
 * the product's own gate, quota and budget in production; mocks in tests). Every resource gets a provenance record: who produced it
 * and what checked it.
 */

export interface PlannerAnswer {
  draft: unknown;
  run: AIRunRecord | null;
  /** Why no answer was asked for: the budget would not cover the call. */
  stop?: "budget_exhausted";
}
export type Planner = (input: RecreationInput, repairOf?: readonly PlanIssue[]) => Promise<PlannerAnswer>;

/** A plan given in advance (tests, the hand-written pilot): what a model call would return, without one. */
export const fixedPlanner = (plan: unknown): Planner => async () => ({ draft: plan, run: null });

export interface ProvenanceRecord {
  resource: string;
  produced_by: string;
  checked_by: string;
  status: string;
}

export interface RecreationRequest {
  analysis: MaterialAnalysis;
  context: AdaptationContext;
  scope: RecreationScope["type"];
  /** Who plans, for the provenance record («recreation_planner v1 · claude-…», «plan escrito a mano»). */
  plannerLabel: string;
  illustrations?: IllustrationGate;
  locatedOriginals?: ReadonlySet<string>;
}

export type RecreationOutcome =
  | { status: "ready"; plan: RecreationPlan; verification: Verification; visuals: ResolvedVisual[]; compiled: CompiledRecreation; provenance: ProvenanceRecord[]; runs: AIRunRecord[]; calls: number }
  | { status: "invalid_contract"; issues: string[]; runs: AIRunRecord[]; calls: number }
  | { status: "rejected"; plan: RecreationPlan; issues: PlanIssue[]; runs: AIRunRecord[]; calls: number }
  | { status: "budget_exhausted"; runs: AIRunRecord[]; calls: number };

const MAX_CALLS = 2;

export async function runRecreation(planner: Planner, request: RecreationRequest): Promise<RecreationOutcome> {
  const input = recreationInput(request.analysis, request.context, request.scope);
  const runs: AIRunRecord[] = [];
  let repairOf: PlanIssue[] | undefined;
  let last: RecreationOutcome | null = null;
  for (let call = 1; call <= MAX_CALLS; call++) {
    const answer = await planner(input, repairOf);
    if (answer.run) runs.push(answer.run);
    if (answer.stop === "budget_exhausted") return last ?? { status: "budget_exhausted", runs, calls: call - 1 };
    const parsed = RecreationPlanSchema.safeParse(answer.draft);
    if (!parsed.success) {
      const issues = answer.run?.issues?.length ? answer.run.issues : parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`);
      last = { status: "invalid_contract", issues, runs, calls: call };
      repairOf = issues.map((message) => ({ severity: "error", code: "contract", path: "plan", message }));
      continue;
    }
    const plan = parsed.data;
    // The scope is the server's, never the plan's.
    if (plan.scope.type !== request.scope) return { status: "rejected", plan, issues: [{ severity: "error", code: "scope_mismatch", path: "scope", message: "El alcance del plan no es el autorizado para esta ficha." }], runs, calls: call };
    const verification = verifyPlan(plan, request.analysis, { needs: request.context.needs.map((n) => n.dimension) });
    if (!verification.ok) {
      last = { status: "rejected", plan, issues: verification.issues, runs, calls: call };
      repairOf = verification.issues.filter((i) => i.severity === "error");
      continue;
    }
    const needs = request.context.needs.map((n) => n.dimension);
    const visuals = await resolveVisuals({ plan, verification, analysis: request.analysis, needs, locatedOriginals: request.locatedOriginals ?? new Set(), illustrations: request.illustrations ?? { available: false, reason: "disabled" }, planner: request.plannerLabel });
    const provenance = provenanceOf(plan, verification, visuals, request.plannerLabel);
    const compiled = compileRecreation({ plan, verification, analysis: request.analysis, presentation: request.context.presentation, visuals, provenance });
    return { status: "ready", plan, verification, visuals, compiled, provenance, runs, calls: call };
  }
  return last!;
}

const STATUS_ES = { verified: "solución comprobada", anchored: "apoyada en el texto, sin comprobar", teacher_review: "abierta: criterios" } as const;

function provenanceOf(plan: RecreationPlan, verification: Verification, visuals: readonly ResolvedVisual[], planner: string): ProvenanceRecord[] {
  // The verifier's version once, not on every row.
  const out: ProvenanceRecord[] = [{ resource: "Verificación", produced_by: verification.version, checked_by: "reglas deterministas del servidor", status: verification.review_required ? "requiere revisión docente" : "completa" }];
  if (plan.reading) out.push({ resource: "Lectura por partes", produced_by: `texto original (${plan.reading.source_ref}); partes: ${planner}`, checked_by: "literal: no se reescribe", status: "original" });
  plan.activities.forEach((a, i) => {
    const v = verification.activities.find((x) => x.id === a.id);
    out.push({ resource: `Actividad ${i + 1}`, produced_by: planner, checked_by: v?.basis ?? "sin verificar", status: v ? STATUS_ES[v.status] : "sin verificar" });
  });
  for (const v of plan.visuals) out.push({ resource: `Esquema «${v.title}»`, produced_by: `renderer (flow) con los rótulos de ${v.source_ref}`, checked_by: "rótulos citados del original", status: "exacto" });
  for (const v of visuals) out.push({ resource: `Imagen ${v.request_id}`, produced_by: v.provenance.produced_by ?? "ninguno", checked_by: v.provenance.reviewed_by ?? "—", status: v.route === "none" ? (v.essential ? "FALTA (imprescindible)" : "no incluida") : v.route });
  for (const m of plan.materials) out.push({ resource: `Tarjetas ${m.id}`, produced_by: planner, checked_by: "sin pistas de la solución", status: "recortables" });
  return out;
}
