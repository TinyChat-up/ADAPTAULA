import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdaptationActions } from "@/components/adaptation/adaptation-view";
import { AdaptationView } from "@/components/adaptation/adaptation-view";
import { DecisionCard } from "@/components/adaptation/decision-card";
import { PlanReviewForm } from "@/components/adaptation/plan-review-form";
import { BlockedPanel, CancelControl, FailedPanel, ReadyPanel } from "@/components/adaptation/status-panels";
import { initialFormState } from "@/lib/adaptation/presentation/review-form";
import { INFERRED_ANSWER, PLANNER_NOTE, awaitingReview, context, decisions, plan, ready, status } from "../support/adaptation-ui-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const html = (element: ReactElement) => renderToStaticMarkup(element);
/** What a person reads (and what a screen reader announces): markup, attributes and class names removed. */
const visible = (markup: string) => markup.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const noop = async () => {
  throw new Error("an action ran during render");
};
const actions: AdaptationActions = { start: noop, submit: noop, generate: noop, reopen: noop, retry: noop, cancel: noop };
const view = (dto = status(), extra: { plan?: typeof plan | null; readyInfo?: { version: number; createdAt: string } | null; canWrite?: boolean } = {}) =>
  html(createElement(AdaptationView, { initial: dto, plan: extra.plan ?? null, context, readyInfo: extra.readyInfo ?? null, actions, canWrite: extra.canWrite ?? true }));
const form = () => html(createElement(PlanReviewForm, { plan, context, deferredIds: ["dec_4"], submit: noop, onSaved: () => {}, onRefresh: () => {} }));

const DIAGNOSIS = /diagn|dislex|tdah|autis|discapacidad|trastorno/i;
const TECHNICAL = /need_\d|\bdec_\d|\bact_\d|ctt_\d|prt_\d|\bR1\b|\bblk_|unsupported|undefined|\[object/;

describe("queued: the first action", () => {
  it("offers the single CTA, no spinner without text and no cancel-less dead end", () => {
    const out = view();
    expect(out).toContain("Preparar propuesta de adaptación");
    expect(out).toContain("Cancelar adaptación");
    expect(visible(out)).not.toMatch(/\bIA\b|inteligencia artificial/);
    expect(out).toContain("5 actividades");
  });
});

describe("work states: plain text, no promises, cancel only if the server allows it", () => {
  it.each([
    ["planning", status({ status: "planning", progress: "planning", nextAction: "none" }), "Estamos preparando una propuesta de adaptación."],
    ["generating", status({ status: "generating", progress: "generating", nextAction: "none" }), "Estamos creando el material con los cambios que has aprobado."],
    ["reviewing", status({ status: "reviewing_ai", progress: "reviewing", nextAction: "none" }), "Estamos comprobando que se mantienen los objetivos y que las ayudas no revelan respuestas."],
  ])("%s", (_n, dto, copy) => {
    const out = view(dto);
    expect(out).toContain(copy);
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('aria-current="step"');
    expect(visible(out)).not.toMatch(/\d+ ?%|minutos|segundos/);
    expect(out).toContain("Cancelar adaptación");
  });

  it("no cancel control when canCancel is false", () => {
    expect(view(status({ status: "planning", progress: "planning", nextAction: "none", canCancel: false }))).not.toContain("Cancelar adaptación");
  });

  it("generation waiting for the person shows the CTA, and generation is never started by rendering", () => {
    const out = view(status({ status: "generation_queued", nextAction: "start_generation" }));
    expect(out).toContain("Crear material adaptado");
  });
});

describe("plan review: every decision, in teacher language", () => {
  const out = form();

  it("shows the summary and every decision, one fieldset each", () => {
    expect(out).toContain("Adaptaula propone 5 cambios. Revísalos antes de crear la ficha.");
    expect(out.match(/<fieldset/g)).toHaveLength(decisions.length);
    expect(out.match(/<legend/g)).toHaveLength(decisions.length);
    expect(out).toContain("3 recomendados · 1 requieren tu atención · 1 no aplicables tal cual");
  });

  it("explains where, what, why and what is kept", () => {
    expect(out).toContain("Actividad 1 · Reformular");
    expect(out).toContain("Todo el documento · Dividir en partes");
    expect(out).toContain("Responde a: Ajuste del nivel de lectura");
    expect(out).toContain("Se mantendrá: 150-180 palabras con tesis, al menos dos argumentos y conclusión");
    expect(out).toContain("Debe mantenerse: ");
    expect(out).toContain("Ayudas: Lista de comprobación, Planificador");
    expect(out).toContain("Se aplicará al preparar la presentación final.");
  });

  it("never shows an inferred answer, the planner's note, validator messages, ids or technical keys", () => {
    expect(out).not.toContain(INFERRED_ANSWER);
    expect(out).not.toContain(PLANNER_NOTE);
    expect(out).not.toContain("MENSAJE_TECNICO");
    expect(visible(out)).not.toMatch(TECHNICAL);
    expect(out).toContain("Convertiría una tarea abierta en una cerrada.");
  });

  it("never shows diagnosis language", () => expect(visible(out)).not.toMatch(DIAGNOSIS));

  it("a blocked decision cannot be approved: the option is disabled and the reason is explained", () => {
    const card = html(createElement(DecisionCard, { decision: decisions[4]!, index: 4, context, draft: initialFormState(plan)["dec_5"]!, problem: undefined, deferred: false, disabled: false, onChoose: () => {}, onEdit: () => {} }));
    expect(card).toMatch(/<input[^>]*disabled=""[^>]*value="approve"/);
    expect(card).not.toMatch(/<input[^>]*disabled=""[^>]*value="reject"/);
    expect(card).toContain("No aplicable tal cual");
    expect(card).toContain("pero no aprobar");
  });

  it("nothing is preselected for valid or review decisions (a conscious choice is needed)", () => {
    const card = html(createElement(DecisionCard, { decision: decisions[2]!, index: 2, context, draft: initialFormState(plan)["dec_3"]!, problem: "missing_choice", deferred: false, disabled: false, onChoose: () => {}, onEdit: () => {} }));
    expect(card).not.toContain("checked");
    expect(card).toContain("Elige qué hacer con este cambio.");
    expect(card).toContain('aria-describedby="');
  });

  it("the editor offers structured, translated controls only", () => {
    const state = initialFormState(plan);
    const card = html(createElement(DecisionCard, { decision: decisions[1]!, index: 1, context, draft: { ...state["dec_2"]!, choice: "edit" }, problem: undefined, deferred: false, disabled: false, onChoose: () => {}, onEdit: () => {} }));
    expect(card).toContain("Ajustar este cambio");
    expect(card).toContain("Reformular");
    expect(card).toContain("Cambio moderado");
    expect(card).toContain("Lista de comprobación");
    expect(card).toContain("Forma de responder");
    expect(visible(card)).not.toMatch(/language_simplification|change_response_format|write_text|select_option|moderate|substantial/);
    expect(card).toMatch(/<label[^>]*for="[^"]+"[^>]*>Nota para este cambio/);
  });

  it("has an explicit submit, labelled, with a live count of what is left", () => {
    expect(out).toContain("Guardar revisión");
    expect(out).toContain("Te quedan 4 cambios por revisar.");
    expect(out).toContain('type="submit"');
    expect(out).toContain('aria-labelledby="plan-review-title"');
  });
});

describe("preservations and limits come from the decision itself", () => {
  const one = (i: number) => html(createElement(DecisionCard, { decision: decisions[i]!, index: i, context, draft: initialFormState(plan)[decisions[i]!.id]!, problem: undefined, deferred: false, disabled: false, onChoose: () => {}, onEdit: () => {} }));

  it("5/9 · shows what the decision keeps, in teacher wording, from the decision's own protected requirements", () => {
    const out = visible(one(1));
    expect(out).toContain("Se mantendrá");
    expect(out).toContain("Se mantendrá: 150-180 palabras con tesis, al menos dos argumentos y conclusión");
    expect(out).toContain("El razonamiento seguirá siendo del alumnado: Tesis con palabras propias y dos argumentos");
  });

  it("6 · shows the specific limits of a help: the reviewer's and what a help must not replace", () => {
    const out = visible(one(1));
    expect(out).toContain("Límites de esta ayuda");
    expect(out).toContain("Puede organizar los pasos, pero no sugerir la tesis ni los argumentos.");
    expect(out).toContain("La ayuda no debe resolver ni sustituir: Tesis con palabras propias y dos argumentos");
  });

  it("limits also appear on review and blocked decisions, without raw validator text", () => {
    const blocked = visible(one(4));
    expect(blocked).toContain("Límites de este cambio");
    expect(blocked).toContain("No debe indicar cuál es el registro correcto.");
    expect(blocked).toContain("Se mantiene el criterio de evaluación: Justificar el registro");
    expect(blocked).not.toMatch(/MENSAJE_TECNICO|activity_removed/);
    expect(visible(one(2))).toContain("El alumnado seguirá teniendo que: Formular la tesis con palabras propias");
  });

  it("8 · the inferred answer is nowhere in the screen, even when it sits in an internal field of the decision", () => {
    const everything = form() + [0, 1, 2, 3, 4].map(one).join("");
    expect(everything).not.toContain(INFERRED_ANSWER);
    expect(everything).not.toContain(PLANNER_NOTE);
  });

  it("a decision with nothing specific falls back to the analysis-level context, and shows no empty sections", () => {
    const out = visible(one(0));
    expect(out).not.toContain("Límites");
  });
});

describe("page states built from the server's data", () => {
  it("awaiting review renders the form from the server-provided plan (no empty flash)", () => {
    const out = view(awaitingReview(), { plan });
    expect(out).toContain("Guardar revisión");
    expect(out).toContain("Necesidades que se tienen en cuenta: Ajuste del nivel de lectura");
  });

  it("an awaiting-review adaptation whose plan is missing says so with a way to refresh, not an empty page", () => {
    expect(view(awaitingReview())).toContain("Actualizar propuesta");
  });

  it("once the review is saved the server moves on: the page shows 'Crear material adaptado' with the presentation note, never auto-started", () => {
    const out = view(status({ status: "generation_queued", nextAction: "start_generation", hasPlanReview: true, execution: { aiDecisions: 3, deferredDecisions: ["dec_4"], blockers: [] } }));
    expect(out).toContain("Crear material adaptado");
    expect(out).toContain("Se aplicará al preparar la presentación final.");
    expect(out).not.toContain("Guardar revisión");
  });
});

describe("read-only members", () => {
  it("see every state but no command: no start, no review form, no generate, no retry, no cancel", () => {
    const starting = view(status({ status: "queued", nextAction: "start_planning" }), { canWrite: false });
    expect(starting).toContain("solo lectura");
    expect(starting).not.toContain("Preparar propuesta de adaptación");
    expect(starting).not.toContain("Cancelar adaptación");
    const reviewing = view(status({ status: "awaiting_plan_review", phase: "awaiting_review", progress: "awaiting_review", nextAction: "review_plan" }), { canWrite: false, plan });
    expect(reviewing).toContain("Esperando tu revisión");
    expect(reviewing).not.toContain("Guardar revisión");
    const generate = view(status({ status: "generation_queued", nextAction: "start_generation" }), { canWrite: false });
    expect(generate).not.toContain("Crear material adaptado");
    const failed = view(status({ status: "failed", phase: "recoverable_failure", progress: "failed", nextAction: "retry", canRetry: true, error: { code: "provider_unavailable", category: "retryable", message: "" } as never }), { canWrite: false });
    expect(failed).not.toMatch(/>Reintentar<|Cancelar adaptación/);
    const done = view(ready(), { canWrite: false });
    expect(done).toContain("Ver la ficha");
    expect(done).toContain("Descargar PDF");
  });
});

describe("result screens", () => {
  it("ready: success, version and date, the sheet and its PDF as next steps, no document, no fake rendering", () => {
    const out = view(ready(), { readyInfo: { version: 2, createdAt: "2026-10-05T10:30:00Z" } });
    expect(out).toContain("La adaptación está preparada");
    expect(out).toContain("Versión 2");
    expect(out).toContain("Ver la ficha");
    expect(out).toContain("Descargar PDF");
    expect(out).not.toContain("siguiente paso");
    expect(out).toContain("Volver al material");
    expect(out).not.toMatch(/"blocks"|schema_version|<table|<img|MaterialDocument/);
    expect(out).not.toContain("Cancelar adaptación");
  });

  it("approved with warnings: observations in teacher language, never a check name", () => {
    const dto = ready({
      warningsCount: 2,
      review: { verdict: "approved_with_warnings", pendingJudgments: [], warnings: [
        { check: "traceability_complete", status: "WARN", detail: "R1 blk_abc12345", method: "deterministic" },
        { check: "functional_supports_applied", status: "WARN", detail: "need_3", method: "ai" },
      ] },
      execution: { aiDecisions: 3, deferredDecisions: ["dec_4"], blockers: [] },
    });
    const out = view(dto);
    expect(out).toContain("Material preparado con observaciones");
    expect(out).toContain("Hay una ayuda repetida");
    expect(out).toContain("no queda del todo cubierta");
    expect(out).toContain("presentación final");
    expect(visible(out)).not.toMatch(TECHNICAL);
    expect(out).not.toContain("traceability_complete");
  });

  it("blocked: clearly not ready, no 'ready' wording, a way back to the review when the server allows it", () => {
    const dto = status({ status: "blocked", phase: "blocked", progress: "blocked", nextAction: "review_plan" });
    const out = html(createElement(BlockedPanel, { dto, materialId: context.materialId, busy: false, canWrite: true, onReopen: () => {} }));
    expect(out).toContain("Este material todavía no está listo");
    expect(out).toContain("No se ha entregado ninguna ficha");
    expect(out).toContain("Revisar la propuesta");
    expect(out).not.toMatch(/preparada|Versión/);
    expect(html(createElement(BlockedPanel, { dto: { ...dto, nextAction: "none" }, materialId: context.materialId, busy: false, canWrite: true, onReopen: () => {} }))).not.toContain("Revisar la propuesta");
  });

  it("retryable failure: 'Reintentar' directly; terminal failure: no retry", () => {
    const retryable = status({ status: "failed", phase: "recoverable_failure", progress: "failed", nextAction: "retry", canRetry: true, error: { code: "generator_schema", category: "retryable", message: "x" } });
    const out = view(retryable);
    expect(out).toContain("Reintentar");
    expect(out).toContain("Puedes volver a intentarlo.");
    const terminal = status({ status: "failed", phase: "action_required", progress: "failed", nextAction: "cancel", canRetry: false, error: { code: "provider_refusal", category: "non_retryable", message: "El servicio no ha podido procesar este material." } });
    const t = view(terminal);
    expect(t).not.toContain("Reintentar");
    expect(t).toContain("El servicio no ha podido procesar este material.");
    expect(t).toContain("Cancelar adaptación");
  });

  it("ambiguous attempt: neutral warning, the retry sits behind a confirmation that says the process will be repeated", () => {
    const dto = status({ status: "failed", phase: "action_required", progress: "failed", nextAction: "retry", canRetry: true, ambiguousAttempt: true, error: { code: "ambiguous_attempt", category: "human_action_required", message: "x" } });
    const out = html(createElement(FailedPanel, { dto, materialId: context.materialId, busy: false, onRetry: () => {}, cancel: createElement(CancelControl, { busy: false, onCancel: () => {} }) }));
    expect(out).toContain("No se pudo confirmar el resultado del último intento.");
    expect(out).toContain("<dialog");
    expect(out).toContain("Se repetirá el procesamiento de este paso.");
    expect(out).not.toMatch(/proveedor|cobr|factur|coste|token/i);
  });

  it("cancelling asks for confirmation with the exact copy; once cancelled nothing offers generation", () => {
    const out = html(createElement(CancelControl, { busy: false, onCancel: () => {} }));
    expect(out).toContain("<dialog");
    expect(out).toContain("Se detendrá esta adaptación. Si aún no se había entregado, no contará como una adaptación utilizada.");
    const cancelled = view(status({ status: "cancelled", phase: "cancelled", progress: "cancelled", nextAction: "none", canCancel: false }));
    expect(cancelled).toContain("Adaptación cancelada");
    expect(cancelled).not.toMatch(/Crear material adaptado|Preparar propuesta|Guardar revisión|Reintentar/);
  });

  it("ready panel alone never renders anything but the temporary summary", () => {
    const out = html(createElement(ReadyPanel, { dto: ready(), materialId: context.materialId, info: null }));
    expect(out).not.toMatch(/<(table|img|canvas|iframe)/);
  });
});
