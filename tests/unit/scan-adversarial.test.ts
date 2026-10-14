import { describe, expect, it } from "vitest";
import { locateOnScan } from "@/lib/materials/visuals/auto/scan";
import { SCAN_ADVERSARIES, adversarialScan, type ScanAdversary } from "../support/scan-adversarial-case";

describe("PR #30: pixels and the analysis cannot prove visual identity", () => {
  for (const [id, description] of Object.entries(SCAN_ADVERSARIES)) {
    it(`${id}: ${description}`, () => {
      const { model } = adversarialScan(id as ScanAdversary);
      const result = locateOnScan(model, { id: "vis_1", shape: "figure", activityIds: ["act_1"] }, { visualsOnPage: 1, required: true });
      expect(result, `${id}: ${JSON.stringify(result)}`).toMatchObject({ accepted: false, bounds: null });
    });
  }
});
