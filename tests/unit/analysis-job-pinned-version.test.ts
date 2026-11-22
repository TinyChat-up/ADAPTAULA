import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseServerEnv } from "@/lib/config/env.server-schema";

const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const JOB = { id: "11111111-1111-4111-8111-111111111111", workspace_id: WORKSPACE, material_id: "33333333-3333-4333-8333-333333333333", attempts: 1 };

const state = vi.hoisted(() => ({ claim: null as unknown, env: {} as Record<string, unknown>, rpc: [] as Array<{ name: string; args: Record<string, unknown> }>, runs: [] as Array<Record<string, unknown>>, downloads: 0 }));

vi.mock("@/lib/config/env.server", () => ({ serverEnv: () => state.env }));
vi.mock("@/lib/materials/storage", () => ({ downloadSource: async () => { state.downloads++; return new TextEncoder().encode("%PDF-1.4 ficha"); } }));
vi.mock("@/lib/supabase/admin", () => {
  const table = (name: string) => {
    const result = name === "material_files" ? { data: [{ storage_path: "w/m/f.pdf", mime_type: "application/pdf", page_count: 1 }], error: null }
      : name === "materials" ? { data: { confirmed_fields: [], stage_slug: null, grade_slug: null, subject_slug: null, topic: null }, error: null }
      : { data: [], error: null };
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder, limit: () => builder, update: () => builder,
      single: () => Promise.resolve(result),
      insert: (row: Record<string, unknown>) => { if (name === "ai_runs") state.runs.push(row); return Promise.resolve({ error: null }); },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  };
  return { createAdminClient: () => ({ from: table, rpc: (name: string, args: Record<string, unknown>) => {
    state.rpc.push({ name, args });
    if (name === "claim_analysis_job") return Promise.resolve({ data: state.claim, error: null });
    if (name === "fail_analysis_job") return Promise.resolve({ data: args.p_retryable ? "retry" : "failed", error: null });
    return Promise.resolve({ data: true, error: null });
  } }) };
});

const { runAnalysisJob } = await import("@/lib/materials/analysis-job");
const rpc = (name: string) => state.rpc.filter((c) => c.name === name);
/** The configuration at EXECUTION time. The job was queued earlier, possibly with another one. */
const configure = (v4Workspaces: string | undefined) => { state.env = parseServerEnv({ AI_MODEL_STANDARD: "mock:analysis-fixture", AI_ANALYSIS_V4_WORKSPACES: v4Workspaces }); };
const queuedWith = (input: Record<string, unknown>) => { state.claim = { ...JOB, input }; };

describe("el trabajo de análisis respeta la versión fijada al encolarlo", () => {
  beforeEach(() => { Object.assign(state, { rpc: [], runs: [], downloads: 0 }); });

  it("encolado como v3 y con v4 activado después: se ejecuta como v3 y se registra v3", async () => {
    configure(WORKSPACE);
    queuedWith({ force: false, prompt_version: 3 });
    expect(await runAnalysisJob(JOB.id)).toBe("completed");
    expect(rpc("complete_analysis_job")[0]!.args).toMatchObject({ p_prompt_version: "material_analyzer@v3" });
    expect(state.runs.map((r) => r.prompt_version)).toEqual([3]);
  });

  it("encolado como v4 y con v4 retirado después: se ejecuta como v4 (no cambia a v3 en silencio)", async () => {
    configure(undefined);
    queuedWith({ force: false, prompt_version: 4 });
    await runAnalysisJob(JOB.id);
    // The default mock provider has no v4 fixture, so the run may fail; what matters is which analyzer was asked.
    expect(state.runs.length).toBeGreaterThan(0);
    expect(new Set(state.runs.map((r) => r.prompt_version))).toEqual(new Set([4]));
    expect(rpc("complete_analysis_job").every((c) => c.args.p_prompt_version === "material_analyzer@v4")).toBe(true);
  });

  it("un trabajo antiguo sin versión fijada sigue la configuración actual, como antes", async () => {
    configure(WORKSPACE);
    queuedWith({ force: false });
    await runAnalysisJob(JOB.id);
    expect(new Set(state.runs.map((r) => r.prompt_version))).toEqual(new Set([4]));
    configure(undefined);
    Object.assign(state, { rpc: [], runs: [] });
    queuedWith({});
    expect(await runAnalysisJob(JOB.id)).toBe("completed");
    expect(rpc("complete_analysis_job")[0]!.args).toMatchObject({ p_prompt_version: "material_analyzer@v3" });
  });

  it("una versión fijada que no se puede cumplir detiene el trabajo antes de leer el archivo o llamar a la IA", async () => {
    configure(WORKSPACE);
    for (const prompt_version of [99, 3.5, "3", null, 0]) {
      Object.assign(state, { rpc: [], runs: [], downloads: 0 });
      queuedWith({ force: false, prompt_version });
      expect(await runAnalysisJob(JOB.id)).toBe("failed");
      expect(rpc("fail_analysis_job")[0]!.args).toMatchObject({ p_code: "bad_request", p_retryable: false });
      expect(state.runs).toEqual([]);
      expect(state.downloads).toBe(0);
      expect(rpc("complete_analysis_job")).toEqual([]);
    }
  });
});
