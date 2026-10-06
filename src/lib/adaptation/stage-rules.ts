import type { AGE_BANDS, REGISTERS } from "@/lib/schemas/adaptation-context";
import { normalizeText } from "./text";

/**
 * Chronological age and cognitive accessibility are different axes. A 15-year-old who needs short sentences gets short
 * sentences, not a childish sheet: the register and the look follow the stage, the supports follow the profile.
 */

type Stage = "primaria" | "eso" | "bachillerato" | "unknown";
type ImageStyle = "diagram" | "chart" | "icon" | "photo_like" | "illustration";

export interface StageRule {
  register: (typeof REGISTERS)[number];
  infantilization_guard: boolean;
  /** Styles a requested visual may have. Illustrations stay in Primaria. */
  image_styles: readonly ImageStyle[];
  default_decoration: "standard" | "reduced";
}

export const STAGE_RULES: Record<Stage, StageRule> = {
  primaria: { register: "child", infantilization_guard: false, image_styles: ["diagram", "chart", "icon", "photo_like", "illustration"], default_decoration: "standard" },
  eso: { register: "adolescent", infantilization_guard: true, image_styles: ["diagram", "chart", "icon", "photo_like"], default_decoration: "reduced" },
  bachillerato: { register: "young_adult", infantilization_guard: true, image_styles: ["diagram", "chart", "photo_like"], default_decoration: "reduced" },
  // Unknown stage: be conservative and treat it as secondary.
  unknown: { register: "adolescent", infantilization_guard: true, image_styles: ["diagram", "chart", "icon", "photo_like"], default_decoration: "reduced" },
};

export function ageBand(stage: Stage, grade: string | null): (typeof AGE_BANDS)[number] {
  if (stage === "bachillerato") return "16-18";
  if (stage === "eso") return "12-16";
  if (stage === "primaria") {
    const n = Number(grade?.split("-")[0]);
    if (Number.isInteger(n)) return n <= 3 ? "6-9" : "9-12";
    return "6-9";
  }
  return "unknown";
}

/**
 * Childish or condescending wording. Applied to student-facing text in ESO/Bachillerato (and as a warning in Primaria for
 * the condescending praise). Emojis are never part of the semantic document.
 */
const INFANTILIZING = [
  /\b(amiguit[oa]s?|campeon(a|es|as)?|chiquitin(a|es)?|pequenin(a|es)?|peques?|superheroes?|bichit[oa]s?|cosit[ao]s?|gordit[oa]s?)\b/,
  /¡\s*(muy bien|genial|bravo|fenomenal|estupendo|tu puedes|animo|lo vas a conseguir)/,
];
const EMOJI = /\p{Extended_Pictographic}/u;

export function infantilizingMatches(text: string): string[] {
  const norm = normalizeText(text);
  const found: string[] = [];
  for (const pattern of INFANTILIZING) {
    const m = norm.match(pattern);
    if (m) found.push(m[0].trim());
  }
  if (EMOJI.test(text)) found.push("emoji");
  return found;
}
