export const RECREATION_STATES = ["ready", "review", "incomplete"] as const;
export type RecreationState = (typeof RECREATION_STATES)[number];

export const RECREATION_CHECK_COPY = {
  objectives_preserved: "Compara con el original el razonamiento que debe hacer el alumno.",
  traceability_complete: "Contrasta las respuestas propuestas con la fuente citada.",
  visual_references_resolved: "Comprueba el sentido de las flechas del esquema.",
  answers_not_leaked: "Comprueba si alguna pista permite deducir una respuesta cerrada.",
} as const;

/** A generic check name does not identify its cause. Only publish messages known to be produced by the recreation verifier. */
export function recreationWarningCopy(warning: { check: string; status: string; method: string; detail: string }): string {
  const text = Object.entries(RECREATION_CHECK_COPY).find(([check]) => check === warning.check)?.[1];
  if (warning.status === "WARN" && warning.method === "deterministic" && text === warning.detail) return text;
  return "Queda una comprobación pedagógica pendiente en esta versión.";
}

export const RECREATION_PENDING_TITLE = "Comprobaciones pedagógicas pendientes";

export const RECREATION_QUALITY_COPY = {
  ready: { title: "La ficha ha superado los controles aplicables", body: "Puedes ver la ficha y descargarla en PDF." },
  review: { title: "La ficha está generada, con comprobaciones pendientes", body: "Puedes consultar y descargar el PDF como propuesta. Las comprobaciones pendientes deben resolverse antes de utilizarla con el alumnado." },
  incomplete: { title: "La ficha está incompleta", body: "Falta un recurso necesario para poder usar la ficha." },
  unknown: { title: "La verificación pedagógica está sin confirmar", body: "Puedes consultar y descargar el PDF como propuesta. El estado de los controles de esta versión no está disponible." },
} as const;
