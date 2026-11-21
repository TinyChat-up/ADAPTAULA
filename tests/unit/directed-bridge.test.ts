import { describe, expect, it, vi } from "vitest";
import { directedSheet } from "@/lib/adaptation/directed/bridge";
import { runDirectedRecreation } from "@/lib/recreation/directed-pilot";
import type { PdfEngine } from "@/lib/render/print/engine";
import { ADAPTATION, WORKSPACE, appAdaptation } from "../support/directed-bridge";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { candidateFor, directorFixture, shortOriginal } from "../support/directed-recreation";

/** The engine is never reached in these cases: every one stops before fabrication or printing. */
const engine = { render: vi.fn(async () => { throw new Error("no debe imprimir"); }) } as unknown as PdfEngine;
const codes = (result: Awaited<ReturnType<typeof directedSheet>>) => (result.status === "blocked" ? result.issues.map(({ code }) => code) : ["review_pending"]);

describe("puente entre la aplicación y el director pedagógico", () => {
  it("solo usa un análisis V4, el mismo de la adaptación, del mismo workspace y sin autorización curricular", async () => {
    const { deps, snapshot } = await appAdaptation(engine);
    expect(codes(await directedSheet(deps, "99999999-9999-4999-8999-999999999999", ADAPTATION))).toEqual(["not_found"]);
    // A V3 analysis (the current default) is not enough for the director.
    const v3 = await appAdaptation(engine);
    v3.snapshot.analysis.analysis = (v3.snapshot.analysis.analysis as { base: unknown }).base;
    expect(codes(await directedSheet(v3.deps, WORKSPACE, ADAPTATION))).toEqual(["v4_required"]);
    const stale = await appAdaptation(engine);
    stale.snapshot.adaptation.analysis_fingerprint = "0".repeat(64);
    expect(codes(await directedSheet(stale.deps, WORKSPACE, ADAPTATION))).toEqual(["stale_analysis"]);
    // A curricular adaptation (no per-sheet scope in its frozen context) is refused: there is no curricular authorization contract yet.
    const withoutScope = { ...(snapshot.adaptation.context_snapshot as Record<string, unknown>) };
    delete withoutScope.pedagogy;
    snapshot.adaptation.adaptation_type = "curricular";
    snapshot.adaptation.context_snapshot = { ...withoutScope, adaptation_type: "curricular" };
    snapshot.adaptation.context_fingerprint = fingerprint(snapshot.adaptation.context_snapshot);
    expect(codes(await directedSheet(deps, WORKSPACE, ADAPTATION))).toEqual(["curricular_unavailable"]);
    // A frozen context that does not match its fingerprint is never used.
    snapshot.adaptation.context_fingerprint = "0".repeat(64);
    expect(codes(await directedSheet(deps, WORKSPACE, ADAPTATION))).toEqual(["invalid_input"]);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it("exige el original subido y el perfil con el que se creó la adaptación, sin cambios posteriores", async () => {
    const changedFile = await appAdaptation(engine);
    changedFile.deps.original = async () => new Uint8Array([1, 2, 3]);
    expect(codes(await directedSheet(changedFile.deps, WORKSPACE, ADAPTATION))).toEqual(["original_changed"]);
    const editedLater = await appAdaptation(engine);
    editedLater.profile.updated_at = "2026-11-23T10:00:00.000Z";
    expect(codes(await directedSheet(editedLater.deps, WORKSPACE, ADAPTATION))).toEqual(["profile_changed"]);
    // Same date, different content (a restored backup, a clock skew): the rebuilt context no longer matches the frozen one.
    const otherContent = await appAdaptation(engine);
    otherContent.profile.functional_profile = { ...(otherContent.profile.functional_profile as object), supports: { large_print: "high" } };
    expect(codes(await directedSheet(otherContent.deps, WORKSPACE, ADAPTATION))).toEqual(["profile_changed"]);
    const noProfile = await appAdaptation(engine);
    noProfile.snapshot.adaptation.learner_profile_id = null;
    expect(codes(await directedSheet(noProfile.deps, WORKSPACE, ADAPTATION))).toEqual(["profile_required"]);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it("sin planificador, una sustitución se bloquea con su motivo y nunca se fabrica a ciegas", async () => {
    const { input, original } = await directorFixture({ draft: shortOriginal() });
    const result = await runDirectedRecreation(input, { original, candidate: { version: 1, activities: [candidateFor(input, "act_2", true)] } });
    expect(result).toMatchObject({ status: "blocked", issues: [{ code: "replacement_planner_unavailable", original_id: "act_2" }] });
  });
});
