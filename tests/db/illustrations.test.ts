import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbEntitlements } from "@/lib/adaptation/orchestration/entitlements-db";
import type { OrchestratorDeps } from "@/lib/adaptation/orchestration/orchestrator";
import { createAndStartAdaptation, getAdaptationStatus, type Actor, type ServiceDeps } from "@/lib/adaptation/orchestration/service";
import { processAdaptationStage } from "@/lib/adaptation/orchestration/worker";
import { visualNeedsOf } from "@/lib/adaptation/presentation/visual-needs";
import { toAiRunRow } from "@/lib/ai/run-record";
import { MockImageProvider } from "@/lib/ai/providers/mock-images";
import { resolveModel } from "@/lib/ai/registry";
import { resolveMagicVisuals } from "@/lib/materials/visuals/auto/policy";
import { prepareVisuals } from "@/lib/materials/visuals/auto/service";
import { illustrate, type IllustrationDeps } from "@/lib/materials/visuals/illustrate/service";
import type { ReviewDraft } from "@/lib/visuals/illustration";
import { resolveVisuals } from "@/lib/materials/visuals/service";
import type { GeneratedDeps } from "@/lib/render/generated";
import { loadRenderInputWith } from "@/lib/render/load";
import { readinessOf } from "@/lib/render/readiness";
import { CELL_BRIEF, CELL_REVIEW_APPROVED, cellCaseAnalysis, cellPdf } from "../support/cell-case";
import { as, createTestDb, createUser } from "./harness";
import { deps as makeDeps, newSpy, readerFor, scriptedServices, seedLearner, seedMaterial, versions, type User } from "./orchestration-harness";
import { resourceHarness } from "./resource-harness";
import { attachSource, autoHarness, visualHarness } from "./visual-harness";

/**
 * Generated illustrations over the real migrations (PGlite): the contract of migration 024, workspace isolation (RLS on the row
 * and on the private object), the `image` quota of the plan, and case B («La célula animal», 1.º ESO) end to end through the real
 * orchestrator: the scheme that is not in the PDF becomes an approved illustration, the sheet is delivered and printable, one
 * `image` unit is consumed, every call is in `ai_runs` without content. 0 real model calls (scripted brief and review, the local
 * mock drawing as the image).
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 120_000);
beforeEach(async () => {
  await db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'");
  // Policy 026 keeps images disabled in every real plan. Enable the dormant path only in this local fixture.
  await db.query("update public.plans set monthly_images = 50, features = features || '{\"image_generation\":true}'::jsonb where slug = 'max'");
});
const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const asService = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);
const BUCKET = "generated-assets";

let n = 0;
async function subscribe(workspaceId: string, plan: "max" | "pro") {
  await q(
    `insert into public.subscriptions (workspace_id, stripe_subscription_id, stripe_price_id, plan_id, billing_interval, status, period_start, period_end)
     select $1, $2, 'price_test', id, 'month', 'active', now() - interval '1 day', now() + interval '29 days' from public.plans where slug = $3`,
    [workspaceId, `sub_illustrations_${++n}_${Math.random().toString(36).slice(2, 6)}`, plan],
  );
}

/** The production pipeline's storage and accounting, over PGlite: service role writes, bytes in memory keyed like Storage. */
function pgIllustrationDeps(user: User, objects: Map<string, Uint8Array>, ids: { adaptationId: string; materialId: string }, script: { review?: ReviewDraft } = {}): IllustrationDeps {
  const selection = resolveModel("IMAGE_QUALITY", { AI_MODEL_IMAGE_QUALITY: "mock:dibujo" });
  const aiRun = (purpose: "image_brief" | "image" | "image_review") => ({ purpose, attempt: 1, alias: purpose === "image" ? ("IMAGE_QUALITY" as const) : ("STANDARD" as const), provider: "mock" as const, model: "mock", effort: "low" as const, promptKey: purpose, promptVersion: 1, inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 5, status: "success" as const, errorCode: null });
  return {
    brief: async () => ({ draft: structuredClone(CELL_BRIEF), run: aiRun("image_brief") }),
    image: async ({ prompt, size }) => ({ image: (await new MockImageProvider().generateImage({ selection, prompt, size, quality: "medium", timeoutMs: 1000 })).image, run: aiRun("image") }),
    review: async () => ({ draft: structuredClone(script.review ?? CELL_REVIEW_APPROVED), run: aiRun("image_review") }),
    store: {
      async find(adaptationId, needKey) {
        const rows = await asService(() => q<{ id: string; sha256: string; width: number; height: number; alt_text: string }>("select id, sha256, width, height, alt_text from public.generated_assets where adaptation_id = $1 and need_key = $2 and sha256 is not null order by created_at desc limit 1", [adaptationId, needKey]));
        return rows[0] ? { id: rows[0].id, sha256: rows[0].sha256, width: rows[0].width, height: rows[0].height, alt: rows[0].alt_text } : null;
      },
      async put({ request, brief, briefFingerprint, prompt, png, sha256, width, height, attempts, review }) {
        const path = `${request.workspaceId}/${request.adaptationId}/illustrations/${sha256}.png`;
        objects.set(path, png);
        await asService(() => q("insert into storage.objects (bucket_id, name) values ($1, $2) on conflict do nothing", [BUCKET, path]));
        const rows = await asService(() =>
          q<{ id: string }>(
            `insert into public.generated_assets (workspace_id, adaptation_id, type, storage_path, image_brief, prompt, alt_text, metadata, need_key, brief_fingerprint, sha256, mime, width, height, bytes, model_alias, review, attempts)
             values ($1, $2, 'illustration', $3, $4, $5, $6, $7, $8, $9, $10, 'image/png', $11, $12, $13, 'IMAGE_QUALITY', $14, $15) returning id`,
            [request.workspaceId, request.adaptationId, path, JSON.stringify(brief), prompt, brief.alt_text, JSON.stringify({ kind: brief.kind }), request.needKey, briefFingerprint, sha256, width, height, png.byteLength, JSON.stringify(review), attempts],
          ),
        );
        return { id: rows[0]!.id, sha256, width, height, alt: brief.alt_text };
      },
    },
    quota: {
      reserve: async (key) => (await asService(() => q<{ r: { allowed: boolean } }>("select public.consume_quota($1, 'image', 1, null, null, $2) as r", [user.workspaceId, key])))[0]!.r.allowed === true,
      refund: async (key) => void (await asService(() => q("select public.refund_quota($1)", [key]))),
    },
    recordAiRun: async (run) => {
      const row = { ...toAiRunRow(run, { workspaceId: user.workspaceId, jobId: null, materialId: ids.materialId }), adaptation_id: ids.adaptationId };
      const cols = Object.keys(row);
      await asService(() => q(`insert into public.ai_runs (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row).map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v))));
    },
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  };
}

/** What the sheet viewer and the PDF read, as the USER (RLS on the row and on storage.objects). */
function userGeneratedDeps(user: User, objects: Map<string, Uint8Array>): GeneratedDeps {
  const asUser = <T>(fn: () => Promise<T>) => as(db, "authenticated", user.id, fn);
  return {
    row: async (assetId) => (await asUser(() => q<{ id: string; adaptation_id: string; storage_path: string; sha256: string; width: number; height: number }>("select id, adaptation_id, storage_path, sha256, width, height from public.generated_assets where id = $1 and sha256 is not null", [assetId])))[0] ?? null,
    readObject: async (path) => ((await asUser(() => q("select 1 from storage.objects where bucket_id = $1 and name = $2", [BUCKET, path]))).length > 0 ? (objects.get(path) ?? null) : null),
  };
}

const planner = async (_inner: unknown, _call: number, input: { context: { needs: Array<{ dimension: string }> } }) => {
  const ref = `need_${input.context.needs.findIndex((x) => x.dimension === "planning_support") + 1}`;
  return { draft: { decisions: [{ target: "document", action: "add_support", strategies: ["planning_support"], need_refs: [ref], intensity: "light", supports: [{ kind: "checklist", uses_task_data: false }] }], summary: ["Plan de prueba"] }, runs: [] } as never;
};

async function teacher(options: { plan?: "max" | "free"; review?: ReviewDraft } = {}) {
  const user = await createUser(db, `illustrations-${++n}-${Math.random().toString(36).slice(2, 6)}@example.com`);
  if (options.plan !== "free") await subscribe(user.workspaceId, "max");
  const analysis = cellCaseAnalysis();
  const materialId = await seedMaterial(db, user, analysis);
  const learner = await seedLearner(db, user);
  const visuals = visualHarness(db, user);
  const sourceSha256 = await attachSource(db, visuals, materialId, "application/pdf", await cellPdf({ withoutScheme: true }));
  const auto = autoHarness(db, visuals);
  const visualPolicy: NonNullable<OrchestratorDeps["visuals"]> = {
    resolve: async (input) => {
      await prepareVisuals(auto.deps, { workspaceId: input.workspaceId, materialId: input.materialId, analysis: input.analysis, analysisFingerprint: input.analysisFingerprint, sourceSha256, adaptationId: input.adaptationId });
      const deps = pgIllustrationDeps(user, visuals.objects, { adaptationId: input.adaptationId, materialId: input.materialId }, { review: options.review });
      // As in production (`illustrationAvailability`): the plan decides first whether there are illustrations at all.
      const plan = (await q<{ monthly_images: number; features: { image_generation?: boolean } }>("select monthly_images, features from public.workspace_plan($1)", [input.workspaceId]))[0]!;
      const included = plan.features.image_generation === true && plan.monthly_images > 0;
      return resolveMagicVisuals(
        {
          readyOriginals: async (ids) => {
            const r = await resolveVisuals(visuals.deps, { materialId: input.materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256, visualIds: ids });
            return new Set(ids.filter((id) => r.states[id]?.status === "ready"));
          },
          illustrate: included ? (request) => illustrate(deps, { ...request, workspaceId: input.workspaceId, adaptationId: input.adaptationId }) : null,
          illustrationsWithheld: included ? null : "plan",
        },
        { analysis: input.analysis, document: input.document, requiredVisuals: input.requiredVisuals, stage: input.stage, grade: input.grade, subject: input.subject, functionalNeeds: input.functionalNeeds },
      );
    },
  };
  const spy = newSpy();
  const orchestrator = makeDeps(db, scriptedServices(spy, { planner }), { visuals: visualPolicy });
  orchestrator.entitlements = dbEntitlements(orchestrator.store);
  const deps: ServiceDeps = { orchestrator, reader: readerFor(db, user), resolveVersions: versions };
  const actor: Actor = { userId: user.id, workspaceId: user.workspaceId, canWrite: true };
  const status = async (id: string) => {
    const r = await getAdaptationStatus(deps, actor, id);
    if (!r.ok) throw new Error(r.code);
    return r.data;
  };
  const magic = async () => {
    const created = await createAndStartAdaptation(deps, actor, { materialId, learnerProfileId: learner, adaptationType: "accessibility", requestKey: `illustrations-${n}-${Math.random()}`, creationMode: "automatic" });
    if (!created.ok) throw new Error(created.code);
    const id = created.data.adaptationId;
    for (let i = 0; i < 10 && (await processAdaptationStage(orchestrator, id)); i++);
    return id;
  };
  const sheet = (id: string, pin = false) => loadRenderInputWith(deps, actor, id, visuals.deps, { resources: resourceHarness(db, user).deps, generated: userGeneratedDeps(user, visuals.objects), pin });
  const imageUnits = async () => Number((await q<{ s: string | null }>("select coalesce(sum(units), 0)::text s from public.usage_events where workspace_id = $1 and kind = 'image'", [user.workspaceId]))[0]!.s);
  return { user, materialId, deps, actor, status, magic, sheet, imageUnits, objects: visuals.objects, spy };
}

describe("case B · «La célula animal»: the scheme is not in the PDF, an approved illustration takes its place", () => {
  it("delivered and printable with nothing for the teacher to do; one adaptation unit and ONE image unit; every call accounted for", async () => {
    const t = await teacher();
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "ready", delivered: true, automaticStop: null });
    const plan = (await q<{ payload: { plan: { needs: Array<Record<string, unknown>> } } }>("select payload from public.adaptation_artifacts where adaptation_id = $1 and kind = 'visual_resolution'", [id]))[0]!.payload.plan;
    expect(plan.needs.find((x) => x.key === "vis_1")).toMatchObject({ category: "generated_illustration", contract: { class: "must_generate_or_edit", provenance: "ai_illustration", validation: "ai_reviewed" } });
    expect(await t.imageUnits()).toBe(1);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("consumed");
    const runs = await q<{ purpose: string }>("select purpose from public.ai_runs where adaptation_id = $1 and purpose like 'image%' order by created_at", [id]);
    expect(runs.map((r) => r.purpose)).toEqual(["image_brief", "image", "image_review"]);
    const asset = (await q<{ sha256: string; storage_path: string; need_key: string; review: { approved: boolean }; attempts: number }>("select sha256, storage_path, need_key, review, attempts from public.generated_assets where adaptation_id = $1", [id]))[0]!;
    expect(asset).toMatchObject({ need_key: "vis_1", attempts: 1, review: { approved: true } });
    expect(createHash("sha256").update(t.objects.get(asset.storage_path)!).digest("hex")).toBe(asset.sha256);
    expect(asset.storage_path.startsWith(`${t.user.workspaceId}/${id}/illustrations/`)).toBe(true);
  });

  it("the sheet shows it from the verified private bytes; the PDF pins the exact instance; the teacher sees it as done", async () => {
    const t = await teacher();
    const id = await t.magic();
    const loaded = await t.sheet(id);
    if (loaded.kind !== "ok") throw new Error(loaded.kind);
    expect(Object.values(loaded.generated)).toEqual([expect.objectContaining({ src: expect.stringMatching(new RegExp(`^/api/adaptations/${id}/generated/[0-9a-f-]{36}$`)), widthMm: 120 })]);
    expect(readinessOf(loaded)).toMatchObject({ printable: true, pendingResources: 0 });
    expect(visualNeedsOf(loaded).filter((x) => x.status !== "ready")).toEqual([]);
    const pinned = await t.sheet(id, true);
    if (pinned.kind !== "ok") throw new Error(pinned.kind);
    const pin = pinned.pinned.find((p) => Object.values(pinned.generated)[0]!.src.includes(p.assetId));
    expect(pin).toBeDefined();
    expect(createHash("sha256").update(pin!.bytes).digest("hex")).toBe(pin!.sha256);
  });

  it("an illustration whose review never approves: the unit is given back, nothing stored, and the honest stop (no unit consumed)", async () => {
    const t = await teacher({ review: { ...CELL_REVIEW_APPROVED, conceptual_errors: ["aparece una pared celular"], verdict: "rejected" } });
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "blocked", delivered: false, automaticStop: { reason: "visual" } });
    expect(await t.imageUnits()).toBe(0);
    expect(await q("select 1 from public.generated_assets where adaptation_id = $1", [id])).toEqual([]);
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("reserved");
  });

  it("a plan without images (Free: monthly_images 0): no image is requested, no unit used — the honest stop that names the plan, never a text task", async () => {
    const t = await teacher({ plan: "free" });
    const id = await t.magic();
    expect(await t.status(id)).toMatchObject({ status: "blocked", delivered: false, automaticStop: { reason: "visual_plan" } });
    expect((await q<{ state: string }>("select state from public.adaptation_entitlements where adaptation_id = $1", [id]))[0]!.state).toBe("reserved");
    expect(await t.imageUnits()).toBe(0);
    expect(await q("select purpose from public.ai_runs where adaptation_id = $1 and purpose = 'image'", [id])).toEqual([]);
  });
});

describe("the read-only cost SQL (docs/qa/costes/coste-por-adaptacion.sql) runs on the real schema", () => {
  it("only SELECTs; for case B it shows each step, the illustration's cost and its one image", async () => {
    const t = await teacher();
    const id = await t.magic();
    const sql = readFileSync("docs/qa/costes/coste-por-adaptacion.sql", "utf8").replaceAll("00000000-0000-4000-8000-00000000c057", id);
    const statements = sql.replace(/^\s*--.*$/gm, "").split(";").map((x) => x.trim()).filter(Boolean);
    expect(statements).toHaveLength(6);
    expect(statements.every((x) => /^select\b/i.test(x))).toBe(true);
    const results: Array<Array<Record<string, unknown>>> = [];
    for (const statement of statements) results.push((await db.query<Record<string, unknown>>(statement)).rows);
    expect(results[0]!.map((r) => r.purpose)).toEqual(expect.arrayContaining(["image_brief", "image", "image_review"]));
    expect(results[1]![0]).toMatchObject({ images: 1 });
    expect(results[4]!.some((r) => Number(r.images) === 1)).toBe(true);
    expect(results[5]!.some((r) => r.workspace_id === t.user.workspaceId)).toBe(true);
  });
});

describe("migration 024: the illustration row, its isolation and its accounting", () => {
  it("complete or nothing, one per need and brief, immutable once written; `image_review` is a purpose of ai_runs", async () => {
    const t = await teacher();
    const id = await t.magic();
    const row = (await q<{ id: string; brief_fingerprint: string }>("select id, brief_fingerprint from public.generated_assets where adaptation_id = $1", [id]))[0]!;
    const insert = (over: Record<string, unknown>) =>
      asService(() =>
        q(
          `insert into public.generated_assets (workspace_id, adaptation_id, type, storage_path, need_key, brief_fingerprint, sha256, mime, width, height, bytes, model_alias, review, attempts)
           values ($1, $2, 'illustration', $3, $4, $5, $6, 'image/png', 1536, 1024, 100, 'IMAGE_QUALITY', '{}', 1)`,
          [t.user.workspaceId, id, over.path ?? `p-${Math.random()}`, over.need ?? "vis_1", over.brief ?? row.brief_fingerprint, over.sha ?? "d".repeat(64)],
        ),
      );
    await expect(insert({})).rejects.toThrow(/duplicate key|unique/i);
    await expect(asService(() => q("insert into public.generated_assets (workspace_id, adaptation_id, type, storage_path, sha256) values ($1, $2, 'illustration', $3, $4)", [t.user.workspaceId, id, `x-${Math.random()}`, "e".repeat(64)]))).rejects.toThrow(/generated_assets_illustration_complete|check/i);
    await expect(asService(() => q("update public.generated_assets set alt_text = 'otro' where id = $1", [row.id]))).rejects.toThrow(/no se modifica/);
    await expect(asService(() => q("insert into public.ai_runs (purpose, model_alias, provider, model, status) values ('image_review', 'STANDARD', 'anthropic', 'm', 'success')"))).resolves.toBeDefined();
    await expect(asService(() => q("insert into public.ai_runs (purpose, model_alias, provider, model, status) values ('image_magic', 'STANDARD', 'anthropic', 'm', 'success')"))).rejects.toThrow(/ai_runs_purpose_check|check/i);
  });

  it("members read their workspace's illustrations (row and object); another workspace reads nothing; the browser writes nothing", async () => {
    const t = await teacher();
    const id = await t.magic();
    const other = await createUser(db, `illustrations-other-${++n}@example.com`);
    const row = (await q<{ id: string; storage_path: string }>("select id, storage_path from public.generated_assets where adaptation_id = $1", [id]))[0]!;
    expect(await userGeneratedDeps(t.user, t.objects).row(row.id)).toMatchObject({ id: row.id, adaptation_id: id });
    expect(await userGeneratedDeps(other, t.objects).row(row.id)).toBeNull();
    expect(await userGeneratedDeps(other, t.objects).readObject(row.storage_path)).toBeNull();
    await expect(as(db, "authenticated", t.user.id, () => q("insert into public.generated_assets (workspace_id, adaptation_id, type, storage_path) values ($1, $2, 'illustration', 'x')", [t.user.workspaceId, id]))).rejects.toThrow(/permission denied/i);
    await expect(as(db, "authenticated", t.user.id, () => q("update public.generated_assets set alt_text = 'x' where id = $1", [row.id]))).rejects.toThrow(/permission denied/i);
  });

  it("the `image` quota: Free has none, fixture Max has units; a repeated key never charges twice; a refund gives it back", async () => {
    const free = await createUser(db, `illustrations-free-${++n}@example.com`);
    const consume = (ws: string, key: string) => asService(() => q<{ r: { allowed: boolean; duplicate?: boolean; limit: number } }>("select public.consume_quota($1, 'image', 1, null, null, $2) as r", [ws, key])).then((r) => r[0]!.r);
    expect(await consume(free.workspaceId, `k-${n}-a`)).toMatchObject({ allowed: false, limit: 0 });
    const max = await createUser(db, `illustrations-max-${++n}@example.com`);
    await subscribe(max.workspaceId, "max");
    expect(await consume(max.workspaceId, `k-${n}-b`)).toMatchObject({ allowed: true, limit: 50 });
    expect(await consume(max.workspaceId, `k-${n}-b`)).toMatchObject({ allowed: true, duplicate: true });
    await asService(() => q("select public.refund_quota($1)", [`k-${n}-b`]));
    expect(Number((await q<{ s: string }>("select sum(units)::text s from public.usage_events where workspace_id = $1 and kind = 'image'", [max.workspaceId]))[0]!.s)).toBe(0);
  });
});
