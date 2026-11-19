import type { AIRunRecord } from "@/lib/ai/types";
import type { Planner } from "@/lib/recreation/pilot";
import type { IllustrationGate } from "@/lib/recreation/visuals";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { PipelineVersions } from "../orchestration/versions";

/**
 * What the recreation engine's stages need from the outside (ADR-053): the plan's model call and the illustration gate. Production
 * builds them with the product's providers, quotas and budgets (`server.ts`); tests inject simulated Claude and OpenAI. Nothing here
 * knows a model name: the selections come frozen in the adaptation's `pipeline_versions`.
 */
export interface RecreationRunIds {
  workspaceId: string;
  adaptationId: string;
  materialId: string;
}

export interface RecreationServices {
  /** The planner (Claude) of this adaptation. `spentUsd` is what its earlier plan calls cost; `record` writes each call to `ai_runs`. */
  planner(input: { versions: PipelineVersions; ids: RecreationRunIds; spentUsd(): Promise<number>; record(run: AIRunRecord): Promise<void> }): Planner;
  /** The illustration gate (flag, image pilot, plan, monthly quota, budget): unavailable means a sheet without generated pictures. */
  illustrations(input: { versions: PipelineVersions; ids: RecreationRunIds }): Promise<IllustrationGate>;
  /** Option A: which of these original pictures are located and trusted, to be reused as they are. Absent: none. */
  locatedOriginals?(input: { ids: RecreationRunIds; analysis: MaterialAnalysis; analysisFingerprint: string; visualIds: readonly string[] }): Promise<ReadonlySet<string>>;
}
