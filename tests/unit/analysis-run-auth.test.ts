import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/materials/[id]/analysis/run`: running the pending analysis takes the capability that uploads and re-analyses take
 * (a writer). A read-only member is refused with the project's 403 BEFORE the material is read or anything is processed, and can
 * still read the status.
 */

type Role = "owner" | "admin" | "teacher" | "viewer";
let role: Role = "owner";
const process = vi.fn(async (_id: string) => "completed" as const);
const detail = vi.fn(async (_ws: string, id: string) => ({ material: { id, status: "queued", failure_code: null }, job: { status: "queued", step: null, progress: 0 } }));

vi.mock("@/lib/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/context")>("@/lib/api/context");
  return { ...actual, getApiContext: async () => ({ ctx: { user: { id: "u1" }, workspace: { id: "w1" }, role } }) };
});
vi.mock("@/lib/materials/analysis-job", () => ({ processMaterialAnalysis: (id: string) => process(id) }));
vi.mock("@/lib/materials/repository", () => ({ getMaterialDetail: (ws: string, id: string) => detail(ws, id) }));

const ID = "33333333-3333-4333-8333-333333333333";
const { POST } = await import("@/app/api/materials/[id]/analysis/run/route");
const { GET } = await import("@/app/api/materials/[id]/status/route");
const ctx = { params: Promise.resolve({ id: ID }) } as never;

beforeEach(() => {
  role = "owner";
  process.mockClear();
  detail.mockClear();
});

describe("analysis run endpoint · authorization", () => {
  it("owner, admin and teacher run the pending analysis, once per request", async () => {
    for (const r of ["owner", "admin", "teacher"] as const) {
      role = r;
      process.mockClear();
      const res = await POST(new Request("http://localhost/x", { method: "POST" }), ctx);
      expect(res.status, r).toBe(200);
      expect(process, r).toHaveBeenCalledTimes(1);
      expect(process).toHaveBeenCalledWith(ID);
    }
  });

  it("a read-only member gets 403 before anything is read or processed: zero processor calls", async () => {
    role = "viewer";
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden", message: "Tu rol no permite subir o modificar materiales." } });
    expect(process).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });

  it("the status stays readable for a read-only member and never processes anything", async () => {
    role = "viewer";
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "queued" });
    expect(process).not.toHaveBeenCalled();
  });

  it("nothing pending (already analysed): a writer's request makes no call", async () => {
    detail.mockImplementation(async (_ws, id) => ({ material: { id, status: "analyzed", failure_code: null }, job: null }) as never);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(process).not.toHaveBeenCalled();
  });
});
