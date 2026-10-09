import type { PGlite } from "@electric-sql/pglite";
import type { ResourceDeps } from "@/lib/adaptation/resources/service";
import { resourceHarness } from "./resource-harness";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceDeps } from "@/lib/adaptation/orchestration/service";
import type { VisualDeps } from "@/lib/materials/visuals/service";
import { PdfEngineError, type PdfEngine } from "@/lib/render/print/engine";
import { createTestDb, createUser } from "./harness";
import { readerFor } from "./orchestration-harness";
import { deliveredWithVisuals, footprint, type World } from "./pdf-export-harness";
import { visualHarness } from "./visual-harness";

/**
 * `GET /api/adaptations/[id]/pdf` against the real database: the real Route Handler, loader, model and print HTML, with the
 * user's RLS. Only the session and the engine are simulated (the real Chromium runs in `tests/pdf/export.test.ts`).
 */

type Role = "owner" | "admin" | "teacher" | "viewer";
const engineCalls: string[] = [];
let engineAnswer: () => Promise<Uint8Array> = () => Promise.reject(new PdfEngineError("launch_failed", "sin Chromium en esta suite"));
const fakeEngine: PdfEngine = {
  name: "fake",
  async render(html) {
    engineCalls.push(html);
    const pdf = await engineAnswer();
    return { pdf, timings: { launchMs: 0, contentMs: 0, readyMs: 0, pdfMs: 0, totalMs: 0 }, readiness: { readyState: "complete", fontFamily: "", loadedWeights: [], images: 0, brokenImages: 0, stableFrames: true }, blockedRequests: [], engine: {} };
  },
};
const session: { role: Role; userId: string; workspaceId: string; deps: ServiceDeps; visuals: VisualDeps; resources: ResourceDeps } = { role: "owner", userId: "", workspaceId: "", deps: null as never, visuals: null as never, resources: null as never };

vi.mock("@/lib/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/context")>("@/lib/api/context");
  return { ...actual, getApiContext: async () => ({ ctx: { user: { id: session.userId }, workspace: { id: session.workspaceId }, role: session.role } }) };
});
vi.mock("@/lib/auth/session", () => ({ getSupabase: async () => ({}) }));
vi.mock("@/lib/adaptation/orchestration/server", () => ({ serviceDeps: () => session.deps }));
vi.mock("@/lib/materials/visuals/server", () => ({ visualDeps: () => session.visuals }));
vi.mock("@/lib/adaptation/resources/server", () => ({ resourceDeps: () => session.resources }));
vi.mock("@/lib/render/print/server", () => ({ pdfEngine: () => fakeEngine }));

const { GET } = await import("@/app/api/adaptations/[id]/pdf/route");

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
beforeEach(async () => {
  engineCalls.length = 0;
  engineAnswer = () => Promise.reject(new PdfEngineError("launch_failed", "sin Chromium en esta suite"));
  await db.query("update public.plans set monthly_adaptations = 100, features = features - 'unlimited_adaptations' where slug = 'free'");
});

const as = (w: World, role: Role = "owner") => Object.assign(session, { role, userId: w.user.id, workspaceId: w.user.workspaceId, deps: w.deps, visuals: w.visuals.deps, resources: resourceHarness(db, w.user).deps });
const get = (id: string) => GET(new Request(`http://localhost/api/adaptations/${id}/pdf`), { params: Promise.resolve({ id }) } as never);
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe("GET /api/adaptations/[id]/pdf · what is printed", () => {
  it("the engine receives the student sheet of the stored version, with the located crops pinned inline (no URL, no teacher content)", async () => {
    const w = await deliveredWithVisuals(db);
    as(w);
    const res = await get(w.id);
    expect(res.status).toBe(503); // the fake engine has no Chromium: the route answers a controlled error
    expect(engineCalls).toHaveLength(1);
    const html = engineCalls[0]!;
    const body = html.slice(html.indexOf("<body>"));
    expect((body.match(/src="data:image\/png;base64,/g) ?? []).length).toBe(2); // vis_1 and vis_2, the crops the teacher located
    expect(body).not.toMatch(/\/api\/|visuals\/vis_|storage|generated-assets|https?:\/\//);
    expect(body).not.toMatch(/ms-teacher|ms-chrome|data-app/);
    expect(html).toContain("Content-Security-Policy");
    // The header names the subject as the catalogue does, never by its key.
    expect(body).toContain("Matemáticas");
    expect(body).not.toMatch(/>matematicas</);
    expect(await errorOf(res)).toEqual({ code: "render_failed", message: "No hemos podido preparar el PDF. Inténtalo de nuevo en unos minutos." });
  }, 60_000);

  it("a produced file that is not a valid PDF is never sent (production validation)", async () => {
    const w = await deliveredWithVisuals(db);
    as(w);
    engineAnswer = async () => new TextEncoder().encode("%PDF-1.7 esto no es un PDF");
    const res = await get(w.id);
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  }, 60_000);
});

describe("GET /api/adaptations/[id]/pdf · authorisation and states", () => {
  it("a read-only member may download what they may read (the engine runs)", async () => {
    const w = await deliveredWithVisuals(db);
    as(w, "viewer");
    await get(w.id);
    expect(engineCalls).toHaveLength(1);
  }, 60_000);

  it("a user of another workspace finds nothing, and nothing is rendered", async () => {
    const w = await deliveredWithVisuals(db);
    const stranger = await createUser(db, `pdf-stranger-${Math.random().toString(36).slice(2)}@example.com`);
    Object.assign(session, { role: "owner", userId: stranger.id, workspaceId: stranger.workspaceId, deps: { ...w.deps, reader: readerFor(db, stranger) }, visuals: visualHarness(db, stranger).deps });
    const res = await get(w.id);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toEqual({ code: "not_found", message: "No hemos encontrado esa adaptación." });
    expect(engineCalls).toHaveLength(0);
  }, 60_000);

  it("an unknown adaptation and a malformed id are not found", async () => {
    const w = await deliveredWithVisuals(db, { locate: false });
    as(w);
    expect((await get("0b6f9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
    expect(engineCalls).toHaveLength(0);
  }, 60_000);

  it("an adaptation without a delivered sheet answers a controlled 409", async () => {
    const w = await deliveredWithVisuals(db, { deliver: false });
    as(w);
    const res = await get(w.id);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "not_ready", message: "Esta adaptación todavía no tiene una ficha entregada." });
    expect(engineCalls).toHaveLength(0);
  }, 60_000);

  it("a sheet the student view cannot show (an essential visual not located) is not printed", async () => {
    const w = await deliveredWithVisuals(db, { locate: false });
    as(w);
    const res = await get(w.id);
    expect(res.status).toBe(409);
    // A known, fixable cause: said as such (never the technical «inténtalo en unos minutos»).
    expect(await errorOf(res)).toEqual({ code: "resource_pending", message: "Falta completar un recurso de la ficha (una imagen). Complétalo en la ficha y podrás descargar el PDF." });
    expect(engineCalls).toHaveLength(0);
  }, 60_000);

  it("an unreadable stored document is not printed either", async () => {
    const w = await deliveredWithVisuals(db);
    as(w);
    await db.query("update public.adaptation_versions set document = '{\"schema_version\": 99}'::jsonb where adaptation_id = $1", [w.id]);
    const res = await get(w.id);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("not_renderable");
    expect(engineCalls).toHaveLength(0);
  }, 60_000);
});

describe("GET /api/adaptations/[id]/pdf · no side effects", () => {
  // Repeated one after another: PGlite has a single connection and the RLS readers switch role around each query, which two
  // simultaneous requests would trample (a test artefact, see run-endpoints.test.ts). An export takes no lock and writes nothing.
  it("three exports in a row (a double click and a retry): no model call, no ai_runs, no quota, no version, no job, no new crop, same document", async () => {
    const w = await deliveredWithVisuals(db);
    as(w);
    const calls = { ...w.spy };
    const before = await footprint(db, w);
    for (let i = 0; i < 3; i++) await get(w.id);
    expect(engineCalls).toHaveLength(3);
    expect(new Set(engineCalls).size).toBe(1); // deterministic: the same stored version prints the same HTML
    expect(await footprint(db, w)).toEqual(before);
    expect({ planner: w.spy.planner, generator: w.spy.generator, reviewer: w.spy.reviewer }).toEqual({ planner: calls.planner, generator: calls.generator, reviewer: calls.reviewer });
  }, 60_000);
});
