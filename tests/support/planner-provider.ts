import type { AIProvider, StructuredRequest, StructuredResponse } from "@/lib/ai/types";
import { createModelPlanner } from "@/lib/adaptation/planner";
import type { AdaptationPlanner } from "@/lib/adaptation/services";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { realDecisions } from "./math-generation-case";

/**
 * The REAL model planner (`createModelPlanner`: request, stop reason, JSON parse, Zod contract) over a fake provider that answers
 * a scripted text: what a model could write for the fractions sheet (4.º de Primaria, five activities), valid or not. 0 real calls.
 */

export interface ScriptedAnswer {
  text: string;
  stopReason?: StructuredResponse["stopReason"];
  outputTokens?: number;
}

export interface ProviderLog {
  requests: Array<{ maxOutputTokens: number; text: string }>;
}

export function fakeProvider(answer: (call: number) => ScriptedAnswer, log: ProviderLog): AIProvider {
  return {
    name: "anthropic",
    generateStructured: async (request: StructuredRequest) => {
      log.requests.push({ maxOutputTokens: request.maxOutputTokens, text: request.messages.flatMap((m) => m.content.flatMap((p) => (p.type === "text" ? [p.text] : []))).join("\n") });
      const a = answer(log.requests.length);
      return { text: a.text, stopReason: a.stopReason ?? "complete", usage: { inputTokens: 6000, outputTokens: a.outputTokens ?? 900, cachedInputTokens: 0, cacheCreationInputTokens: 0 }, provider: "anthropic", model: "claude-sonnet-5-5", latencyMs: 10 };
    },
  };
}

/** `need_N` of each dimension, as the server numbers the context's active needs. */
export const needRef = (needs: ReadonlyArray<{ dimension: string }>) => (dimension: string) => `need_${needs.findIndex((n) => n.dimension === dimension) + 1}`;

/** A valid v2 draft for the fractions sheet: the six decisions of the real plan, cited by need reference. */
export function validFractionsDraft(needs: ReadonlyArray<{ dimension: string }>, analysis?: MaterialAnalysis) {
  const ref = needRef(needs);
  return { decisions: realDecisions(analysis).map(({ dimensions, ...rest }) => ({ ...rest, need_refs: dimensions.map(ref) })), summary: ["Apoyos de planificación y secuenciación en las actividades de fracciones."] };
}

/** A scripted planner hook that runs the real model planner over the fake provider (one provider log per adaptation). */
export function modelPlannerHook(analysisOf: () => MaterialAnalysis, answer: (call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => ScriptedAnswer, log: ProviderLog, maxOutputTokens = 4000) {
  return async (_inner: AdaptationPlanner, _call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => {
    const provider = fakeProvider((call) => answer(call, input), log);
    const planner = createModelPlanner({ analysis: analysisOf(), selection: { alias: "STANDARD", provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" }, provider, maxOutputTokens, version: 2 });
    return planner.plan(input);
  };
}
