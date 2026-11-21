import { AIError } from "../errors";
import type { AIProvider, ContentPart, StructuredRequest, StructuredResponse } from "../types";
import { mockAnalysisDraft } from "./mock-analysis";
import { mockAnalysisDraftV3 } from "./mock-analysis-v3";
import type { MaterialAnalysisV4Draft } from "@/lib/schemas/activity-comprehension";

function mockAnalysisDraftV4() {
  const draft = mockAnalysisDraftV3();
  const activities = draft.activities.map((item) => {
    const activity = { ...item };
    delete activity.answer;
    const comprehension: MaterialAnalysisV4Draft["activities"][number]["comprehension"] = {
      objectives: [], operations: [], student_decisions: [], information: [], essential_resources: [],
      response_format_role: null, evaluation: [], conditions: [], uncertainties: [],
    };
    return { ...activity, comprehension };
  });
  return { ...draft, activities };
}

const MARKERS = { fail: "MOCK_FAIL", invalid: "MOCK_INVALID", truncated: "MOCK_TRUNCATED", refusal: "MOCK_REFUSAL", slow: "MOCK_SLOW" } as const;
const SLOW_DELAY_MS = 8000;

function containsMarker(parts: readonly ContentPart[], marker: string): boolean {
  const needle = Buffer.from(marker);
  return parts.some((part) => {
    if (part.type === "text") return part.text.includes(marker);
    return Buffer.from(part.data).includes(needle);
  });
}

/**
 * Offline provider for tests, evals of the harness and local development. Test files can force a
 * behavior by containing a marker (MOCK_FAIL, MOCK_INVALID, MOCK_TRUNCATED, MOCK_REFUSAL, MOCK_SLOW), so end-to-end
 * tests exercise the error paths without any environment switch.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock" as const;

  /**
   * `fixtures`: scripted answers by output name, for tests and offline demos of pipelines that have no built-in fixture (the
   * recreation planner, the illustration brief and review). Each receives the request and returns the object the model would write.
   * Without it, the provider behaves exactly as before.
   */
  constructor(private readonly options: { delayMs?: number; fixtures?: Readonly<Record<string, (request: StructuredRequest) => unknown>> } = {}) {}

  async generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
    const started = Date.now();
    const parts = request.messages.flatMap((m) => m.content);
    const delay = containsMarker(parts, MARKERS.slow) ? SLOW_DELAY_MS : (this.options.delayMs ?? 0);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    if (containsMarker(parts, MARKERS.fail)) throw new AIError("provider_unavailable", "mock: simulated provider outage");

    const usage = { inputTokens: 1200, outputTokens: 900, cachedInputTokens: 0, cacheCreationInputTokens: 0 };
    const base = { usage, provider: "mock" as const, model: request.selection.model, latencyMs: Date.now() - started };

    if (containsMarker(parts, MARKERS.refusal)) return { ...base, text: "", stopReason: "refusal" };
    if (containsMarker(parts, MARKERS.truncated)) return { ...base, text: '{"identification":', stopReason: "max_tokens" };
    if (containsMarker(parts, MARKERS.invalid)) return { ...base, text: "esto no es json", stopReason: "complete" };

    const fixture = this.options.fixtures?.[request.output.name];
    if (fixture) return { ...base, text: JSON.stringify(fixture(request)), stopReason: "complete" };
    if (request.output.name === "material_analysis") return { ...base, text: JSON.stringify(mockAnalysisDraft()), stopReason: "complete" };
    if (request.output.name === "material_analysis_v3") return { ...base, text: JSON.stringify(mockAnalysisDraftV3()), stopReason: "complete" };
    if (request.output.name === "material_analysis_v4") return { ...base, text: JSON.stringify(mockAnalysisDraftV4()), stopReason: "complete" };
    throw new AIError("bad_request", `mock: no fixture for ${request.output.name}`);
  }
}
