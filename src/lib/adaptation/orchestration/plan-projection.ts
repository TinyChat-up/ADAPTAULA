import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";

/**
 * What the review screen may learn about a decision beyond its own fields: a PROJECTION of two things that already exist in
 * the contract, never the internal object. Protected requirements come from the pinned analysis by id (type + wording as the
 * sheet states it: never `expected_answer`, which is not read here), and restrictions are the limits a reviewer wrote for this
 * same plan. Both are clipped; nothing else crosses.
 */
const MAX_VALUE = 200;
const MAX_ITEMS = 6;
const clip = (text: string) => (text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1).trimEnd()}…` : text);

export function projectPreserves(analysis: MaterialAnalysis | null, ids: readonly string[]): Array<{ type: string; value: string }> {
  if (!analysis) return [];
  return ids
    .flatMap((id) => {
      const element = analysis.protected_elements.find((p) => p.id === id);
      return element ? [{ type: element.type, value: clip(element.value) }] : [];
    })
    .slice(0, MAX_ITEMS);
}

export function projectRestrictions(restrictions: readonly unknown[] | undefined): string[] {
  return (restrictions ?? []).filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => clip(r.trim())).slice(0, MAX_ITEMS);
}
