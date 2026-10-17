import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/auth/session", () => ({ getSupabase: async () => state.db }));

const { buildAccountExport } = await import("@/lib/privacy/export");

describe("personal data export", () => {
  it("includes personal documents and originals, but omits shared documents and credentials", async () => {
    const records: Record<string, unknown[]> = {
      workspace_members: [
        { workspace_id: "private", role: "owner", workspaces: { id: "private", name: "Personal", type: "personal" } },
        { workspace_id: "shared", role: "viewer", workspaces: { id: "shared", name: "Centro", type: "school" } },
      ],
      learner_profiles: [{ id: "learner", display_name: "Alias", functional_profile: {}, api_key: "never-export" }],
      classes: [], class_learners: [], materials: [{ id: "material", title: "Ficha", analysis: {} }],
      material_files: [{ material_id: "material", kind: "source", mime_type: "application/pdf", size_bytes: 4, storage_path: "private/material/original.pdf" }],
      adaptations: [{ id: "adaptation", title: "Adaptación" }],
      adaptation_versions: [{ id: "version", adaptation_id: "adaptation", document: {} }],
      adaptation_drafts: [{ id: "draft", adaptation_id: "adaptation", changes: { title: "Revisión" } }],
      adaptation_feedback: [],
    };
    const from = (table: string) => {
      let workspace = "";
      let head = false;
      const query = {
        select(_columns: string, opts?: { head?: boolean }) { head = Boolean(opts?.head); return query; },
        eq(_column: string, value: string) { workspace = value; return query; },
        limit() { return query; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(resolve(head ? { data: null, count: workspace === "private" ? 1 : 2, error: null }
            : { data: table === "workspace_members" ? records[table] : workspace === "private" ? records[table] : [], error: null }));
        },
      };
      return query;
    };
    state.db = {
      from,
      storage: { from: () => ({ download: async () => ({ data: new Blob(["%PDF"]), error: null }) }) },
    };
    const result = await buildAccountExport({ id: "teacher-a", email: "a@example.test" },
      { fullName: "Docente", teachingStages: [], onboardingCompleted: true });
    expect(result.workspaces).toHaveLength(2);
    const personal = result.workspaces[0] as Record<string, unknown>;
    const shared = result.workspaces[1] as Record<string, unknown>;
    expect(personal.included).toBe(true);
    expect((personal.adaptation_drafts as Array<Record<string, unknown>>)[0]).toMatchObject({ id: "draft" });
    expect((personal.original_files as Array<Record<string, unknown>>)[0]).toMatchObject({ embedded: true, data_base64: "JVBERg==" });
    expect(shared.included).toBe(false);
    expect(shared).not.toHaveProperty("materials");
    const json = JSON.stringify(result);
    expect(json).not.toContain("storage_path");
    expect(json).not.toContain("api_key");
  });
});
