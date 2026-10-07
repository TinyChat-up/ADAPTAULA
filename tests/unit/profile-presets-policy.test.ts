import { describe, expect, it } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { applyPreset, setSupport } from "@/lib/profiles/draft";
import { PROFILE_PRESETS, findPreset } from "@/lib/profiles/presets";
import { FunctionalProfileSchema } from "@/lib/schemas/functional-profile";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";
import FROZEN from "./fixtures/profile-presets-dimensions.json";

/**
 * Presets are functional shortcuts, not diagnostic categories. Their visible names describe the support they configure; their ids
 * (internal, never shown, never stored) and the dimensions they set are frozen (`fixtures/profile-presets-dimensions.json`, taken
 * from the presets as they were before the renaming), so choosing one gives exactly the profile it gave before.
 */

const CLINICAL = /dislex|tdah|\btea\b|autis|asperger|discalcul|disgraf|discapacidad|trastorno|s[íi]ndrome|diagn[oó]stic|d[ée]ficit|hiperactiv|\btdl\b|altas capacidades|tratamiento|s[íi]ntoma|patolog|para alumn|con necesidades/i;

describe("profile presets · policy", () => {
  it("no visible name or description presents a diagnosis, a condition, a treatment or 'students with X'", () => {
    for (const p of PROFILE_PRESETS) {
      expect(p.label, p.id).not.toMatch(CLINICAL);
      expect(p.description, p.id).not.toMatch(CLINICAL);
    }
  });

  it("keeps the same internal ids, in the same order", () => {
    expect(PROFILE_PRESETS.map((p) => p.id)).toEqual(Object.keys(FROZEN));
  });

  it("each preset sets exactly the same functional dimensions and limits as before the renaming", () => {
    for (const p of PROFILE_PRESETS) {
      const frozen = (FROZEN as Record<string, { supports: Record<string, string>; limits: Record<string, number> | null }>)[p.id]!;
      expect(p.supports, p.id).toEqual(frozen.supports);
      expect(p.limits ?? null, p.id).toEqual(frozen.limits);
      expect(applyPreset(p).supports, p.id).toEqual(frozen.supports);
    }
  });

  it("the stored profile is only dimensions (no preset id, name or condition) and stays valid after editing", () => {
    for (const p of PROFILE_PRESETS) {
      const stored = applyPreset(p);
      expect(FunctionalProfileSchema.safeParse(stored).success, p.id).toBe(true);
      const text = JSON.stringify(stored);
      expect(text, p.id).not.toContain(`"${p.id}"`);
      expect(text, p.id).not.toContain(p.label);
      expect(text, p.id).not.toMatch(CLINICAL);
    }
    const edited = setSupport(applyPreset(findPreset("tdah")!), "instruction_chunking", "low");
    expect(edited.supports.instruction_chunking).toBe("low");
    expect(FunctionalProfileSchema.safeParse(edited).success).toBe(true);
  });

  it("what reaches the adaptation pipeline is functional needs: no preset id, name or diagnosis", () => {
    for (const p of PROFILE_PRESETS) {
      const { context } = buildAdaptationContext({ profile: applyPreset(p), education: { stage: null, grade: null, subject: null }, analysis: fractionsAnalysis(), adaptationType: "accessibility" });
      const sent = JSON.stringify(context);
      expect(sent, p.id).not.toMatch(CLINICAL);
      expect(sent, p.id).not.toContain(p.label);
      expect(context.needs.length, p.id).toBeGreaterThan(0);
      for (const need of context.needs) expect(Object.keys(p.supports), p.id).toContain(need.dimension);
    }
  });
});
