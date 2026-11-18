import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { compileRecreation, type CompiledRecreation } from "./compile";
import { RecreationPlanSchema, type RecreationPlan, type RecreationScope } from "./contract";
import { recreationInput, type RecreationInput } from "./input";
import { verifyPlan, type PlanIssue, type Verification } from "./verify";

/**
 * The isolated recreation route (pilot, ADR-049): analysis + context → planner → contract → verification → two documents. It is not
 * wired to «Hacer magia», to a route or to the database: whoever calls it injects the planner (a model through `src/lib/ai`, or a
 * fixed plan in tests and in the pond pilot). Storage, permissions, quotas and versions stay where they are until a later delivery
 * connects this route through them.
 */
export type Planner = (input: RecreationInput) => Promise<unknown>;

export type RecreationOutcome =
  | { status: "ready"; plan: RecreationPlan; verification: Verification; compiled: CompiledRecreation }
  | { status: "invalid_contract"; issues: string[] }
  | { status: "rejected"; plan: RecreationPlan; issues: PlanIssue[] };

export async function runRecreation(planner: Planner, input: { analysis: MaterialAnalysis; context: AdaptationContext; scope: RecreationScope["type"] }): Promise<RecreationOutcome> {
  const raw = await planner(recreationInput(input.analysis, input.context, input.scope));
  const parsed = RecreationPlanSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid_contract", issues: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`) };
  const plan = parsed.data;
  // The scope is the server's, never the plan's: a plan that declares another one is rejected by the verifier.
  if (plan.scope.type !== input.scope) return { status: "rejected", plan, issues: [{ severity: "error", code: "scope_mismatch", path: "scope", message: "El alcance del plan no es el autorizado para esta ficha." }] };
  const verification = verifyPlan(plan, input.analysis, { needs: input.context.needs.map((n) => n.dimension) });
  if (!verification.ok) return { status: "rejected", plan, issues: verification.issues };
  return { status: "ready", plan, verification, compiled: compileRecreation(plan, verification, input.analysis, input.context.presentation) };
}
