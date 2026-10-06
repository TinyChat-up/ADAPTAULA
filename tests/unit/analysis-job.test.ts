import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIError } from "@/lib/ai/errors";
import { MockProvider } from "@/lib/ai/providers/mock";
import { getMaterialAnalyzer } from "@/lib/ai/prompts";
import type { AIProvider, ModelSelection } from "@/lib/ai/types";

const JOB = { id: "11111111-1111-4111-8111-111111111111", workspace_id: "22222222-2222-4222-8222-222222222222", material_id: "33333333-3333-4333-8333-333333333333", attempts: 1 };

type Calls = { rpc: Array<{ name: string; args: Record<string, unknown> }>; inserts: Array<{ table: string; row: Record<string, unknown> }>; updates: string[] };
let calls: Calls;
let claim: unknown;
let completeResult: unknown;
let fileRows: unknown[];
let sourceBytes: Uint8Array | null;
let provider: AIProvider;
let analyzerVersion = 1;

const selection: ModelSelection = { alias: "STANDARD", provider: "mock", model: "default", effort: "medium" };

function table(name: string) {
  const result =
    name === "materials"
      ? { data: { confirmed_fields: ["topic"], stage_slug: null, grade_slug: null, subject_slug: null, topic: "Mi tema" }, error: null }
      : name === "material_files"
        ? { data: fileRows, error: null }
        : name === "subjects"
          ? { data: [{ slug: "matematicas", name: "Matemáticas" }], error: null }
          : name === "stages"
            ? { data: [{ slug: "primaria", name: "Educación Primaria" }], error: null }
            : name === "grades"
              ? { data: [{ slug: "5-primaria", name: "5.º de Primaria" }], error: null }
              : { data: null, error: null };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    limit: () => builder,
    single: () => Promise.resolve(result),
    update: () => {
      calls.updates.push(name);
      return builder;
    },
    insert: (row: Record<string, unknown>) => {
      calls.inserts.push({ table: name, row });
      return Promise.resolve({ error: null });
    },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (name: string) => table(name),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      if (name === "claim_analysis_job") return Promise.resolve({ data: claim, error: null });
      if (name === "complete_analysis_job") return Promise.resolve({ data: completeResult, error: null });
      if (name === "fail_analysis_job") return Promise.resolve({ data: args.p_retryable ? "retry" : "failed", error: null });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));
vi.mock("@/lib/materials/storage", () => ({ downloadSource: () => Promise.resolve(sourceBytes) }));
vi.mock("@/lib/ai/runtime", () => ({
  getAnalysisRuntime: () => ({ analyzer: getMaterialAnalyzer(analyzerVersion), selection, provider, maxRepairAttempts: 1, maxOutputTokens: 24_000 }),
  activeAnalyzer: () => getMaterialAnalyzer(analyzerVersion),
}));

const { runAnalysisJob } = await import("@/lib/materials/analysis-job");

const rpcNamed = (name: string) => calls.rpc.filter((c) => c.name === name);

beforeEach(() => {
  calls = { rpc: [], inserts: [], updates: [] };
  claim = JOB;
  completeResult = true;
  fileRows = [{ storage_path: "w/u/m/f.pdf", mime_type: "application/pdf", page_count: 1 }];
  sourceBytes = new TextEncoder().encode("%PDF-1.4 ficha");
  provider = new MockProvider();
  analyzerVersion = 1;
});

describe("runAnalysisJob", () => {
  it("does nothing when another worker holds the job (claim returns null): no duplicate processing", async () => {
    claim = null;
    expect(await runAnalysisJob(JOB.id)).toBe("skipped");
    expect(calls.rpc.map((c) => c.name)).toEqual(["claim_analysis_job"]);
    expect(calls.inserts).toEqual([]);
  });

  it("claims with the configured lease, analyzes, records the run and completes with fenced attempt and confirmed context", async () => {
    expect(await runAnalysisJob(JOB.id)).toBe("completed");

    expect(rpcNamed("claim_analysis_job")[0]!.args).toEqual({ p_job: JOB.id, p_lease_seconds: 330 });
    const complete = rpcNamed("complete_analysis_job")[0]!.args;
    expect(complete).toMatchObject({ p_job: JOB.id, p_attempt: 1, p_prompt_version: "material_analyzer@v1" });
    // The teacher confirmed `topic`: the model's topic must not be sent as an update.
    expect(complete.p_context).toEqual({ title: "Fracciones equivalentes", stage: "primaria", grade: "5-primaria", subject: "matematicas" });
    expect(complete.p_meta).toMatchObject({ source: "model", cost_usd: 0, prompt_version: 1, provider: "mock" });
    expect(rpcNamed("fail_analysis_job")).toEqual([]);

    const run = calls.inserts.find((i) => i.table === "ai_runs")!.row;
    expect(run).toMatchObject({
      workspace_id: JOB.workspace_id,
      job_id: JOB.id,
      material_id: JOB.material_id,
      purpose: "analyze",
      model_alias: "STANDARD",
      provider: "mock",
      prompt_key: "material_analyzer",
      prompt_version: 1,
      status: "success",
      error_code: null,
      estimated_cost_usd: 0,
    });
    expect(Object.keys(run)).not.toEqual(expect.arrayContaining(["content", "prompt", "text"]));
  });

  it("with prompt v2 it stores a v3 analysis, labels it with its prompt and still derives the confirmed-aware context", async () => {
    analyzerVersion = 2;
    expect(await runAnalysisJob(JOB.id)).toBe("completed");
    const complete = rpcNamed("complete_analysis_job")[0]!.args;
    expect(complete).toMatchObject({ p_prompt_version: "material_analyzer@v2" });
    expect(complete.p_analysis).toMatchObject({ schema_version: 3, structure: { counts: { activities: 4 } } });
    expect(complete.p_meta).toMatchObject({ schema_version: 3, prompt_version: 2, cache_hit: false, forced_reanalysis: false });
    expect(complete.p_context).toEqual({ title: "Fracciones equivalentes", stage: "primaria", grade: "5-primaria", subject: "matematicas" });
    expect(calls.inserts.find((i) => i.table === "ai_runs")!.row).toMatchObject({ prompt_version: 2 });
  });

  it("records that the teacher forced the re-analysis (forceReanalysis) in the provenance", async () => {
    claim = { ...JOB, input: { force: true, prompt_version: 1 } };
    expect(await runAnalysisJob(JOB.id)).toBe("completed");
    expect(rpcNamed("complete_analysis_job")[0]!.args.p_meta).toMatchObject({ forced_reanalysis: true, cache_hit: false });
  });

  it("does not report completion when it lost its lease (someone else took over)", async () => {
    completeResult = false;
    expect(await runAnalysisJob(JOB.id)).toBe("skipped");
    expect(rpcNamed("fail_analysis_job")).toEqual([]);
  });

  it("fails without retry when the stored file is missing", async () => {
    sourceBytes = null;
    expect(await runAnalysisJob(JOB.id)).toBe("failed");
    expect(rpcNamed("fail_analysis_job")[0]!.args).toMatchObject({ p_code: "file_missing", p_retryable: false, p_attempt: 1 });
  });

  it("fails without retry when there is no file row at all", async () => {
    fileRows = [];
    expect(await runAnalysisJob(JOB.id)).toBe("failed");
    expect(rpcNamed("fail_analysis_job")[0]!.args).toMatchObject({ p_code: "file_missing", p_retryable: false });
  });

  it("asks for a retry with backoff on a transient provider outage and records the failed run", async () => {
    provider = { name: "mock", generateStructured: () => Promise.reject(new AIError("provider_unavailable", "down")) };
    expect(await runAnalysisJob(JOB.id)).toBe("retry");
    expect(rpcNamed("fail_analysis_job")[0]!.args).toMatchObject({ p_code: "provider_unavailable", p_retryable: true, p_backoff_seconds: 45 });
    expect(calls.inserts.find((i) => i.table === "ai_runs")!.row).toMatchObject({ status: "error", error_code: "provider_unavailable" });
    expect(rpcNamed("complete_analysis_job")).toEqual([]);
  });

  it("does not retry output that keeps failing validation", async () => {
    sourceBytes = new TextEncoder().encode("%PDF-1.4 MOCK_INVALID");
    expect(await runAnalysisJob(JOB.id)).toBe("failed");
    expect(rpcNamed("fail_analysis_job")[0]!.args).toMatchObject({ p_code: "invalid_output", p_retryable: false });
    expect(calls.inserts.filter((i) => i.table === "ai_runs")).toHaveLength(2);
  });

  it("an unknown provider is a configuration failure the teacher can retry later, never a crash", async () => {
    provider = { name: "mock", generateStructured: () => Promise.reject(new TypeError("boom")) };
    expect(await runAnalysisJob(JOB.id)).toBe("retry");
    expect(rpcNamed("fail_analysis_job")[0]!.args).toMatchObject({ p_code: "unexpected" });
  });
});
