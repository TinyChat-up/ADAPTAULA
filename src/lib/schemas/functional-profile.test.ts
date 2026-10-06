import { describe, expect, it } from "vitest";
import {
  DIMENSIONS,
  DIMENSION_GROUPS,
  FunctionalProfileSchema,
  activeSupports,
  emptyFunctionalProfile,
} from "./functional-profile";

describe("FunctionalProfile", () => {
  it("accepts an empty profile", () => {
    expect(FunctionalProfileSchema.parse(emptyFunctionalProfile())).toEqual(emptyFunctionalProfile());
  });

  it("accepts support levels and precise limits", () => {
    const profile = {
      schema_version: 1,
      supports: { instruction_chunking: "high", literal_language: "high", visual_density: "medium" },
      limits: { max_instruction_words: 12, max_visible_tasks: 3 },
      allowances: { calculator: true },
    };
    expect(FunctionalProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("rejects unknown dimensions and diagnostic labels", () => {
    const profile = { ...emptyFunctionalProfile(), supports: { tdah: "high" } };
    expect(FunctionalProfileSchema.safeParse(profile).success).toBe(false);
  });

  it("rejects invalid support levels", () => {
    const profile = { ...emptyFunctionalProfile(), supports: { font_size: "maximum" } };
    expect(FunctionalProfileSchema.safeParse(profile).success).toBe(false);
  });

  it("returns only dimensions that need support", () => {
    const profile = FunctionalProfileSchema.parse({
      ...emptyFunctionalProfile(),
      supports: { font_size: "none", worked_examples: "medium", choice: "low" },
    });
    expect(activeSupports(profile)).toEqual([
      ["worked_examples", "medium"],
      ["choice", "low"],
    ]);
  });

  it("assigns every dimension to a known group with a Spanish label", () => {
    for (const [key, dim] of Object.entries(DIMENSIONS)) {
      expect(DIMENSION_GROUPS, key).toHaveProperty(dim.group);
      expect(dim.label.length, key).toBeGreaterThan(3);
    }
  });

  it("covers every group", () => {
    const used = new Set(Object.values(DIMENSIONS).map((d) => d.group));
    expect([...used].sort()).toEqual(Object.keys(DIMENSION_GROUPS).sort());
  });
});
