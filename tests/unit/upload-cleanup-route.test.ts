import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "uploading", objectExists: true, deletes: 0 }));
vi.mock("@/lib/config/env.server", () => ({ serverEnv: () => ({ CRON_SECRET: "local-test-secret" }) }));
vi.mock("@/lib/materials/analysis-job", () => ({ recoverAnalysisJobs: async () => ({ found: 0, outcomes: {} }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let deleting = false;
      const q = {
        select: () => q, eq: () => q, lt: () => q, limit: () => q,
        delete: () => { deleting = true; return q; },
        then: (resolve: (v: unknown) => unknown) => {
          if (table === "material_files") return Promise.resolve(resolve({ data: [{ storage_path: "w/u/m/f.pdf" }], error: null }));
          if (deleting) return Promise.resolve(resolve({ data: [], error: null }));
          // The selected uploading snapshot is stale before the first Storage operation.
          state.status = "uploaded";
          return Promise.resolve(resolve({ data: [{ id: "material" }], error: null }));
        },
      };
      return q;
    },
    rpc: async () => { state.status = "uploaded"; return { data: [], error: null }; },
    storage: { from: () => ({ remove: async () => { state.objectExists = false; state.deletes++; return { data: [], error: null }; } }) },
  }),
}));

const { GET } = await import("@/app/api/cron/materials/route");
beforeEach(() => { state.status = "uploading"; state.objectExists = true; state.deletes = 0; });

describe("cron and a finalization that wins before cleanup claims", () => {
  it("never removes the completed original or counts a deletion from a stale selection", async () => {
    const result = await GET(new Request("http://localhost/api/cron/materials", { headers: { authorization: "Bearer local-test-secret" } }));
    expect(result.status).toBe(200);
    expect(state.status).toBe("uploaded");
    expect(state.objectExists).toBe(true);
    expect(state.deletes).toBe(0);
    expect(await result.json()).toMatchObject({ removed: 0 });
  });
});
