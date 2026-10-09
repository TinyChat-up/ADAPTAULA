import { z } from "zod";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import { CLOSED_RESPONSES, type Decision } from "@/lib/schemas/adaptation-plan";
import { SUPPORT_V2_KINDS, SupportV2Schema, type SupportV2Kind } from "@/lib/schemas/generated-segments-v2";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { isResolvedByPresentation } from "./context";
import { authorizedKinds, decisionsToGenerateV2 } from "./generated-v2";
import type { ReviewOutcome, ReviewedDecision, ReviewedPlan } from "./plan-review";
import { VISUAL_ACTIONS, visualTreatment, type VisualTreatment } from "./visual-needs";

/**
 * Who carries out each EFFECTIVE decision, decided before any model call (docs/ADAPTATION.md § Rutas de ejecución). The planner
 * decides pedagogically and knows nothing of the generator's limits; this layer, between the review and the execution, checks
 * what the executors can really do. An applied decision never disappears silently: it ends in exactly one route, or the
 * preflight stops. Execution metadata only: nothing here is written into `AdaptationPlan v1`.
 *
 *  - ai_generation        the generator writes it (it receives exactly these decisions and no others);
 *  - deterministic        the assembler carries it out by itself (drop a unit, label the paragraphs of a source text);
 *  - presentation         a presentation setting already does everything it asks (pagination, decoration);
 *  - deferred_to_renderer layout intent (split, reorganise) that neither the analysis nor the document can express without
 *                         parsing the text: the original is kept and the decision is recorded as pending, never as executed;
 *  - unsupported          nothing can execute it: the preflight blocks.
 */
export const EXECUTION_ROUTES = ["ai_generation", "deterministic", "presentation", "deferred_to_renderer", "unsupported"] as const;
export type ExecutionRoute = (typeof EXECUTION_ROUTES)[number];

/** Layout-only actions: with no support to write they only ask for a different arrangement of what is already there. */
const LAYOUT_ACTIONS = new Set<Decision["action"]>(["segment", "reorganize"]);


/**
 * How many elements each support of contract v2 can hold, read from the schema itself (one source of truth): relaxing a cap in
 * `DraftGeneratedSegments v2` changes this table, and nothing here can drift from it.
 */
export const SUPPORT_CAPACITY: Readonly<Record<SupportV2Kind, number>> = (() => {
  type Option = { properties: Record<string, { const?: string; maxItems?: number }> };
  const json = z.toJSONSchema(SupportV2Schema, { io: "input" }) as { oneOf?: Option[]; anyOf?: Option[] };
  const capacity = {} as Record<SupportV2Kind, number>;
  for (const option of json.oneOf ?? json.anyOf ?? []) {
    const kind = option.properties.kind!.const as SupportV2Kind;
    capacity[kind] = option.properties.items?.maxItems ?? option.properties.slots?.maxItems ?? 1;
  }
  for (const kind of SUPPORT_V2_KINDS) if (capacity[kind] === undefined) throw new Error(`Soporte sin capacidad declarada: ${kind}`);
  return capacity;
})();

export type ExecutionIssueCode = "cardinality_exceeds_capability" | "support_request_not_authorised" | "no_executor";
export interface ExecutionIssue {
  code: ExecutionIssueCode;
  detail: string;
}

export interface DecisionExecution {
  id: string;
  target: string;
  action: Decision["action"];
  outcome: ReviewOutcome;
  /** null when the decision is not applied (rejected, unreviewed, blocked): nothing has to execute it. */
  route: ExecutionRoute | null;
  /** Its visual part, carried out by the assembler whatever the route (docs/VISUAL_RESOURCES.md). Absent: none. */
  visual?: VisualTreatment;
  reason: string;
  issues: ExecutionIssue[];
}

export interface ExecutabilityReport {
  decisions: DecisionExecution[];
  byRoute: Record<ExecutionRoute, string[]>;
  /** The only decisions a generation call may carry. */
  ai: string[];
  /** Effective decisions recorded as pending for the renderer: nothing was generated for them, none is reported as executed. */
  deferred: Array<{ id: string; target: string; action: Decision["action"] }>;
  /** Reasons the call must not be made. */
  blockers: string[];
}

/** A layout-only decision the renderer can carry out: on an activity, or on the whole document (its activities). */
export function isLayoutExecutable(decision: Pick<Decision, "target">, analysis: Pick<MaterialAnalysis, "activities">): boolean {
  return decision.target === "document" ? analysis.activities.length > 0 : analysis.activities.some((a) => a.id === decision.target);
}

export function classifyDecisionExecution(decision: Decision, analysis: MaterialAnalysis, context: Pick<AdaptationContext, "limits" | "presentation">): { route: ExecutionRoute; reason: string } {
  if (decision.response_target !== undefined && (CLOSED_RESPONSES as readonly string[]).includes(decision.response_target)) {
    return { route: "unsupported", reason: `El formato ${decision.response_target} necesita una clave de respuestas: ningún ejecutor la produce` };
  }
  if (decisionsToGenerateV2([decision], analysis, context).length > 0) return { route: "ai_generation", reason: "Hay un apoyo autorizado o una consigna larga que reescribir" };
  const text = analysis.texts.find((t) => t.id === decision.target);
  if (decision.action === "remove") return { route: "deterministic", reason: "El ensamblador omite el elemento" };
  if (decision.action === "segment" && text?.kind === "reading_text") return { route: "deterministic", reason: "El ensamblador etiqueta los párrafos del texto fuente sin tocarlos" };
  const visual = VISUAL_ACTIONS.has(decision.action) ? visualTreatment(decision, analysis) : null;
  if (visual?.kind === "original") {
    return { route: "deterministic", reason: visual.requestedTransform ? "El ensamblador conserva el visual original junto a la actividad (la transformación no se hace: se mantiene tal cual)" : "El ensamblador conserva el visual original junto a la actividad" };
  }
  if (visual?.kind === "requested") {
    return { route: "deterministic", reason: visual.essential ? "El ensamblador reserva el sitio del recurso visual: lo aporta el docente o decide continuar sin él antes de imprimir" : "El ensamblador reserva el sitio de un apoyo visual opcional: la ficha se imprime sin él hasta que el docente lo aporte" };
  }
  if (decision.dimensions.length > 0 && decision.dimensions.every((d) => isResolvedByPresentation(d, context.presentation))) {
    return { route: "presentation", reason: "Lo resuelve la presentación del documento (paginación o decoración)" };
  }
  // The renderer can only give ACTIVITIES their own visual group (`planDeferred`): a layout intent on a text, a visual or a section
  // has no executor, and deferring it would deliver a sheet that silently ignores it. It is reported as unsupported here, where
  // the review (automatic or human) can decide about it, never discovered later on a «ready» sheet.
  if (LAYOUT_ACTIONS.has(decision.action) && authorizedKinds(decision).size === 0) {
    if (isLayoutExecutable(decision, analysis)) return { route: "deferred_to_renderer", reason: "Reorganización de lo que ya hay: ni el análisis ni el documento tienen estructura para hacerlo sin interpretar el texto" };
    return { route: "unsupported", reason: `La presentación solo sabe separar visualmente actividades; ${decision.target} no es una actividad` };
  }
  return { route: "unsupported", reason: `La acción ${decision.action} sobre ${decision.target} no tiene ejecutor (sin apoyo autorizado que escribir)` };
}

function reviewIssues(reviewed: ReviewedDecision, decision: Decision): ExecutionIssue[] {
  const issues: ExecutionIssue[] = [];
  const allowed = authorizedKinds(decision);
  for (const request of reviewed.review?.support_requests ?? []) {
    const kinds = [...authorizedKinds({ supports: [{ kind: request.kind, uses_task_data: false }] })];
    const kind = kinds[0];
    if (!kind || !allowed.has(kind)) {
      issues.push({ code: "support_request_not_authorised", detail: `La revisión pide un apoyo (${request.kind}) que la decisión no autoriza` });
    } else if (request.min_items > SUPPORT_CAPACITY[kind]) {
      issues.push({ code: "cardinality_exceeds_capability", detail: `La revisión exige al menos ${request.min_items} elementos en ${kind} y el bloque admite ${SUPPORT_CAPACITY[kind]}` });
    }
  }
  return issues;
}

export function planExecutability(reviewed: ReviewedPlan, analysis: MaterialAnalysis, context: Pick<AdaptationContext, "limits" | "presentation">): ExecutabilityReport {
  const byRoute = Object.fromEntries(EXECUTION_ROUTES.map((r) => [r, [] as string[]])) as Record<ExecutionRoute, string[]>;
  const blockers: string[] = [];
  const decisions: DecisionExecution[] = reviewed.decisions.map((rd) => {
    const base = { id: rd.id, target: rd.raw.target, action: rd.raw.action, outcome: rd.outcome };
    if (rd.outcome !== "applied" || !rd.effective) return { ...base, route: null, reason: `No se aplica (${rd.outcome}): nada que ejecutar`, issues: [] };
    const { route, reason } = classifyDecisionExecution(rd.effective, analysis, context);
    const issues: ExecutionIssue[] = [...(route === "unsupported" ? [{ code: "no_executor" as const, detail: reason }] : []), ...reviewIssues(rd, rd.effective)];
    byRoute[route].push(rd.id);
    for (const issue of issues) blockers.push(`${rd.id}: ${issue.detail}`);
    const visual = route !== "unsupported" && VISUAL_ACTIONS.has(rd.effective.action) ? visualTreatment(rd.effective, analysis) : null;
    return { ...base, route, reason, issues, ...(visual ? { visual } : {}) };
  });
  return {
    decisions,
    byRoute,
    ai: byRoute.ai_generation,
    deferred: decisions.filter((d) => d.route === "deferred_to_renderer").map((d) => ({ id: d.id, target: d.target, action: d.action })),
    blockers,
  };
}

export class ExecutionBlockedError extends Error {
  constructor(readonly blockers: string[]) {
    super(`El plan efectivo no se puede ejecutar: ${blockers.join("; ")}`);
    this.name = "ExecutionBlockedError";
  }
}
