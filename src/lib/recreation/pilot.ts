import "server-only";
import type { AIRunRecord } from "@/lib/ai/types";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { compileRecreation, type CompiledRecreation } from "./compile";
import { RecreationPlanSchema, type RecreationPlan, type RecreationScope } from "./contract";
import { recreationInput, type RecreationApproach, type RecreationInput } from "./input";
import { salvagePlan, sanitizePlan, undesignedResources } from "./repair";
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
export type Planner = (input: RecreationInput, repairOf?: readonly PlanIssue[], previousPlan?: RecreationPlan) => Promise<PlannerAnswer>;

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
  /** ADR-054: `new_images` for adaptations planned with v5 on (no reuse of the original's pictures; no pointer is removed). */
  visualPolicy?: "reuse_originals" | "new_images";
}

export type RecreationOutcome =
  | { status: "ready"; plan: RecreationPlan; verification: Verification; visuals: ResolvedVisual[]; compiled: CompiledRecreation; provenance: ProvenanceRecord[]; runs: AIRunRecord[]; calls: number; plannerLabel: string; cardAssets: Array<{ asset_id: string; sha256: string; width: number; height: number }> }
  | { status: "invalid_contract"; issues: string[]; runs: AIRunRecord[]; calls: number }
  | { status: "rejected"; plan: RecreationPlan; issues: PlanIssue[]; runs: AIRunRecord[]; calls: number }
  | { status: "budget_exhausted"; runs: AIRunRecord[]; calls: number };

const MAX_CALLS = 2;

/** The planning half of the route: the verified plan, or why there is none. Nothing paid beyond the planner has happened yet. */
export type PlannedRecreation =
  | { status: "planned"; plan: RecreationPlan; verification: Verification; runs: AIRunRecord[]; calls: number }
  | Exclude<RecreationOutcome, { status: "ready" }>;

export async function planRecreation(planner: Planner, request: Pick<RecreationRequest, "analysis" | "context" | "scope" | "visualPolicy"> & { approach?: RecreationApproach }): Promise<PlannedRecreation> {
  const input = recreationInput(request.analysis, request.context, request.scope, request.approach ?? "auto");
  const runs: AIRunRecord[] = [];
  let repairOf: PlanIssue[] | undefined;
  let last: PlannedRecreation | null = null;
  for (let call = 1; call <= MAX_CALLS; call++) {
    // A verifier rejection leaves a structurally valid plan: let Claude repair THAT plan, rather than regenerate blindly.
    // Invalid contracts are not replayed as if they were trusted valid plans.
    const previousPlan = last?.status === "rejected" ? last.plan : undefined;
    const answer = await planner(input, repairOf, previousPlan);
    if (answer.run) runs.push(answer.run);
    if (answer.stop === "budget_exhausted") return last ?? { status: "budget_exhausted", runs, calls: call - 1 };
    const parsed = RecreationPlanSchema.safeParse(answer.draft);
    if (!parsed.success) {
      const issues = answer.run?.issues?.length ? answer.run.issues : parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`);
      last = { status: "invalid_contract", issues, runs, calls: call };
      repairOf = issues.map((message) => ({ severity: "error", code: "contract", path: "plan", message }));
      continue;
    }
    const needs = request.context.needs.map((n) => n.dimension);
    // The scope is the server's, never the plan's: a curricular plan for a methodological sheet is refused outright.
    if (parsed.data.scope.type === "curricular" && request.scope !== "curricular") return { status: "rejected", plan: parsed.data, issues: [{ severity: "error", code: "scope_mismatch", path: "scope", message: "El alcance del plan no es el autorizado para esta ficha." }], runs, calls: call };
    // Mechanical slips are fixed by the server (one correct value, no model call); then the essential checks decide.
    let plan = sanitizePlan(parsed.data, request.analysis, needs, request.scope, { picturesRequired: request.visualPolicy === "new_images" });
    let verification = verifyPlan(plan, request.analysis, { needs });
    const options = { picturesRequired: request.visualPolicy === "new_images" };
    if (!verification.ok) {
      const salvaged = salvagePlan(plan, verification, request.analysis, needs, request.scope, options);
      if (salvaged) ({ plan, verification } = salvaged);
    }
    // ADR-054: what an activity names must be designed by the plan; otherwise Claude is asked to design it (the one repair call).
    const undesigned = options.picturesRequired ? undesignedResources(plan) : [];
    if (undesigned.length > 0) verification = { ...verification, ok: false, issues: [...verification.issues, ...undesigned] };
    if (!verification.ok) {
      last = { status: "rejected", plan, issues: verification.issues, runs, calls: call };
      repairOf = verification.issues.filter((i) => i.severity === "error");
      continue;
    }
    return { status: "planned", plan, verification, runs, calls: call };
  }
  return last!;
}

/** The second half: the pictures (A original · B code · C illustration pipeline), the documents and the provenance of a verified plan. */
export async function finishRecreation(planned: Extract<PlannedRecreation, { status: "planned" }>, request: RecreationRequest): Promise<Extract<RecreationOutcome, { status: "ready" }>> {
  const { plan, verification, runs, calls } = planned;
  const needs = request.context.needs.map((n) => n.dimension);
  const visuals = await resolveVisuals({ plan, verification, analysis: request.analysis, needs, locatedOriginals: request.locatedOriginals ?? new Set(), illustrations: request.illustrations ?? { available: false, reason: "disabled" }, planner: request.plannerLabel, imagesUsed: { count: 0 }, policy: request.visualPolicy ?? "reuse_originals", inflight: new Map() });
  const provenance = provenanceOf(plan, verification, visuals, request.plannerLabel);
  const compiled = compileRecreation({ plan, verification, analysis: request.analysis, presentation: request.context.presentation, visuals, reword: request.visualPolicy !== "new_images" });
  const cardAssets = visuals.flatMap((v) => (v.cards ?? []).flatMap((c) => (c.asset ? [c.asset] : [])));
  return { status: "ready", plan, verification, visuals, compiled, provenance, runs, calls, plannerLabel: request.plannerLabel, cardAssets };
}

export async function runRecreation(planner: Planner, request: RecreationRequest): Promise<RecreationOutcome> {
  const planned = await planRecreation(planner, request);
  return planned.status === "planned" ? finishRecreation(planned, request) : planned;
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
  for (const m of plan.materials) out.push({ resource: `${m.kind === "cut_out_cards" ? "Tarjetas" : "Tablero"} ${m.id}`, produced_by: `${planner}; dibujo: renderer`, checked_by: "ligado a su actividad, sin pistas de la solución", status: "recortable" });
  out.push({ resource: "Explicación para el docente", produced_by: planner, checked_by: "sin soluciones ni diagnósticos; cada motivo ligado a una necesidad", status: "en pantalla" });
  return out;
}
