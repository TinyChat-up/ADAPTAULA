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

const STATES: Record<string, (running: boolean) => ListState> = {
  queued: (running) => (running ? { label: "Preparando propuesta", group: "working", cta: "Ver progreso" } : { label: "Pendiente de empezar", group: "attention", cta: "Empezar" }),
  planning: () => ({ label: "Preparando propuesta", group: "working", cta: "Ver progreso" }),
  awaiting_plan_review: () => ({ label: "Esperando tu revisión", group: "attention", cta: "Revisar propuesta" }),
  generation_queued: (running) => (running ? { label: "Preparando ficha", group: "working", cta: "Ver progreso" } : { label: "Lista para crear la ficha", group: "attention", cta: "Crear ficha" }),
  generating: () => ({ label: "Preparando ficha", group: "working", cta: "Ver progreso" }),
  reviewing_deterministic: () => ({ label: "Revisando calidad", group: "working", cta: "Ver progreso" }),
  reviewing_ai: () => ({ label: "Revisando calidad", group: "working", cta: "Ver progreso" }),
  ready: () => ({ label: "Ficha preparada", group: "done", cta: "Ver ficha" }),
  blocked: () => ({ label: "Necesita tu revisión", group: "attention", cta: "Revisar" }),
  failed: () => ({ label: "No se pudo completar", group: "attention", cta: "Ver qué pasó" }),
  cancelled: () => ({ label: "Cancelada", group: "closed", cta: "Abrir" }),
};

export function listState(status: string, running: boolean): ListState {
  const of = Object.prototype.hasOwnProperty.call(STATES, status) ? STATES[status] : undefined;
  return of ? of(running) : { label: "En curso", group: "working", cta: "Abrir" };
}

/** Where a list item leads: the finished sheet when there is one, the adaptation's own page otherwise. */
export const listHref = (id: string, state: ListState) => (state.group === "done" ? `/app/adaptaciones/${id}/vista` : `/app/adaptaciones/${id}`);
