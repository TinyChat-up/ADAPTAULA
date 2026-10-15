import { beforeEach, it, expect, vi } from "vitest";
import { editorDocument } from "../support/editor-document";

const session = vi.hoisted(() => ({ role: "teacher", kind: "ok", version: 1 }));
const save = vi.hoisted(() => vi.fn(async () => ({ revision: 1 })));
vi.mock("@/lib/api/context", async () => ({ ...(await vi.importActual("@/lib/api/context")), getApiContext: async () => ({ ctx: { role: session.role } }) }));
vi.mock("@/lib/auth/session", () => ({ getSupabase: async () => ({}) }));
vi.mock("@/lib/render/load", () => ({ loadRenderInput: async () => ({ kind: session.kind, version: { version: session.version }, document: editorDocument() }) }));
vi.mock("@/lib/editor/store", () => ({ draftStore: () => ({ save }) }));
const { PUT } = await import("@/app/api/adaptations/[id]/draft/route");
const id = "5a432569-5b0c-471d-8ef8-04393b18a937";
const changes = { presentation: {}, activities: [{ blockId: "blk_task1", prompt: "Compara 20 cm y 40 cm. Explica tu elección." }] };
const run = (body: unknown) => PUT(new Request(`http://localhost/api/adaptations/${id}/draft`, { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) } as never);
const body = (acknowledged = false) => ({ baseVersion: 1, revision: 0, changes, acknowledged });
beforeEach(() => { session.role = "teacher"; session.kind = "ok"; session.version = 1; save.mockClear(); });

it("refuses changed pedagogical content without explicit acknowledgement", async () => {
  expect((await run(body())).status).toBe(422);
  expect(save).not.toHaveBeenCalled();
  expect((await run(body(true))).status).toBe(200);
  expect(save).toHaveBeenCalledWith(id, 1, 0, changes, true);
});
it("allows presentation-only drafts without implying content validation", async () => {
  expect((await run({ ...body(), changes: { presentation: { spacing: "wide" }, activities: [] } })).status).toBe(200);
});
it("rejects a forged key, missing activity, changed base version and extra identity fields", async () => {
  expect((await run({ ...body(true), changes: { ...changes, answer_key: [] } })).status).toBe(400);
  expect((await run({ ...body(true), changes: { ...changes, activities: [{ blockId: "blk_fake1", prompt: "Otro texto" }] } })).status).toBe(400);
  expect((await run({ ...body(true), baseVersion: 9 })).status).toBe(409);
  expect((await run({ ...body(true), workspaceId: id })).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});
it("a foreign adaptation is not found and a viewer cannot edit", async () => {
  session.kind = "not_found";
  expect((await run(body(true))).status).toBe(404);
  session.kind = "ok"; session.role = "viewer";
  expect((await run(body(true))).status).toBe(403);
  expect(save).not.toHaveBeenCalled();
});
