import { describe, expect, it } from "vitest";
import { PROFILE_AREAS, areaOfDimension, dimensionsOfArea } from "@/lib/profiles/areas";
import { DIMENSION_COPY } from "@/lib/profiles/copy";
import { applyPreset, areasInUse, clearArea, compactProfile, setSupport } from "@/lib/profiles/draft";
import { PROFILE_PRESETS, findPreset } from "@/lib/profiles/presets";
import { summarizeProfile, teaser } from "@/lib/profiles/summary";
import { LearnerProfileInputSchema } from "@/lib/schemas/learner-profile";
import {
  DIMENSIONS,
  DIMENSION_GROUPS,
  FunctionalProfileSchema,
  activeSupports,
  emptyFunctionalProfile,
  type DimensionKey,
} from "@/lib/schemas/functional-profile";

describe("catalog coverage", () => {
  it("has friendly copy for every dimension", () => {
    for (const key of Object.keys(DIMENSIONS) as DimensionKey[]) {
      expect(DIMENSION_COPY[key].control.length, key).toBeGreaterThan(3);
      expect(DIMENSION_COPY[key].summary.length, key).toBeGreaterThan(3);
    }
  });

  it("puts every schema group in exactly one area", () => {
    for (const group of Object.keys(DIMENSION_GROUPS)) {
      const owners = PROFILE_AREAS.filter((a) => (a.groups as readonly string[]).includes(group));
      expect(owners, group).toHaveLength(1);
    }
    const all = PROFILE_AREAS.flatMap((a) => dimensionsOfArea(a));
    expect(new Set(all).size).toBe(Object.keys(DIMENSIONS).length);
  });

  it("offers the 11 areas teachers expect", () => expect(PROFILE_AREAS).toHaveLength(11));
});

describe("presets", () => {
  it("are 11 and each one yields a valid functional profile", () => {
    expect(PROFILE_PRESETS).toHaveLength(11);
    for (const preset of PROFILE_PRESETS) {
      const profile = applyPreset(preset);
      expect(FunctionalProfileSchema.safeParse(profile).success, preset.id).toBe(true);
      expect(activeSupports(profile).length, preset.id).toBeGreaterThan(0);
    }
  });

  it("never store the preset or a diagnosis inside the profile", () => {
    const stored = JSON.stringify(applyPreset(findPreset("tdah")!));
    expect(stored).not.toMatch(/tdah|tea|dislexia|preset/i);
    expect(Object.keys(applyPreset(findPreset("tdah")!)).sort()).toEqual(["allowances", "limits", "schema_version", "supports"]);
  });

  it("describe themselves as orientative starting points, not diagnoses", () => {
    for (const p of PROFILE_PRESETS) expect(p.description).not.toMatch(/diagn[oó]stic/i);
  });

  it("map to the expected dimensions", () => {
    const tdah = applyPreset(findPreset("tdah")!);
    expect(tdah.supports.instruction_chunking).toBe("high");
    expect(tdah.limits.max_visible_tasks).toBe(3);
    const altas = applyPreset(findPreset("altas-capacidades")!);
    expect(areasInUse(altas)).toEqual(["enrichment"]);
  });

  it("stay editable: any dimension can be changed or cleared afterwards", () => {
    let profile = applyPreset(findPreset("dislexia")!);
    profile = setSupport(profile, "decoding_support", "none");
    expect(profile.supports.decoding_support).toBeUndefined();
    profile = clearArea(profile, "reading");
    expect(areasInUse(profile)).not.toContain("reading");
  });
});

describe("draft helpers", () => {
  it("compactProfile drops `none` and empty values", () => {
    const compact = compactProfile({
      ...emptyFunctionalProfile(),
      supports: { font_size: "none", choice: "low" },
      limits: { max_visible_tasks: undefined },
      allowances: { calculator: false, keyboard: true },
    });
    expect(compact.supports).toEqual({ choice: "low" });
    expect(compact.limits).toEqual({});
    expect(compact.allowances).toEqual({ keyboard: true });
  });

  it("maps each dimension to its area", () => {
    expect(areaOfDimension("instruction_chunking").id).toBe("attention");
    expect(areaOfDimension("contrast").id).toBe("visual");
  });
});

describe("summarizeProfile (deterministic, no AI)", () => {
  it("explains an empty profile honestly", () => {
    const s = summarizeProfile(emptyFunctionalProfile());
    expect(s.isEmpty).toBe(true);
    expect(s.lines).toEqual([]);
  });

  it("lists strongest supports first, with limits and allowances", () => {
    const s = summarizeProfile(
      FunctionalProfileSchema.parse({
        schema_version: 1,
        supports: { visual_density: "low", instruction_chunking: "high", worked_examples: "medium" },
        limits: { max_visible_tasks: 3 },
        allowances: { calculator: true },
      }),
    );
    expect(s.lines.map((l) => l.text)).toEqual([
      "instrucciones breves y divididas en pasos",
      "ejemplos resueltos antes de tareas nuevas",
      "menos elementos por página",
      "como máximo 3 tareas visibles a la vez",
      "se permite el uso de calculadora",
    ]);
    expect(s.lines[0]?.level).toBe("mucho");
  });

  it("is a pure function of the profile", () => {
    const profile = applyPreset(findPreset("tea")!);
    expect(summarizeProfile(profile)).toEqual(summarizeProfile(structuredClone(profile)));
  });

  it("builds a short teaser for list rows", () => {
    const t = teaser(summarizeProfile(applyPreset(findPreset("tdah")!)));
    expect(t.shown).toHaveLength(3);
    expect(t.more).toBeGreaterThan(0);
  });
});

describe("LearnerProfileInputSchema", () => {
  const valid = {
    display_name: "  M.R.  ",
    stage_slug: "primaria",
    grade_slug: "5-primaria",
    functional_profile: emptyFunctionalProfile(),
  };

  it("trims the alias and accepts a valid input", () => {
    expect(LearnerProfileInputSchema.parse(valid).display_name).toBe("M.R.");
  });

  it("rejects an empty or overlong alias", () => {
    expect(LearnerProfileInputSchema.safeParse({ ...valid, display_name: "   " }).success).toBe(false);
    expect(LearnerProfileInputSchema.safeParse({ ...valid, display_name: "x".repeat(61) }).success).toBe(false);
  });

  it("rejects diagnostic keys and unknown fields cannot smuggle workspace ids", () => {
    const bad = { ...valid, functional_profile: { ...emptyFunctionalProfile(), supports: { tea: "high" } } };
    expect(LearnerProfileInputSchema.safeParse(bad).success).toBe(false);
    const parsed = LearnerProfileInputSchema.parse({ ...valid, workspace_id: "x", notes: "n" });
    expect(parsed).not.toHaveProperty("workspace_id");
    expect(parsed).not.toHaveProperty("notes");
  });
});
