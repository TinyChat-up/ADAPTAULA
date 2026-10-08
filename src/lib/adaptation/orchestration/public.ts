import type { ServiceError } from "./service";

/**
 * What the web layer tells the user for each application error. Short, in Spanish, and generic on purpose: never a provider's
 * message, SQL, a stack, an id or anything about another workspace. `status` is the HTTP code for Route Handlers.
 */
export const PUBLIC_SERVICE_ERRORS: Readonly<Record<ServiceError, { status: number; message: string }>> = {
  forbidden: { status: 404, message: "No hemos encontrado esa adaptación." }, // a role without permission looks like "not found"
  not_found: { status: 404, message: "No hemos encontrado esa adaptación." },
  invalid: { status: 422, message: "Revisa los datos y vuelve a intentarlo." },
  stale_analysis: { status: 409, message: "El análisis del material ha cambiado. Vuelve a crear la adaptación." },
  invalid_state: { status: 409, message: "Esta adaptación no está en un estado en el que se pueda hacer eso." },
  stale_review: { status: 409, message: "La propuesta cambió mientras la revisabas. Recárgala y revísala de nuevo." },
  review_required: { status: 409, message: "Antes de generar la ficha tienes que revisar la propuesta." },
  unsupported_execution: { status: 409, message: "Alguna decisión aprobada no se puede aplicar todavía. Revisa la propuesta." },
  action_required: { status: 409, message: "Esta adaptación necesita tu decisión antes de continuar." },
  retry_exhausted: { status: 409, message: "Ya se ha reintentado varias veces. Cancela la adaptación o contacta con soporte." },
  entitlement_exhausted: { status: 402, message: "Has alcanzado el límite de adaptaciones de tu plan." },
  entitlement_unavailable: { status: 503, message: "No podemos comprobar ahora el límite de tu plan. Inténtalo más tarde." },
  entitlement_not_reserved: { status: 409, message: "Esta adaptación no tiene una unidad de tu plan reservada." },
  generation_limit: { status: 409, message: "Ya se han preparado tres versiones de esta ficha. La última se conserva; para intentarlo de nuevo, crea una adaptación nueva desde el material." },
  failure_budget: { status: 429, message: "Ha habido demasiados intentos fallidos en poco tiempo. Vuelve a intentarlo dentro de unas horas." },
};

export type PublicResult<T> = { ok: true; data: T } | { ok: false; code: ServiceError; message: string };

export function toPublic<T>(result: { ok: true; data: T } | { ok: false; code: ServiceError }): PublicResult<T> {
  return result.ok ? result : { ok: false, code: result.code, message: PUBLIC_SERVICE_ERRORS[result.code].message };
}
