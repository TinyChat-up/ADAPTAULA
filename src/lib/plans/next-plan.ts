import type { PublicPlan } from "@/lib/schemas/plan";

/** The plan to suggest when the current one is exhausted: the next one up that is currently on sale. */
export function nextPlan(plans: readonly PublicPlan[], currentSlug: string): PublicPlan | null {
  const sorted = [...plans].sort((a, b) => a.sort_order - b.sort_order);
  const index = sorted.findIndex((p) => p.slug === currentSlug);
  if (index === -1) return null;
  return sorted[index + 1] ?? null;
}
