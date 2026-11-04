import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { PrecedentEntry } from "./types";

/**
 * Which precedents of the private library travel with one planner request (ADR-045), ported from the laboratory's selection and
 * adapted to the platform. Every corrected error and rejected alternative goes always: they are mandatory checks. Accepted and
 * pending cases go when they touch a resource this sheet and these needs make possible. The laboratory also filtered by the pilot
 * profile (A, B or C); real profiles are not those, so that filter is dropped and the selection only errs on the side of sending more.
 */

/** Resources any plan may touch, whatever the sheet. */
const GENERAL = ["conservacion", "solucion_propia", "finalidad", "derechos", "paginacion", "maquetacion", "alcance", "orden_secuencia", "contenido_añadido", "interpretacion_perfil", "infraapoyo", "barrera_residual", "control_experimental", "identificacion"];
/** Answer spaces exist on every sheet with a written answer (`answer_space@v1` sizes them for every profile). */
const ANSWER_SPACES = ["espacios", "cuadricula_renglones", "pista_por_espacio", "alineacion", "cajas"];

const BY_NEED: Array<{ needs: DimensionKey[]; resources: string[] }> = [
  { needs: ["writing_amount", "fine_motor_demand", "alternative_response", "expressive_language_support", "selection_based_response", "reduced_copying"], resources: ["alternativa_respuesta", "modalidad_entrega", "andamiaje_expresivo"] },
  { needs: ["reading_chunk_size", "instruction_chunking", "working_memory_support", "planning_support", "text_length", "sentence_length", "explicit_expectations"], resources: ["segmentacion", "panel", "reformulacion", "rotulos_numeracion"] },
  { needs: ["planning_support", "visual_support", "key_idea_highlighting", "visual_math_support"], resources: ["esquema"] },
  { needs: ["emphasis_support", "key_idea_highlighting", "color_dependency", "high_contrast"], resources: ["marcas_tipograficas", "color"] },
];

export interface PrecedentSelection {
  resources: string[];
  included: Array<{ id: string; reason: "mandatory" | "resource" | "control" }>;
  excluded: string[];
}

export function possibleResources(analysis: MaterialAnalysis, context: Pick<AdaptationContext, "needs">): Set<string> {
  const out = new Set(GENERAL);
  if (analysis.activities.some((a) => a.response_format !== "none")) for (const r of ANSWER_SPACES) out.add(r);
  if (analysis.visuals.length > 0) out.add("imagenes");
  const needs = new Set(context.needs.map((n) => n.dimension));
  for (const rule of BY_NEED) if (rule.needs.some((n) => needs.has(n))) for (const r of rule.resources) out.add(r);
  if (needs.size === 0) out.add("perfil_C");
  return out;
}

export function selectPrecedents(index: readonly PrecedentEntry[], analysis: MaterialAnalysis, context: Pick<AdaptationContext, "needs">): PrecedentSelection {
  const resources = possibleResources(analysis, context);
  const included: PrecedentSelection["included"] = [];
  const excluded: string[] = [];
  for (const c of index) {
    if (c.tipo === "error_corregido" || c.tipo === "alternativa_rechazada") included.push({ id: c.id, reason: "mandatory" });
    else if (c.recursos.includes("perfil_C") && resources.has("perfil_C")) included.push({ id: c.id, reason: "control" });
    else if (c.recursos.some((r) => r !== "perfil_C" && resources.has(r))) included.push({ id: c.id, reason: "resource" });
    else excluded.push(c.id);
  }
  return { resources: [...resources].sort(), included, excluded };
}
