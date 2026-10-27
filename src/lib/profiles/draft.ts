import {
  FUNCTIONAL_PROFILE_SCHEMA_VERSION,
  type DimensionKey,
  type FunctionalProfile,
  type SupportLevel,
} from "@/lib/schemas/functional-profile";
import { PROFILE_AREAS, areaOfDimension, dimensionsOfArea, type ProfileAreaId } from "./areas";
import type { ProfilePreset } from "./presets";

/** V1 keeps its sparse historical form; V2 preserves explicit «none» separately from not assessed. */
export function compactProfile(profile: FunctionalProfile): FunctionalProfile {
  const supports: FunctionalProfile["supports"] = {};
  for (const [key, level] of Object.entries(profile.supports) as [DimensionKey, SupportLevel][]) {
    if (level !== "none" || profile.schema_version === 2) supports[key] = level;
  }
  const limits = Object.fromEntries(Object.entries(profile.limits).filter(([, v]) => v !== undefined));
  const allowances = Object.fromEntries(Object.entries(profile.allowances).filter(([, v]) => v !== undefined && v !== false));
  return { schema_version: profile.schema_version, supports, limits, allowances, ...(profile.observations ? { observations: profile.observations } : {}) };
}

export function setSupport(profile: FunctionalProfile, key: DimensionKey, level: SupportLevel | "unknown"): FunctionalProfile {
  const supports = { ...profile.supports };
  if (level === "unknown") delete supports[key];
  else supports[key] = level;
  return compactProfile({ ...profile, schema_version: 2, supports });
}

/** Adding supports never lowers a teacher's intensity, changes their explicit «none» or erases their observations/permissions. */
export function addPresets(profile: FunctionalProfile, presets: readonly ProfilePreset[]): FunctionalProfile {
  const supports = { ...profile.supports }, limits = { ...profile.limits };
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  for (const preset of presets) {
    for (const [key, level] of Object.entries(preset.supports) as [DimensionKey, SupportLevel][]) {
      const current = supports[key];
      if (current !== "none" && (current === undefined || rank[level] > rank[current])) supports[key] = level;
    }
    for (const [key, value] of Object.entries(preset.limits ?? {}) as [keyof FunctionalProfile["limits"], number][]) limits[key] = Math.min(limits[key] ?? value, value);
  }
  return compactProfile({ ...profile, schema_version: 2, supports, limits });
}

export function replaceSupports(profile: FunctionalProfile, presets: readonly ProfilePreset[]): FunctionalProfile {
  return addPresets({ ...profile, supports: {}, limits: {}, allowances: {} }, presets);
}

/** Replaces the configuration with the preset's dimensions; every one stays editable afterwards. */
export function applyPreset(preset: ProfilePreset): FunctionalProfile {
  return compactProfile({
    schema_version: FUNCTIONAL_PROFILE_SCHEMA_VERSION,
    supports: { ...preset.supports },
    limits: { ...preset.limits },
    allowances: {},
  });
}

export function clearArea(profile: FunctionalProfile, areaId: ProfileAreaId): FunctionalProfile {
  const area = PROFILE_AREAS.find((a) => a.id === areaId);
  if (!area) return profile;
  const supports = { ...profile.supports };
  for (const key of dimensionsOfArea(area)) delete supports[key];
  return compactProfile({ ...profile, supports });
}

/** Areas that already carry at least one active dimension (used to open them when editing or after a preset). */
export function areasInUse(profile: FunctionalProfile): ProfileAreaId[] {
  const ids = new Set<ProfileAreaId>();
  for (const [key, level] of Object.entries(profile.supports) as [DimensionKey, SupportLevel][]) {
    if (level !== "none") ids.add(areaOfDimension(key).id);
  }
  return PROFILE_AREAS.filter((a) => ids.has(a.id)).map((a) => a.id);
}
