import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

/**
 * Puts an adaptation created through the UI into a given pipeline state by writing the rows the real pipeline would have
 * written (artifacts, version, status), through the fake Supabase's service key. No provider is involved: this exists so the
 * screens of the later states can be driven in a browser (the mock provider has no planner or generator fixtures).
 */
const FAKE = `http://127.0.0.1:${process.env.FAKE_SUPABASE_PORT ?? 54399}`;
const KEY = process.env.FAKE_SERVICE_KEY ?? "sb_secret_fakefakefakefakefake";
const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", prefer: "return=minimal" };
const hex = () => randomBytes(32).toString("hex");

async function ok(response: { ok(): boolean; text(): Promise<string> }) {
  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * The E2E specs share one fake database and `allowAdaptations` raises Free to 100 for the specs that need room: a spec that
 * checks the real Free plan puts back the seeded value first (supabase/seed.sql), whatever ran before it.
 */
export async function restoreSeededFreePlan(page: Page) {
  await ok(await page.request.patch(`${FAKE}/rest/v1/plans?slug=eq.free`, { headers, data: { monthly_adaptations: 5 } }));
}

export async function allowAdaptations(page: Page) {
  await ok(await page.request.patch(`${FAKE}/rest/v1/plans?slug=eq.free`, { headers, data: { monthly_adaptations: 100 } }));
}

const setStatus = async (page: Page, id: string, patch: Record<string, unknown>) => ok(await page.request.patch(`${FAKE}/rest/v1/adaptations?id=eq.${id}`, { headers, data: patch }));
const artifact = async (page: Page, workspaceId: string, adaptationId: string, kind: string, payload: unknown) =>
  ok(await page.request.post(`${FAKE}/rest/v1/adaptation_artifacts`, { headers, data: { workspace_id: workspaceId, adaptation_id: adaptationId, kind, input_fingerprint: hex(), fingerprint: hex(), payload } }));

export const seedWorking = (page: Page, id: string) => setStatus(page, id, { status: "generating" });

export async function seedAwaitingReview(page: Page, workspaceId: string, id: string) {
  const issue = (flag: string, severity: string) => ({ flag, severity, decision_id: null, target: null, message: "MENSAJE_TECNICO_DEL_VALIDADOR" });
  const decisions = [
    { id: "dec_1", target: "act_1", action: "rephrase", strategies: ["language_simplification"], dimensions: ["reading_level", "sentence_length"], intensity: "light", preserves: [], supports: [], flags: [], note: "NOTA_INTERNA" },
    { id: "dec_2", target: "act_2", action: "add_support", strategies: ["planning_support"], dimensions: ["planning_support", "checklist_support"], intensity: "moderate", preserves: [], supports: [{ kind: "checklist", uses_task_data: false }, { kind: "planner", uses_task_data: false }], flags: [] },
    { id: "dec_3", target: "act_3", action: "change_response_format", strategies: ["response_choice"], dimensions: ["expressive_language_support"], intensity: "moderate", preserves: [], supports: [], flags: [] },
    { id: "dec_4", target: "document", action: "segment", strategies: ["text_segmentation"], dimensions: ["reading_chunk_size"], intensity: "moderate", preserves: [], supports: [], flags: [] },
    { id: "dec_5", target: "act_4", action: "remove", strategies: ["visual_load_reduction"], dimensions: ["visual_distraction_reduction"], intensity: "moderate", preserves: [], supports: [], flags: [] },
  ];
  const status = ["valid", "valid", "review", "valid", "blocked"];
  await artifact(page, workspaceId, id, "plan", { decisions, summary: [] });
  await artifact(page, workspaceId, id, "plan_validation", {
    classification: {
      decisions: decisions.map((d, i) => ({ id: d.id, status: status[i], issues: i === 2 ? [issue("open_task_closed", "review")] : i === 4 ? [issue("activity_removed", "block")] : [] })),
      counts: { valid: 3, review: 1, blocked: 1 },
    },
  });
  await setStatus(page, id, { status: "awaiting_plan_review" });
}

export async function seedReadyWithWarnings(page: Page, workspaceId: string, id: string) {
  const review = {
    verdict: "approved_with_warnings",
    checks: [
      { check: "traceability_complete", status: "WARN", detail: "R1: ayuda duplicada blk_abc12345", method: "deterministic", targets: [] },
      { check: "functional_supports_applied", status: "WARN", detail: "need_3 no cubierta", method: "ai", targets: [] },
    ],
  };
  await artifact(page, workspaceId, id, "pedagogical_review", { review, pending: [] });
  await artifact(page, workspaceId, id, "execution_report", { execution: { ai: ["dec_1"], deferred: [{ id: "dec_4" }], blockers: [] } });
  await ok(await page.request.post(`${FAKE}/rest/v1/adaptation_versions`, { headers, data: { adaptation_id: id, workspace_id: workspaceId, version: 1, document: { schema_version: 1 }, review, source: "ai_generated" } }));
  await setStatus(page, id, { status: "ready", current_version: 1, delivered_at: new Date().toISOString() });
}

/** A delivered adaptation whose current version carries `document` (a synthetic MaterialDocument), as the pipeline would leave it. */
export async function seedReadyDocument(page: Page, workspaceId: string, id: string, document: unknown) {
  const review = { schema_version: 1, plan_fingerprint: hex(), document_fingerprint: hex(), verdict: "approved", checks: [], blocks_to_revise: [] };
  await ok(await page.request.post(`${FAKE}/rest/v1/adaptation_versions`, { headers, data: { adaptation_id: id, workspace_id: workspaceId, version: 1, document, review, source: "ai_generated" } }));
  await setStatus(page, id, { status: "ready", current_version: 1, delivered_at: new Date().toISOString() });
}

/** Marks `visuals` as necessary in the adaptation's pinned context (what the pipeline records for a material with required figures). */
export async function requireVisuals(page: Page, id: string, visuals: string[]) {
  const rows = (await (await page.request.get(`${FAKE}/rest/v1/adaptations?select=context_snapshot&id=eq.${id}`, { headers })).json()) as Array<{ context_snapshot: { material: { required_visuals: string[] } } }>;
  const snapshot = rows[0]!.context_snapshot;
  snapshot.material.required_visuals = visuals;
  await ok(await page.request.patch(`${FAKE}/rest/v1/adaptations?id=eq.${id}`, { headers, data: { context_snapshot: snapshot } }));
}

/**
 * «Hacer magia» whose pedagogical review BLOCKED the sheet, as the pipeline leaves it: the adaptation (created through the UI, with
 * its real plan) in automatic mode, the server's recommendation saved for that plan, one generation spent and a blocking review.
 * The mock reviewer never blocks, so this is the only way to show that screen in a browser.
 */
export async function seedBlockedMagic(page: Page, workspaceId: string, id: string) {
  const get = async <T>(path: string) => (await (await page.request.get(`${FAKE}/rest/v1/${path}`, { headers })).json()) as T;
  const [plan] = await get<Array<{ fingerprint: string }>>(`adaptation_artifacts?select=fingerprint&adaptation_id=eq.${id}&kind=eq.plan`);
  const [validation] = await get<Array<{ payload: { classification: { decisions: Array<{ id: string; status: string }> } } }>>(`adaptation_artifacts?select=payload&adaptation_id=eq.${id}&kind=eq.plan_validation`);
  const [row] = await get<Array<{ material_id: string }>>(`adaptations?select=material_id&id=eq.${id}`);
  const entries = validation!.payload.classification.decisions.map((d) => (d.status === "blocked" ? { decision_id: d.id, action: "rejected", reason: "Bloqueada" } : { decision_id: d.id, action: "approved", reason: "Sin avisos" }));
  const review = { schema_version: 1, plan_fingerprint: plan!.fingerprint, reviewer: { kind: "auto" }, reviewed_at: "auto", entries };
  await ok(await page.request.post(`${FAKE}/rest/v1/adaptation_artifacts`, { headers, data: { workspace_id: workspaceId, adaptation_id: id, kind: "plan_review", input_fingerprint: plan!.fingerprint, fingerprint: hex(), payload: review } }));
  await ok(await page.request.post(`${FAKE}/rest/v1/adaptation_jobs`, { headers, data: { workspace_id: workspaceId, material_id: row!.material_id, adaptation_id: id, kind: "adapt", stage: "generation", input: {}, status: "completed", input_fingerprint: hex() } }));
  const blocked = { verdict: "blocked", checks: [{ check: "age_appropriate", status: "FAIL", detail: "Tono inadecuado", method: "ai", targets: [] }] };
  await artifact(page, workspaceId, id, "pedagogical_review", { review: blocked, pending: [] });
  await setStatus(page, id, { status: "blocked", creation_mode: "automatic" });
}
