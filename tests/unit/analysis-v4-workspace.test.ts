import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseServerEnv } from "@/lib/config/env.server-schema";

const PILOT = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const env = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/config/env.server", () => ({ serverEnv: () => env.value }));
const { analysisPromptVersionFor, activeAnalyzer, getAnalysisRuntime } = await import("@/lib/ai/runtime");
const { ANALYSIS_PROMPT_VERSION } = await import("@/lib/materials/analysis-job");

describe("analizador v4 solo para workspaces piloto", () => {
  beforeEach(() => {
    env.value = parseServerEnv({ AI_ANALYSIS_V4_WORKSPACES: PILOT, AI_MODEL_STANDARD: "mock:analysis-fixture" });
  });

  it("v4 para un workspace autorizado; v3 para uno no autorizado, sin workspace, con la lista vacía o mal formada", () => {
    const base = parseServerEnv({});
    expect(base.AI_ANALYSIS_PROMPT_VERSION).toBe(3);
    expect(base.AI_ANALYSIS_V4_WORKSPACES).toBeUndefined();
    expect(analysisPromptVersionFor({ ...base, AI_ANALYSIS_V4_WORKSPACES: PILOT }, PILOT)).toBe(4);
    expect(analysisPromptVersionFor({ ...base, AI_ANALYSIS_V4_WORKSPACES: ` ${PILOT.toUpperCase()} ,${OTHER}` }, PILOT)).toBe(4);
    expect(analysisPromptVersionFor({ ...base, AI_ANALYSIS_V4_WORKSPACES: PILOT }, OTHER)).toBe(3);
    expect(analysisPromptVersionFor({ ...base, AI_ANALYSIS_V4_WORKSPACES: PILOT }, null)).toBe(3);
    expect(analysisPromptVersionFor(base, PILOT)).toBe(3);
    expect(analysisPromptVersionFor({ ...base, AI_ANALYSIS_V4_WORKSPACES: "*,todos,1111" }, PILOT)).toBe(3);
    // The global default is untouched by the pilot list (and a later global change still applies to everyone else).
    expect(analysisPromptVersionFor({ ...base, AI_ANALYSIS_PROMPT_VERSION: 2, AI_ANALYSIS_V4_WORKSPACES: PILOT }, OTHER)).toBe(2);
  });

  it("el trabajo, la caché y el registro de versión usan el mismo analizador por workspace", () => {
    expect(getAnalysisRuntime(PILOT).analyzer).toMatchObject({ key: "material_analyzer", version: 4, schemaVersion: 4 });
    expect(getAnalysisRuntime(OTHER).analyzer).toMatchObject({ version: 3, schemaVersion: 3 });
    expect(activeAnalyzer(PILOT).version).toBe(4);
    expect(activeAnalyzer().version).toBe(3);
    // What `analysis_prompt_version` records and what the reuse cache compares: a v3 analysis is never reused for the pilot.
    expect(ANALYSIS_PROMPT_VERSION(PILOT)).toBe("material_analyzer@v4");
    expect(ANALYSIS_PROMPT_VERSION(OTHER)).toBe("material_analyzer@v3");
  });
});
