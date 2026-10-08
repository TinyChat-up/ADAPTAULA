import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADAPTATION_ERROR_CODES } from "@/lib/adaptation/orchestration/errors";
import { PUBLIC_ERROR_MESSAGES, type AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";
import { ACTION_LABELS, CHECK_COPY, FLAG_COPY, RESPONSE_TARGET_LABELS, STATUS_COPY, SUPPORT_LABELS, actionErrorCopy, checkCopy, failureCopy, flagCopy, needLabel, strategyLabel, targetLabel } from "@/lib/adaptation/presentation/copy";
import { HIDDEN_INTERVAL_MS, MAX_BACKOFF_MS, POLL_INTERVAL_MS, createPoller, nextDelay, shouldPoll } from "@/lib/adaptation/presentation/poller";
import { buildReview, decisionsInBlockers, editsFor, formReducer, initialFormState, interpretSubmit, isRecommended, problemsOf } from "@/lib/adaptation/presentation/review-form";
import { screenFor, stageStates, warningLines } from "@/lib/adaptation/presentation/view-model";
import { ADAPTATION_ACTIONS, REVIEW_FLAGS, STRATEGY_KEYS } from "@/lib/schemas/adaptation-plan";
import { DIMENSIONS } from "@/lib/schemas/functional-profile";
import { PlanReviewSchema } from "@/lib/schemas/plan-review";
import { REVIEW_CHECKS } from "@/lib/schemas/pedagogical-review";
import { INFERRED_ANSWER, awaitingReview, context, plan, ready, status } from "../support/adaptation-ui-fixtures";

const TECHNICAL = /need_\d|dec_\d|act_\d|ctt_\d|prt_\d|R1\b|\bblk_|unsupported|deferred|undefined|\[object/i;

describe("copy layer: every key has teacher wording and unknown keys never leak", () => {
  it("covers every action, flag, check, strategy, support and response target", () => {
    for (const a of ADAPTATION_ACTIONS) expect(ACTION_LABELS[a]).toBeTruthy();
    for (const f of REVIEW_FLAGS) expect(FLAG_COPY[f]).toBeTruthy();
    for (const c of REVIEW_CHECKS) expect(CHECK_COPY[c]).toBeTruthy();
    for (const s of STRATEGY_KEYS) expect(strategyLabel(s)).not.toBe("Otra estrategia");
    expect(Object.keys(SUPPORT_LABELS).length).toBe(12);
    expect(Object.keys(RESPONSE_TARGET_LABELS).length).toBe(11);
  });

  it("an unknown warning, flag, need or target gets neutral copy, never the technical key", () => {
    for (const out of [checkCopy("R1_redundant_help"), flagCopy("brand_new_flag"), needLabel("need_42"), targetLabel("act_99"), targetLabel("zzz"), strategyLabel("mystery")]) {
      expect(out).not.toMatch(TECHNICAL);
      expect(out).not.toContain("brand_new_flag");
    }
    expect(needLabel("reading_level")).toBe(DIMENSIONS.reading_level.label);
    expect(targetLabel("document")).toBe("Todo el documento");
    expect(targetLabel("act_1", { act_1: "Actividad 1" })).toBe("Actividad 1");
  });

  it("no wording talks about diagnosis, models, tokens, costs or providers", () => {
    const all = [...Object.values(ACTION_LABELS), ...Object.values(FLAG_COPY), ...Object.values(CHECK_COPY), ...Object.values(SUPPORT_LABELS), ...Object.values(RESPONSE_TARGET_LABELS), ...Object.values(STATUS_COPY).flatMap((c) => [c.title, c.body])].join(" ");
    expect(all).not.toMatch(/diagn|dislex|tdah|autis|discapacidad|trastorno|modelo|token|coste|proveedor|anthropic|openai|\bIA\b/i);
  });

  it("every server error code has a message and the quota codes keep distinct, exact copy", () => {
    for (const code of ADAPTATION_ERROR_CODES) expect(failureCopy({ code, category: "retryable", message: PUBLIC_ERROR_MESSAGES[code] })).toBeTruthy();
    expect(actionErrorCopy("entitlement_exhausted", "x")).toBe("Has utilizado las adaptaciones disponibles de este periodo.");
    expect(actionErrorCopy("entitlement_unavailable", "x")).toBe("No hemos podido comprobar las adaptaciones disponibles. Inténtalo de nuevo más tarde.");
    expect(actionErrorCopy("entitlement_unavailable", "x")).not.toBe(actionErrorCopy("entitlement_exhausted", "x"));
    expect(actionErrorCopy("stale_review", "")).toBe("Esta propuesta ha cambiado desde que la abriste. Actualiza para revisar la versión más reciente.");
    expect(actionErrorCopy("unsupported_execution", "")).toBe("Hay un cambio que todavía necesita ajustarse antes de crear el material.");
    expect(failureCopy({ code: "ambiguous_attempt", category: "human_action_required", message: "" })).toBe("No se pudo confirmar el resultado del último intento.");
  });
});

describe("view model: the screen follows the server's flags", () => {
  const cases: Array<[string, AdaptationStatusDto, string]> = [
    ["queued without a job", status(), "start"],
    ["planning", status({ status: "planning", progress: "planning", nextAction: "none" }), "working"],
    ["awaiting review", awaitingReview(), "review"],
    ["generation waiting for the person", status({ status: "generation_queued", nextAction: "start_generation" }), "generate"],
    ["generating", status({ status: "generating", progress: "generating", nextAction: "none" }), "working"],
    ["reviewing", status({ status: "reviewing_ai", progress: "reviewing", nextAction: "none" }), "working"],
    ["ready", ready(), "ready"],
    ["blocked", status({ status: "blocked", phase: "blocked", progress: "blocked", nextAction: "review_plan" }), "blocked"],
    ["retryable failure", status({ status: "failed", phase: "recoverable_failure", progress: "failed", nextAction: "retry", canRetry: true }), "failed"],
    ["terminal failure", status({ status: "failed", phase: "action_required", progress: "failed", nextAction: "cancel" }), "failed"],
    ["cancelled", status({ status: "cancelled", phase: "cancelled", progress: "cancelled", nextAction: "none", canCancel: false }), "cancelled"],
  ];
  it.each(cases)("%s", (_name, dto, expected) => expect(screenFor(dto)).toBe(expected));

  it("polls only while the pipeline works by itself", () => {
    expect(cases.filter(([, dto]) => shouldPoll(dto)).map(([name]) => name)).toEqual(["planning", "generating", "reviewing"]);
  });

  it("stage list has no percentages and marks one active stage", () => {
    const stages = stageStates("generating");
    expect(stages.filter((s) => s.state === "active").map((s) => s.label)).toEqual(["Creando la ficha"]);
    expect(stages.map((s) => s.label).join(" ")).not.toMatch(/%/);
    expect(stageStates("ready").every((s) => s.state === "done")).toBe(true);
  });

  it("warnings become observations in teacher language: no check names, no R1, de-duplicated", () => {
    const lines = warningLines({
      review: { verdict: "approved_with_warnings", pendingJudgments: [], warnings: [
        { check: "traceability_complete", status: "WARN", detail: "R1: ayuda duplicada blk_abc12345", method: "deterministic" },
        { check: "traceability_complete", status: "WARN", detail: "otra", method: "deterministic" },
        { check: "functional_supports_applied", status: "WARN", detail: "need_3 no cubierta", method: "ai" },
        { check: "R1_unknown_new_check", status: "WARN", detail: "x", method: "ai" },
      ] },
      execution: { aiDecisions: 2, deferredDecisions: ["dec_4"], blockers: [] },
    });
    expect(lines).toHaveLength(4);
    expect(lines.join(" ")).not.toMatch(TECHNICAL);
    expect(lines.join(" ")).toMatch(/presentación final/);
  });
});

describe("review form: choices, validation and the payload of the existing contract", () => {
  it("starts from the recommendation (what «Hacer magia» applies): applicable decisions applied, blocked ones left out; nothing is hidden", () => {
    const state = initialFormState(plan);
    expect(Object.keys(state)).toHaveLength(plan.decisions.length);
    expect(state["dec_1"]!.choice).toBe("approve");
    expect(state["dec_3"]!.choice).toBe("approve");
    expect(state["dec_5"]!.choice).toBe("reject");
    expect(problemsOf(plan, state)).toEqual({});
    expect(isRecommended(plan, state)).toBe(true);
  });

  it("a blocked decision can never be approved from the form", () => {
    const state = formReducer(initialFormState(plan), { type: "choose", id: "dec_5", choice: "approve" });
    expect(problemsOf(plan, state)["dec_5"]).toBe("blocked_approved");
  });

  it("'Restaurar recomendación' undoes every change, adjustments included", () => {
    let state = formReducer(initialFormState(plan), { type: "choose", id: "dec_1", choice: "reject" });
    state = formReducer(state, { type: "edit", id: "dec_2", patch: { intensity: "light" } });
    expect(isRecommended(plan, state)).toBe(false);
    state = formReducer(state, { type: "reset", plan });
    expect(state).toEqual(initialFormState(plan));
    expect(isRecommended(plan, state)).toBe(true);
  });

  it("builds approve / reject / edit entries for the real PlanReview schema (and the server sets reviewer and time)", () => {
    let state = initialFormState(plan);
    state = formReducer(state, { type: "choose", id: "dec_1", choice: "approve" });
    state = formReducer(state, { type: "choose", id: "dec_2", choice: "approve" });
    state = formReducer(state, { type: "choose", id: "dec_3", choice: "reject" });
    state = formReducer(state, { type: "choose", id: "dec_4", choice: "approve" });
    state = formReducer(state, { type: "edit", id: "dec_2", patch: { supports: ["checklist"], intensity: "light", note: "  Solo lista  " } });
    expect(problemsOf(plan, state)).toEqual({});
    const review = buildReview(plan, state);
    expect(review.entries.map((e) => e.action)).toEqual(["approved", "edited", "rejected", "approved", "rejected"]);
    const edit = review.entries[1] as { edits: Record<string, unknown> };
    expect(edit.edits).toEqual({ intensity: "light", supports: [{ kind: "checklist" }], note: "Solo lista" });
    expect(PlanReviewSchema.safeParse({ ...review, reviewer: { kind: "teacher" }, reviewed_at: "2026-10-05T12:00:00Z" }).success).toBe(true);
  });

  it("an adjustment that changes nothing is a problem, and only changed fields are sent", () => {
    const d = plan.decisions[0]!;
    expect(editsFor(d, { action: d.action as never, intensity: d.intensity as never })).toEqual({});
    let state = formReducer(initialFormState(plan), { type: "choose", id: "dec_1", choice: "edit" });
    expect(problemsOf(plan, state)["dec_1"]).toBe("no_changes");
    state = formReducer(state, { type: "edit", id: "dec_1", patch: { action: "reduce" } });
    expect(problemsOf(plan, state)["dec_1"]).toBeUndefined();
    expect(editsFor(d, { action: "bogus" as never })).toEqual({});
  });

  it("interprets the server's answer: saved, stale (refresh), unsupported (back to the review, naming decisions), quota", () => {
    const ok = { reviewFingerprint: "f", executable: true, blockers: [], deferredDecisions: ["dec_4"] };
    expect(interpretSubmit({ ok: true, data: ok })).toEqual({ kind: "saved", result: ok });
    expect(interpretSubmit({ ok: false, code: "stale_review", message: "x" })).toEqual({ kind: "stale", message: "Esta propuesta ha cambiado desde que la abriste. Actualiza para revisar la versión más reciente." });
    const blocked = interpretSubmit({ ok: true, data: { ...ok, executable: false, blockers: ["dec_2: sin ejecutor"] } });
    expect(blocked).toEqual({ kind: "unsupported", message: "Hay un cambio que todavía necesita ajustarse antes de crear el material.", affected: ["dec_2"] });
    expect(JSON.stringify(blocked)).not.toContain("sin ejecutor");
    expect(interpretSubmit({ ok: false, code: "unsupported_execution", message: "x" })).toMatchObject({ kind: "unsupported" });
    expect(interpretSubmit({ ok: false, code: "entitlement_exhausted", message: "x" })).toMatchObject({ kind: "error", message: "Has utilizado las adaptaciones disponibles de este periodo." });
    expect(interpretSubmit({ ok: false, code: "invalid", message: "Revisa los datos y vuelve a intentarlo." })).toMatchObject({ kind: "error", message: "Revisa los datos y vuelve a intentarlo." });
  });

  it("extracts the decisions behind blocker lines without showing the lines", () => {
    expect(decisionsInBlockers(["dec_4: Reorganización sin estructura", "dec_4: otra", "dec_9: x", "texto suelto"])).toEqual(["dec_4", "dec_9"]);
  });
});

describe("poller: gentle, abortable, stops on stable states", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const working = status({ status: "planning", progress: "planning", nextAction: "none" });
  const make = (results: Array<AdaptationStatusDto | null>, visible = () => true) => {
    const seen: AdaptationStatusDto[] = [];
    const connection: boolean[] = [];
    const signals: AbortSignal[] = [];
    let i = 0;
    const poller = createPoller({
      fetchStatus: async (signal) => {
        signals.push(signal);
        return results[Math.min(i++, results.length - 1)]!;
      },
      onStatus: (d) => seen.push(d),
      onConnection: (o) => connection.push(o),
      isVisible: visible,
    });
    return { poller, seen, connection, signals, calls: () => i };
  };

  it("polls at a fixed interval while working and stops on a stable state", async () => {
    const t = make([working, working, awaitingReview()]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10);
    expect(t.calls()).toBe(3);
    expect(t.seen.at(-1)!.nextAction).toBe("review_plan");
  });

  it("does not storm: no request before the interval and never two in flight", async () => {
    const t = make([working]);
    t.poller.start();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(t.calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls()).toBe(1);
    t.poller.stop();
  });

  it("slows down with the tab hidden and wakes up when visible again", async () => {
    let visible = false;
    const t = make([working], () => visible);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(t.calls()).toBe(0);
    visible = true;
    t.poller.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls()).toBe(1);
    expect(nextDelay(false, 0)).toBe(HIDDEN_INTERVAL_MS);
  });

  it("backs off on failures, reports the connection and recovers", async () => {
    const t = make([null, null, working]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(t.connection).toEqual([false]);
    expect(nextDelay(true, 1)).toBeGreaterThan(POLL_INTERVAL_MS);
    expect(nextDelay(true, 99)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
    expect(t.connection).toContain(true);
    t.poller.stop();
  });

  it("stop aborts the request in flight and nothing arrives after unmount", async () => {
    let resolve: (d: AdaptationStatusDto) => void = () => {};
    const seen: AdaptationStatusDto[] = [];
    let signal: AbortSignal | undefined;
    const poller = createPoller({
      fetchStatus: (s) => {
        signal = s;
        return new Promise((r) => (resolve = r));
      },
      onStatus: (d) => seen.push(d),
      onConnection: () => {},
      isVisible: () => true,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    poller.stop();
    expect(signal!.aborted).toBe(true);
    resolve(working);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(seen).toEqual([]);
  });
});

describe("context: only original-material content reaches the screen", () => {
  it("labels targets and lists what must be kept, never an inferred answer", () => {
    const json = JSON.stringify(context);
    expect(context.activityCount).toBe(5);
    expect(Object.values(context.targets)).toContain("Actividad 1");
    expect(json).not.toContain(INFERRED_ANSWER);
    expect(Object.values(context.preserved).flat().some((l) => l.startsWith("Debe mantenerse: ") && /150-180 palabras/.test(l))).toBe(true);
    expect(context.preserved["document"]!.some((l) => l.startsWith("Objetivo: "))).toBe(true);
  });
});
