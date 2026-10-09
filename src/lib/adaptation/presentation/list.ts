/**
 * How an adaptation reads in a LIST (home, history, a material, a profile): one product label and one group, from the stored status
 * and whether one of its stages is running now. The same rule as the adaptation screen (`buildStatusDto`): a `queued` or
 * `generation_queued` adaptation with no running job is waiting for the teacher's explicit decision («Empezar», «Generar»), never
 * "in progress". No job, attempt or provider wording ever leaves here.
 */

export type ListGroup = "attention" | "working" | "done" | "closed";

export interface ListState {
  label: string;
  group: ListGroup;
  /** What the teacher does next from the list, when there is something to do. */
  cta: string;
}

const PREPARING: ListState = { label: "Preparando la adaptación", group: "working", cta: "Ver progreso" };

const STATES: Record<string, (running: boolean, automaticPending: boolean) => ListState> = {
  queued: (running) => (running ? PREPARING : { label: "Pendiente de empezar", group: "attention", cta: "Empezar" }),
  planning: () => PREPARING,
  // «Hacer magia» crosses this state by itself while its plan has no review yet: nobody is waiting for the teacher.
  awaiting_plan_review: (_running, automaticPending) => (automaticPending ? PREPARING : { label: "Esperando tu revisión", group: "attention", cta: "Revisar adaptación" }),
  generation_queued: (running) => (running ? { label: "Creando la ficha", group: "working", cta: "Ver progreso" } : { label: "Lista para crear la ficha", group: "attention", cta: "Crear ficha" }),
  generating: () => ({ label: "Creando la ficha", group: "working", cta: "Ver progreso" }),
  reviewing_deterministic: () => ({ label: "Revisando el resultado", group: "working", cta: "Ver progreso" }),
  reviewing_ai: () => ({ label: "Revisando el resultado", group: "working", cta: "Ver progreso" }),
  ready: () => ({ label: "Ficha preparada", group: "done", cta: "Ver ficha" }),
  blocked: () => ({ label: "Necesita una revisión", group: "attention", cta: "Revisar" }),
  failed: () => ({ label: "No se pudo completar", group: "attention", cta: "Ver qué pasó" }),
  cancelled: () => ({ label: "Cancelada", group: "closed", cta: "Abrir" }),
};

/** `automaticPending`: created with «Hacer magia» and its plan not reviewed yet (the server continues it; see `buildStatusDto`). */
/** `resourcePending`: delivered, but its sheet waits for an essential visual (`readinessOf`): «casi lista», never «preparada». */
export function listState(status: string, running: boolean, automaticPending = false, resourcePending = false): ListState {
  if (status === "ready" && resourcePending) return { label: "Casi lista · falta un recurso", group: "attention", cta: "Completar ficha" };
  const of = Object.prototype.hasOwnProperty.call(STATES, status) ? STATES[status] : undefined;
  return of ? of(running, automaticPending) : { label: "En curso", group: "working", cta: "Abrir" };
}

/** Where a list item leads: the finished sheet when there is one, the adaptation's own page otherwise. */
export const listHref = (id: string, state: ListState) => (state.group === "done" ? `/app/adaptaciones/${id}/vista` : `/app/adaptaciones/${id}`);
