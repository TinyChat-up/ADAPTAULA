import {
  FUNCTIONAL_PROFILE_SCHEMA_VERSION,
  type DimensionKey,
  type FunctionalProfile,
  type SupportLevel,
} from "@/lib/schemas/functional-profile";
import { PROFILE_AREAS, areaOfDimension, dimensionsOfArea, type ProfileAreaId } from "./areas";
import type { ProfilePreset } from "./presets";

/** Sparse by design: `none` is represented by absence, which keeps stored profiles small and stable. */
export function compactProfile(profile: FunctionalProfile): FunctionalProfile {
  const supports: FunctionalProfile["supports"] = {};
  for (const [key, level] of Object.entries(profile.supports) as [DimensionKey, SupportLevel][]) {
    if (level !== "none") supports[key] = level;
  }
  const limits = Object.fromEntries(Object.entries(profile.limits).filter(([, v]) => v !== undefined));
  const allowances = Object.fromEntries(Object.entries(profile.allowances).filter(([, v]) => v !== undefined && v !== false));
  return { schema_version: FUNCTIONAL_PROFILE_SCHEMA_VERSION, supports, limits, allowances };
}

export function setSupport(profile: FunctionalProfile, key: DimensionKey, level: SupportLevel): FunctionalProfile {
  return compactProfile({ ...profile, supports: { ...profile.supports, [key]: level } });
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
