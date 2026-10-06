import { describeValidationError, type ValidationCode } from "./file-validation";
import type { MaterialLimits } from "./config";
import type { ServiceError } from "./service-errors";

/** What the teacher reads for each service failure. Human, specific when it helps, never technical. */
export function describeServiceError(code: ServiceError, limits?: MaterialLimits): string {
  switch (code) {
    case "forbidden":
      return "Tu rol no permite subir o modificar materiales.";
    case "not_found":
      return "No hemos encontrado ese material.";
    case "rate_limited":
      return "Has enviado muchos archivos en poco tiempo. Espera unos minutos e inténtalo de nuevo.";
    case "too_many_active":
      return "Ya tienes varios materiales en análisis. Espera a que terminen para enviar más.";
    case "quota_exceeded":
      return "Has utilizado los análisis incluidos en tu plan este mes.";
    case "unexpected":
      return "No hemos podido procesar el archivo. Inténtalo de nuevo en unos minutos.";
    default:
      return describeValidationError(code as ValidationCode, limits);
  }
}

export function statusCodeFor(code: ServiceError): number {
  switch (code) {
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
    case "too_many_active":
    case "quota_exceeded":
      return 429;
    case "unexpected":
      return 500;
    default:
      return 422;
  }
}

/** Copy for a monthly analysis quota that is used up (docs/BILLING.md): says what happened, when it renews, never a code. */
export function analysisQuotaMessage(limit: number, renewsOn: string): string {
  const included = limit === 1 ? "el análisis incluido" : `los ${limit} análisis incluidos`;
  return `Has utilizado ${included} este mes. Se renuevan el ${renewsOn}.`;
}
