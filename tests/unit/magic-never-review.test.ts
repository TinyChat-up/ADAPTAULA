import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdaptationView, type AdaptationActions } from "@/components/adaptation/adaptation-view";
import { buildStatusDto, MAX_GENERATION_CYCLES, type StatusArtifacts } from "@/lib/adaptation/orchestration/status";
import type { PipelineSnapshot } from "@/lib/adaptation/orchestration/store";
import { AUTOMATIC_STOP_COPY, STATUS_COPY } from "@/lib/adaptation/presentation/copy";
import { AUTOMATIC_INCOMPLETE, listState } from "@/lib/adaptation/presentation/list";
import { screenFor } from "@/lib/adaptation/presentation/view-model";
import { preservationRefs, withOriginals } from "@/lib/adaptation/restoration";
import type { NormalizedGeneration } from "@/lib/adaptation/generated";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { context } from "../support/adaptation-ui-fixtures";

/**
 * HOTFIX «Hacer magia sigue obligando al docente a revisar»: the invariant of the automatic mode on everything the teacher can see
 * (status, screen, panels, lists), and the pure localized restoration of lost original content. No database, no model.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const html = (element: ReactElement) => renderToStaticMarkup(element);
const noop = async () => {
  throw new Error("an action ran during render");
};
const actions: AdaptationActions = { start: noop, submit: noop, generate: noop, reopen: noop, retry: noop, cancel: noop };

const job = (i: number) => ({ id: `11111111-1111-4111-8111-11111111111${i}`, stage: "generation" as const, status: "completed" as const, attempts: 1, max_attempts: 3, step: null, progress: 100, locked_until: null, input_fingerprint: String(i).repeat(64), error: null, ambiguous: false });
const snapshot = (over: Partial<PipelineSnapshot["adaptation"]>, cycles: number): PipelineSnapshot =>
  ({
    adaptation: { id: "11111111-1111-4111-8111-111111111111", workspace_id: "w", material_id: "m", learner_profile_id: null, title: "t", adaptation_type: "accessibility", status: "blocked", current_version: cycles > 0 ? 1 : 0, pipeline_versions: null, context_snapshot: null, context_fingerprint: null, analysis_fingerprint: null, failure_code: null, delivered_at: null, created_at: "2026-10-11T00:00:00Z", creation_mode: "automatic", ...over },
    analysis: { analysis: null, prompt_version: null, status: "analyzed" },
    jobs: Array.from({ length: cycles }, (_, i) => job(i + 1)),
  }) as PipelineSnapshot;

const failingReview: StatusArtifacts["review"] = {
  verdict: "blocked",
  checks: [
    { check: "protected_elements_preserved", status: "FAIL", targets: ["prt_3"], detail: "x", method: "deterministic" },
    { check: "answers_not_leaked", status: "WARN", targets: ["act_3"], detail: "x", method: "deterministic" },
  ],
} as never;

/** Every state a magic adaptation can be left in after a sheet: blocked, back at the gate, failed; by whom; with or without a stop. */
const MATRIX = (["blocked", "awaiting_plan_review"] as const).flatMap((status) =>
  (["auto", "teacher"] as const).flatMap((kind) => [1, 2, MAX_GENERATION_CYCLES].flatMap((cycles) => [null, "quality"].map((stop) => ({ status, kind, cycles, stop })))),
);

describe("the invariant: a «Hacer magia» adaptation never asks for the plan gate or «Revisar adaptación»", () => {
  it.each(MATRIX)("$status · last review by $kind · $cycles generation(s) · stop $stop → working or the honest stop", ({ status, kind, cycles, stop }) => {
    const dto = buildStatusDto(snapshot({ status }, cycles), { hasPlanReview: true, latestReviewKind: kind, automaticStop: stop, review: failingReview });
    expect(["working", "automatic_incomplete"]).toContain(dto.phase);
    expect(["working", "automatic_incomplete"]).toContain(screenFor(dto));
    // Still the server's, generations left, nothing recorded: the correction runs (the run route only runs a «working» stage).
    const correcting = kind === "auto" && cycles < MAX_GENERATION_CYCLES && stop === null;
    expect(dto.phase).toBe(correcting ? "working" : "automatic_incomplete");
    if (dto.phase === "automatic_incomplete") {
      expect(dto.automaticStop?.reason).toBe("quality");
      // Editing is OFFERED only while it can lead somewhere (with no generation left, editing could never produce a sheet).
      expect(dto.nextAction).toBe(cycles >= MAX_GENERATION_CYCLES ? "none" : "review_plan");
    }
  });

  it("a magic generation that failed its checks is the honest stop too, whoever reviewed last", () => {
    for (const kind of ["auto", "teacher"] as const) {
      const dto = buildStatusDto(snapshot({ status: "failed", failure_code: "generator_validation" }, 1), { hasPlanReview: true, latestReviewKind: kind });
      expect(dto).toMatchObject({ phase: "automatic_incomplete", automaticStop: { reason: "quality" } });
    }
  });

  it("the page renders «No hemos podido completar automáticamente esta ficha» with «Revisar y editar» as an option, never «Revisar adaptación» or the blocked copy", () => {
    const dto = buildStatusDto(snapshot({ status: "blocked" }, 1), { hasPlanReview: true, latestReviewKind: "auto", automaticStop: "quality", review: failingReview });
    const out = html(createElement(AdaptationView, { initial: dto, plan: null, context, readyInfo: null, actions, canWrite: true }));
    expect(out).toContain(AUTOMATIC_STOP_COPY.title);
    expect(out).toContain(AUTOMATIC_STOP_COPY.edit);
    expect(out).toContain("Comprueba que se conserva lo que debía mantenerse del material original.");
    expect(out).not.toContain("Revisar adaptación");
    expect(out).not.toContain(STATUS_COPY.blocked.title);
    // While the correction is about to run, the working screen (no command at all).
    const working = buildStatusDto(snapshot({ status: "blocked" }, 1), { hasPlanReview: true, latestReviewKind: "auto", review: failingReview });
    const busy = html(createElement(AdaptationView, { initial: working, plan: null, context, readyInfo: null, actions, canWrite: true }));
    expect(busy).not.toContain("Revisar adaptación");
    expect(busy).not.toContain(AUTOMATIC_STOP_COPY.edit);
  });

  it("lists read «No se pudo completar automáticamente», never «Necesita una revisión» or «Esperando tu revisión»", () => {
    expect(listState("blocked", false, false, false, true)).toEqual(AUTOMATIC_INCOMPLETE);
    expect(listState("awaiting_plan_review", false, false, false, true)).toEqual(AUTOMATIC_INCOMPLETE);
  });
});

describe("«Revisar antes de crear» keeps its human gate", () => {
  it("awaiting the plan is the review screen; a blocked sheet is «Revisar adaptación»", () => {
    const waiting = buildStatusDto(snapshot({ status: "awaiting_plan_review", creation_mode: "review" }, 0), { hasPlanReview: false });
    expect(waiting).toMatchObject({ phase: "awaiting_review", nextAction: "review_plan" });
    expect(screenFor(waiting)).toBe("review");
    const blocked = buildStatusDto(snapshot({ status: "blocked", creation_mode: "review" }, 1), { hasPlanReview: true, latestReviewKind: "teacher", review: failingReview });
    expect(blocked).toMatchObject({ phase: "blocked", nextAction: "review_plan", automaticStop: null });
    expect(screenFor(blocked)).toBe("blocked");
    const out = html(createElement(AdaptationView, { initial: blocked, plan: null, context, readyInfo: null, actions, canWrite: true }));
    expect(out).toContain("Revisar adaptación");
    expect(out).toContain(STATUS_COPY.blocked.title);
  });
});

describe("localized restoration of the original (pure)", () => {
  const trace = (refs: string[], decisions: string[]) => ({ origin: "adapted" as const, source_refs: refs, decision_ids: decisions });
  const generation = (segments: Array<{ target: string; decision_ids: string[]; blocks: Array<{ type: string }> }>): NormalizedGeneration =>
    ({ version: 2, segments: { segments: segments.map((s) => ({ ...s, new_item_answers: [] })), change_summary: ["x"] }, issues: [], requested: [], generated: [], ignored: [], declined: [], preserved: [] }) as never;

  it("the failing checks' targets name the units: an activity, a protected element (its activities and resources) or a block (its source)", () => {
    const document = { pages: [{ blocks: [{ id: "blk_0009", type: "list", style: "numbered", items: ["a"], trace: trace(["act_4"], ["dec_6"]) }] }], answer_key: [] } as unknown as MaterialDocument;
    const review = {
      checks: [
        { check: "protected_elements_preserved", status: "FAIL", targets: ["prt_2"], detail: "", method: "deterministic" },
        { check: "instructions_complete", status: "FAIL", targets: ["act_1", "blk_0009"], detail: "", method: "deterministic" },
        // Not a preservation check, or not failing, or the teacher's: ignored.
        { check: "answers_not_leaked", status: "FAIL", targets: ["act_5"], detail: "", method: "deterministic" },
        { check: "constraints_preserved", status: "WARN", targets: ["act_6"], detail: "", method: "deterministic" },
      ],
    } as never;
    const analysis = { protected_elements: [{ id: "prt_2", type: "required_data", importance: "essential", value: "x", activity_ids: ["act_3"], resource_ids: ["vis_1"] }] } as never;
    expect([...preservationRefs(review, analysis, document)].sort()).toEqual(["act_1", "act_3", "act_4", "vis_1"]);
  });

  it("drops only the replacement of the unit and keeps its supports; never empties a decision (that one is regenerated instead)", () => {
    const g = generation([
      { target: "act_3", decision_ids: ["dec_3"], blocks: [{ type: "activity" }, { type: "list" }] },
      { target: "act_3", decision_ids: ["dec_2"], blocks: [{ type: "worked_example" }] },
      { target: "act_4", decision_ids: ["dec_6"], blocks: [{ type: "activity" }] },
    ]);
    const restored = withOriginals(g, new Set(["act_3", "act_4"]));
    expect(restored?.restored).toEqual(["act_3"]);
    expect(restored?.generation.segments.segments.map((s) => [s.target, s.decision_ids[0], s.blocks.map((b) => b.type)])).toEqual([
      ["act_3", "dec_3", ["list"]],
      ["act_3", "dec_2", ["worked_example"]],
      ["act_4", "dec_6", ["activity"]],
    ]);
    // act_4's only decision would be left without anything: not restored, nothing to do.
    expect(withOriginals(g, new Set(["act_4"]))).toBeNull();
    expect(withOriginals(g, new Set(["act_9"]))).toBeNull();
  });
});
