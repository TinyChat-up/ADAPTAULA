import type { AIRunRecord } from "@/lib/ai/types";
import type { PipelineVersions } from "../orchestration/versions";

/**
 * The shape of the recreation engine's services as the orchestrator's dependencies see it (ADR-053). It names no server module, so
 * client code that only imports orchestration TYPES never reaches the engine; `services.ts` holds the precise types and the stages
 * narrow this port to them.
 */
export interface RecreationServicesPort {
  planner(input: { versions: PipelineVersions; ids: { workspaceId: string; adaptationId: string; materialId: string }; spentUsd(): Promise<number>; record(run: AIRunRecord): Promise<void> }): (...args: never[]) => Promise<unknown>;
  illustrations(input: { versions: PipelineVersions; ids: { workspaceId: string; adaptationId: string; materialId: string } }): Promise<unknown>;
}
