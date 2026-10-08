import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdaptationView, type AdaptationActions } from "@/components/adaptation/adaptation-view";
import { PlanReviewForm } from "@/components/adaptation/plan-review-form";
import { StartAdaptationCard } from "@/components/adaptation/start-adaptation-card";
import { BlockedPanel, WorkingPanel } from "@/components/adaptation/status-panels";
import { buildStatusDto } from "@/lib/adaptation/orchestration/status";
import type { PipelineSnapshot } from "@/lib/adaptation/orchestration/store";
import { CREATION_COPY, STAGES } from "@/lib/adaptation/presentation/copy";
import { buildReview, initialFormState } from "@/lib/adaptation/presentation/review-form";
import { screenFor, stageStates } from "@/lib/adaptation/presentation/view-model";
import { createRunDispatcher } from "@/lib/jobs/run-dispatcher";
import { awaitingReview, context, plan, status } from "../support/adaptation-ui-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const html = (element: ReactElement) => renderToStaticMarkup(element);
const visible = (markup: string) => markup.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const noop = async () => {
  throw new Error("an action ran during render");
};
const actions: AdaptationActions = { start: noop, submit: noop, generate: noop, reopen: noop, retry: noop, cancel: noop };
const view = (dto = status(), extra: { plan?: typeof plan | null; canWrite?: boolean } = {}) =>
  html(createElement(AdaptationView, { initial: dto, plan: extra.plan ?? null, context, readyInfo: null, actions, canWrite: extra.canWrite ?? true }));
const card = (props: Partial<Parameters<typeof StartAdaptationCard>[0]> = {}) =>
  html(createElement(StartAdaptationCard, { profiles: [{ id: "p1", name: "Grupo lectura" }, { id: "p2", name: "Grupo atención" }], canWrite: true, newProfileHref: "/app/alumnos/nuevo", create: noop, ...props }));

/** Words that belong to the machinery, never to the teacher's screen («Planificador» is a kind of help, so it is allowed). */
const INTERNAL = /planner|generator|reviewer|revisor|\bjob\b|\bcola\b|queue|schema|pipeline|\bmodelo\b|token|\d+ ?%/i;

describe("A · creation screen: «¿Cómo quieres preparar esta ficha?»", () => {
  it("offers «Hacer magia» as the primary, recommended action and «Revisar antes de crear» as the secondary one, with the exact copy", () => {
    const out = card({ initialProfileId: "p2" });
    expect(out).toContain(CREATION_COPY.question);
    expect(CREATION_COPY.question).toBe("¿Cómo quieres preparar esta ficha?");
    expect(out).toContain("Hacer magia");
    expect(out).toContain("Adaptaula usará el perfil del alumno para preparar y revisar la ficha automáticamente.");
    expect(out).toContain("Revisar antes de crear");
    expect(out).toContain("Revisa cómo se adaptará el material y cambia lo que necesites antes de crear la ficha.");
    expect(out).toContain("Recomendado.");
    // Primary first, secondary styled as such; both are real buttons described by their copy.
    expect(out.indexOf("Hacer magia")).toBeLessThan(out.indexOf("Revisar antes de crear"));
    const buttons = [...out.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain("bg-primary");
    expect(buttons[1]).not.toContain("bg-primary");
    expect(buttons.every((b) => b.includes("aria-describedby="))).toBe(true);
    expect(visible(out)).not.toMatch(INTERNAL);
  });

  it("J · a known profile is preselected (no re-asking); with a single profile it is chosen already", () => {
    expect(card({ initialProfileId: "p2" })).toMatch(/<option value="p2" selected="">/);
    expect(card({ profiles: [{ id: "only", name: "Único" }] })).toMatch(/<option value="only" selected="">/);
    expect(card()).toMatch(/<option value="" selected="">/);
  });

  it("I · the profile is the source of truth: no clinical field, no free text about the learner", () => {
    const out = card({ initialProfileId: "p1" });
    expect(out).not.toMatch(/<textarea|type="text"|type="date"/);
    expect(visible(out)).not.toMatch(/diagn|dislex|tdah|autis|discapacidad|trastorno|informe|médic/i);
    expect(out).toContain("Solo se tienen en cuenta sus necesidades, nunca el nombre.");
  });

  it("K · read-only: no magic, no creation", () => {
    const out = card({ canWrite: false });
    expect(out).not.toContain("Hacer magia");
    expect(out).not.toContain("Revisar antes de crear");
    expect(out).not.toContain("<button");
    expect(out).toContain("solo lectura");
  });

  it("without profiles: the way to create one, not the two paths", () => {
    const out = card({ profiles: [] });
    expect(out).toContain("Crear un perfil");
    expect(out).not.toContain("Hacer magia");
  });
});

const snapshot = (over: Partial<PipelineSnapshot["adaptation"]> = {}, jobs: PipelineSnapshot["jobs"] = []): PipelineSnapshot =>
  ({
    adaptation: { id: "11111111-1111-4111-8111-111111111111", workspace_id: "w", material_id: "m", learner_profile_id: null, title: "t", adaptation_type: "accessibility", status: "awaiting_plan_review", current_version: 0, pipeline_versions: null, context_snapshot: null, context_fingerprint: null, analysis_fingerprint: null, failure_code: null, delivered_at: null, created_at: "2026-10-08T00:00:00Z", creation_mode: "automatic", ...over },
    analysis: { analysis: null, prompt_version: null, status: "analyzed" },
    jobs,
  }) as PipelineSnapshot;

describe("B/C/H · the status the screen reads", () => {
  it("an automatic adaptation with a fresh plan is still working (the server crosses the gate); nobody is asked to review", () => {
    const dto = buildStatusDto(snapshot(), { hasPlanReview: false });
    expect(dto).toMatchObject({ creationMode: "automatic", phase: "working", nextAction: "none", progress: "planning" });
    expect(screenFor(dto)).toBe("working");
  });

  it("once a review exists (not executable, or reopened after a block) the person decides, in both modes", () => {
    expect(buildStatusDto(snapshot(), { hasPlanReview: true })).toMatchObject({ phase: "awaiting_review", nextAction: "review_plan" });
    expect(buildStatusDto(snapshot({ creation_mode: "review" }), { hasPlanReview: false })).toMatchObject({ phase: "awaiting_review", nextAction: "review_plan", creationMode: "review" });
  });

  it("progress in product language: the stages, in order, without the review step for magic, and never a percentage", () => {
    const magic = stageStates("generating", { mode: "automatic" });
    expect(magic.map((s) => s.label)).toEqual(["Analizando el material", "Preparando la adaptación", "Creando la ficha", "Revisando el resultado", "Lista"]);
    expect(magic.map((s) => s.state)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(stageStates("generating", { mode: "review" }).map((s) => s.label)).toContain("Tu revisión");
    expect(stageStates("preparing", { mode: "automatic", generationQueued: true }).find((s) => s.state === "active")?.label).toBe("Creando la ficha");
    expect(stageStates("ready", { mode: "automatic" }).every((s) => s.state === "done")).toBe(true);
    expect(STAGES.map((s) => s.label).join(" ")).not.toMatch(INTERNAL);
  });

  it("the working screen of a magic adaptation shows those stages and no internal word", () => {
    const out = html(createElement(WorkingPanel, { dto: status({ status: "generating", progress: "generating", nextAction: "none", creationMode: "automatic" }), offline: false, cancel: null }));
    expect(out).toContain("Creando la ficha");
    expect(out).toContain('aria-current="step"');
    expect(out).not.toContain("Tu revisión");
    expect(visible(out)).not.toMatch(INTERNAL);
  });
});

describe("D · the reviewer blocks", () => {
  const dto = status({ status: "blocked", phase: "blocked", progress: "blocked", nextAction: "review_plan", creationMode: "automatic", generationsUsed: 1 });

  it("says the sheet needs a review, simply, with «Revisar adaptación»; no download, no internal words", () => {
    const out = html(createElement(BlockedPanel, { dto, materialId: context.materialId, busy: false, canWrite: true, onReopen: () => {} }));
    expect(out).toContain("La ficha necesita una revisión antes de estar lista");
    expect(out).toContain("Revisar adaptación");
    expect(out).not.toContain("Descargar PDF");
    expect(visible(out)).not.toMatch(INTERNAL);
  });

  it("read-only: the state, without the action that would be refused", () => {
    expect(view(dto, { canWrite: false })).not.toContain("Revisar adaptación");
  });
});

describe("E/F · «Así prepararemos esta ficha»", () => {
  const form = (intro?: string) => html(createElement(PlanReviewForm, { plan, context, deferredIds: [], submit: noop, onSaved: () => {}, onRefresh: () => {}, intro }));

  it("shows every real decision of the plan with what will happen, «Cambiar» on each, and «Crear ficha»", () => {
    const out = form();
    expect(out).toContain("Así prepararemos esta ficha");
    expect(out.match(/>Cambiar<\/button>/g)).toHaveLength(plan.decisions.length);
    expect(out).toContain("Crear ficha");
    expect(visible(out)).toContain("No se aplicará"); // the blocked decision, as information
    expect(visible(out)).not.toMatch(INTERNAL);
  });

  it("«Crear ficha» untouched submits the recommendation: the same review «Hacer magia» applies", () => {
    const review = buildReview(plan, initialFormState(plan));
    expect(review.entries.map((e) => [e.decision_id, e.action])).toEqual(plan.decisions.map((d) => [d.id, d.status === "blocked" ? "rejected" : "approved"]));
  });

  it("after a magic adaptation could not be finished automatically, or after a block, it explains why the teacher is here", () => {
    const fallback = view(status({ ...awaitingReview(), creationMode: "automatic", hasPlanReview: true }), { plan });
    expect(fallback).toContain("No hemos podido preparar la ficha automáticamente.");
    const afterBlock = view(status({ ...awaitingReview(), creationMode: "automatic", hasPlanReview: true, generationsUsed: 1 }), { plan });
    expect(afterBlock).toContain("Corrige lo que necesites y vuelve a crear la ficha.");
    expect(view(awaitingReview(), { plan })).not.toMatch(/No hemos podido preparar la ficha automáticamente|Corrige lo que necesites/);
  });

  it("read-only members see the state but no «Crear ficha» and no «Cambiar»", () => {
    const out = view(awaitingReview(), { plan, canWrite: false });
    expect(out).not.toContain("Crear ficha");
    expect(out).not.toContain(">Cambiar<");
  });
});

describe("C · the screen runs the next stage as soon as the previous one queued it", () => {
  it("onResult → true asks for one more run right after, without waiting for the interval", async () => {
    const answers = ["generation_queued", "ready"];
    const run = vi.fn(async () => answers.shift() ?? null);
    const seen: string[] = [];
    const d = createRunDispatcher<string>({ run, onResult: (r) => (seen.push(r), r === "generation_queued"), now: () => 0 });
    d.kick(true);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(seen).toEqual(["generation_queued", "ready"]);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
