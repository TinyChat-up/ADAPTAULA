import { describe, expect, it } from "vitest";
import { mockAnalysisDraft } from "@/lib/ai/providers/mock-analysis";
import { normalizeAnalysisV2 } from "@/lib/analysis/normalize-v2";
import { stepStates } from "@/components/materials/analysis-progress";
import { pickReusableAnalysis, type CacheCandidate } from "@/lib/materials/cache";
import { AnalysisMetaSchema, type AnalysisMeta } from "@/lib/schemas/material-analysis";

const analysis = normalizeAnalysisV2(mockAnalysisDraft(), { pageCount: 1 }).analysis;
const meta: AnalysisMeta = {
  schema_version: 2,
  prompt_key: "material_analyzer",
  prompt_version: 1,
  source: "model",
  cache_hit: false,
  forced_reanalysis: false,
  model_alias: "STANDARD",
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  effort: "medium",
  analyzed_at: "2026-10-02T08:00:00.000Z",
  attempts: 1,
  cost_usd: 0.07,
  warnings: [],
  reused_from_material_id: null,
};
const candidate = (patch: Partial<CacheCandidate> = {}): CacheCandidate => ({
  id: "m1",
  status: "analyzed",
  analysis_prompt_version: "material_analyzer@v1",
  analysis,
  analysis_meta: meta,
  ...patch,
});
// What the active prompt (v1) stores: schema v2. Reuse across schema versions is covered in analysis-upgrade.test.ts.
const current = { promptVersion: "material_analyzer@v1", schemaVersion: 2 };

describe("analysis cache (reuse inside one workspace)", () => {
  it("reuses an analysis made with the same prompt and schema versions", () => {
    expect(pickReusableAnalysis([candidate()], current)).toMatchObject({ sourceId: "m1" });
  });

  it("prefers the most recent compatible candidate", () => {
    expect(pickReusableAnalysis([candidate({ id: "nuevo" }), candidate({ id: "viejo" })], current)?.sourceId).toBe("nuevo");
  });

  it("does not reuse after the prompt version changes", () => {
    expect(pickReusableAnalysis([candidate()], { promptVersion: "material_analyzer@v2", schemaVersion: 2 })).toBeNull();
  });

  it("does not reuse an analysis stored with another schema version", () => {
    expect(pickReusableAnalysis([candidate({ analysis_meta: { ...meta, schema_version: 1 } })], current)).toBeNull();
  });

  it("never reuses a failed, queued or in-progress material", () => {
    for (const status of ["failed", "queued", "analyzing", "uploaded", "uploading"]) {
      expect(pickReusableAnalysis([candidate({ status })], current), status).toBeNull();
    }
  });

  it("skips a corrupt analysis and falls through to the next candidate", () => {
    const result = pickReusableAnalysis([candidate({ id: "roto", analysis: { not: "valid" } }), candidate({ id: "bueno" })], current);
    expect(result?.sourceId).toBe("bueno");
    expect(pickReusableAnalysis([candidate({ analysis_meta: null })], current)).toBeNull();
  });

  it("a model change alone does not invalidate the cache; it is only recorded in the meta", () => {
    const other = candidate({ analysis_meta: { ...meta, model: "otro-modelo", provider: "openai" } });
    expect(pickReusableAnalysis([other], current)?.meta.model).toBe("otro-modelo");
  });
});

describe("analysis_meta provenance (needed by the benchmarks)", () => {
  it("records provider, real model, prompt and schema versions, date, cache hit and forced re-analysis", () => {
    const parsed = AnalysisMetaSchema.parse(meta);
    expect(parsed).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      prompt_version: 1,
      schema_version: 2,
      analyzed_at: "2026-10-02T08:00:00.000Z",
      cache_hit: false,
      forced_reanalysis: false,
    });
  });

  it("a meta stored before cache_hit/forced_reanalysis existed still parses (both default to false) and is reusable", () => {
    const legacy: Record<string, unknown> = { ...meta };
    delete legacy.cache_hit;
    delete legacy.forced_reanalysis;
    expect(AnalysisMetaSchema.parse(legacy)).toMatchObject({ cache_hit: false, forced_reanalysis: false });
    expect(pickReusableAnalysis([candidate({ analysis_meta: legacy })], current)?.sourceId).toBe("m1");
  });
});

describe("progress steps reflect the real job state (no timers, no estimates)", () => {
  it("shows only the received file while the job waits in the queue", () => {
    expect(stepStates("queued", null)).toEqual(["done", "pending", "pending", "pending"]);
    expect(stepStates("uploaded", null)).toEqual(["done", "pending", "pending", "pending"]);
  });

  it("follows the step the server reports", () => {
    expect(stepStates("analyzing", "analyzing")).toEqual(["done", "active", "pending", "pending"]);
    expect(stepStates("analyzing", "validating")).toEqual(["done", "done", "active", "pending"]);
    expect(stepStates("analyzing", "saving")).toEqual(["done", "done", "done", "active"]);
    expect(stepStates("analyzing", null)).toEqual(["done", "active", "pending", "pending"]);
  });

  it("completes everything once analyzed", () => {
    expect(stepStates("analyzed", null)).toEqual(["done", "done", "done", "done"]);
  });
});
