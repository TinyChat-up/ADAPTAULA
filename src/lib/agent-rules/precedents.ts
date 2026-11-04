import { DIMENSION_STRATEGIES } from "@/lib/adaptation/strategies";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { StrategyKey } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { PrecedentEntry } from "./types";

/**
 * Which precedents of the private library travel with one planner request (ADR-045). The method's own rule is to read the
 * corrected errors (E) and rejected alternatives (R) of the resources the plan may use, and the accepted (A) and pending (P) cases of
 * those resources. «May use» is decided with the platform's own catalog, not with the pilot profiles of the laboratory:
 *   active, applicable needs → their strategies (`DIMENSION_STRATEGIES`) → the library resources those strategies can realise.
 * A resource no strategy of this context can realise cannot be used: the plan validator blocks any change without an active need
 * (`unjustified_change`). Answer spaces are sized by `answer_space@v1` for every profile, not by the planner: the planner only reaches
 * them through a response-format or writing strategy.
 *
 *  - E and R: sent when they touch a general resource or an enabled one (they are the mandatory checks of the method).
 *  - A and P: sent when they only concern general resources, or when they touch an enabled specific resource.
 *  - Control cases (`perfil_C`): sent only when the context has no active need.
 */

/** Resources of the method that concern any plan, whatever the needs (conserving, own solution, purpose, rights, layout…). */
export const GENERAL_RESOURCES = new Set(["conservacion", "solucion_propia", "finalidad", "derechos", "paginacion", "maquetacion", "alcance", "orden_secuencia", "contenido_añadido", "interpretacion_perfil", "infraapoyo", "barrera_residual", "control_experimental", "identificacion"]);

const SPACES = ["espacios", "cuadricula_renglones", "pista_por_espacio", "alineacion", "cajas"];

/** The library resources each platform strategy can realise in a decision. */
export const RESOURCES_BY_STRATEGY: Record<StrategyKey, readonly string[]> = {
  language_simplification: ["reformulacion"],
  text_segmentation: ["segmentacion", "rotulos_numeracion", "panel"],
  visual_load_reduction: ["imagenes"],
  spatial_organization: ["segmentacion", "rotulos_numeracion", "panel"],
  instruction_clarification: ["reformulacion", "segmentacion", "rotulos_numeracion"],
  task_sequencing: ["segmentacion", "rotulos_numeracion"],
  comprehension_support: ["marcas_tipograficas", "esquema", "panel"],
  worked_example: [],
  prior_knowledge_activation: [],
  attention_focus: ["marcas_tipograficas", "color", "panel"],
  working_memory_support: ["panel", "esquema"],
  planning_support: ["esquema"],
  response_choice: ["alternativa_respuesta", ...SPACES],
  response_format: ["alternativa_respuesta", "modalidad_entrega", "andamiaje_expresivo", ...SPACES],
  writing_load_reduction: ["alternativa_respuesta", "modalidad_entrega", ...SPACES],
  visual_support: ["esquema", "color", "imagenes"],
  vocabulary_support: [],
  pacing: ["segmentacion"],
  self_regulation: [],
  extension: [],
};

export type PrecedentReason = "mandatory" | "general" | "resource" | "control";

export interface PrecedentSelection {
  /** Specific resources enabled by this context (the general ones are always available). */
  resources: string[];
  included: Array<{ id: string; reason: PrecedentReason }>;
  excluded: Array<{ id: string; reason: "resource_not_enabled" | "control_with_needs" }>;
}

export function possibleResources(analysis: Pick<MaterialAnalysis, "visuals">, context: Pick<AdaptationContext, "needs">): Set<string> {
  const out = new Set<string>();
  for (const need of context.needs) for (const strategy of DIMENSION_STRATEGIES[need.dimension]) for (const r of RESOURCES_BY_STRATEGY[strategy]) out.add(r);
  // Images can only be dealt with when the sheet has some.
  if (analysis.visuals.length === 0) out.delete("imagenes");
  if (context.needs.length === 0) out.add("perfil_C");
  return out;
}

export function selectPrecedents(index: readonly PrecedentEntry[], analysis: Pick<MaterialAnalysis, "visuals">, context: Pick<AdaptationContext, "needs">): PrecedentSelection {
  const enabled = possibleResources(analysis, context);
  const included: PrecedentSelection["included"] = [];
  const excluded: PrecedentSelection["excluded"] = [];
  for (const c of index) {
    if (c.recursos.includes("perfil_C")) {
      if (enabled.has("perfil_C")) included.push({ id: c.id, reason: "control" });
      else excluded.push({ id: c.id, reason: "control_with_needs" });
      continue;
    }
    const general = c.recursos.some((r) => GENERAL_RESOURCES.has(r));
    const onlyGeneral = c.recursos.every((r) => GENERAL_RESOURCES.has(r));
    const specific = c.recursos.some((r) => enabled.has(r));
    const mandatory = c.tipo === "error_corregido" || c.tipo === "alternativa_rechazada";
    if (mandatory && (general || specific)) included.push({ id: c.id, reason: "mandatory" });
    else if (specific) included.push({ id: c.id, reason: "resource" });
    else if (onlyGeneral) included.push({ id: c.id, reason: "general" });
    else excluded.push({ id: c.id, reason: "resource_not_enabled" });
  }
  return { resources: [...enabled].sort(), included, excluded };
}
