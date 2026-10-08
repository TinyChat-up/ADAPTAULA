import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_GENERATION_CYCLES, generationCyclesOf } from "@/lib/adaptation/orchestration/status";

describe("generation cycles", () => {
  it("the screens and the database agree on the limit (the database enforces it)", () => {
    const sql = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/20261001001800_cost_controls.sql"), "utf8");
    expect(sql).toContain(`public.adaptation_generation_cycles(p_adaptation) >= ${MAX_GENERATION_CYCLES} then`);
    expect(MAX_GENERATION_CYCLES).toBe(3);
  });

  it("counts distinct generation inputs: a retry of the same input and planning jobs are not new generations", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(generationCyclesOf([{ stage: "planning", input_fingerprint: a }, { stage: "generation", input_fingerprint: a }, { stage: "generation", input_fingerprint: a }])).toBe(1);
    expect(generationCyclesOf([{ stage: "generation", input_fingerprint: a }, { stage: "generation", input_fingerprint: b }, { stage: "generation", input_fingerprint: null }])).toBe(2);
  });
});
