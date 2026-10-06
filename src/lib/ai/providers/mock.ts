import { AIError } from "../errors";
import type { AIProvider, ContentPart, StructuredRequest, StructuredResponse } from "../types";
import { mockAnalysisDraft } from "./mock-analysis";
import { mockAnalysisDraftV3 } from "./mock-analysis-v3";

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

  constructor(private readonly options: { delayMs?: number } = {}) {}

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

    if (request.output.name === "material_analysis") return { ...base, text: JSON.stringify(mockAnalysisDraft()), stopReason: "complete" };
    if (request.output.name === "material_analysis_v3") return { ...base, text: JSON.stringify(mockAnalysisDraftV3()), stopReason: "complete" };
    throw new AIError("bad_request", `mock: no fixture for ${request.output.name}`);
  }
}
