import "server-only";
import { AIError } from "@/lib/ai/errors";
import { providerFor } from "@/lib/ai/runtime";
import { recreationIllustrationAvailability } from "@/lib/materials/visuals/illustrate/server";
import { createRecreationPlanner, RECREATION_PLANNER_LIMITS } from "@/lib/recreation/planner";
import { RECREATION_VISUAL_LIMITS } from "@/lib/recreation/visuals";
import { modelSelectionOf } from "../orchestration/versions";
import type { RecreationServices } from "./services";

/**
 * Production wiring of the recreation engine's services (ADR-053), over the product's own plumbing: `providerFor` (credentials from
 * the environment, the pilot's spend meter), the illustration gate (AI-images flag, isolated image pilot, plan, monthly image quota,
 * budget) and `ai_runs`. Selections come frozen in the adaptation, never from today's environment. A `mock` selection is refused here:
 * the engine is for the real providers, and simulating it belongs to tests (which inject their own services).
 */

/** Per adaptation: the pictures the engine may ask for and what they may cost (brief + image + review, every attempt). */
export const RECREATION_ILLUSTRATION_LIMITS = { maxImages: RECREATION_VISUAL_LIMITS.maxImages, budgetUsd: 1.2 } as const;

export const productionRecreation = (): RecreationServices => ({
  planner({ versions, ids, spentUsd, record }) {
    const component = versions.recreation?.planner;
    if (!component) throw new AIError("not_configured", "the adaptation has no recreation planner");
    const selection = modelSelectionOf(component);
    if (selection.provider === "mock") throw new AIError("not_configured", "the recreation engine does not run on the mock provider");
    return createRecreationPlanner({
      provider: providerFor(selection, ids.workspaceId),
      selection,
      budget: { limitUsd: RECREATION_PLANNER_LIMITS.budgetUsd, spentUsd },
      recordAiRun: record,
    });
  },
  async illustrations({ ids }) {
    const availability = await recreationIllustrationAvailability(ids, RECREATION_ILLUSTRATION_LIMITS);
    if (!availability.available) return { available: false, reason: availability.reason };
    return { available: true, deps: availability.deps, workspaceId: ids.workspaceId, recreationId: ids.adaptationId, producer: "recreation_visuals v1 · illustrate (OpenAI)" };
  },
});
