import { groupActivities } from "@/lib/analysis/activity-groups";

/**
 * How many activities each page holds under `max_tasks_per_page`: the fewest pages the limit allows, filled as evenly as possible
 * (7 tasks, max 3 → 2 · 3 · 2, never 3 · 3 · 1). The first page takes the smaller share: it also carries the header, the title
 * and the orientation. Counts, not heights: the browser still paginates whatever a group does not fit.
 */
export function taskGroups(tasks: number, max: number): number[] {
  if (tasks <= max) return [tasks];
  const groups = Math.ceil(tasks / max);
  const base = Math.floor(tasks / groups);
  const extra = tasks - base * groups;
  return Array.from({ length: groups }, (_, i) => base + (i >= 1 && i <= extra ? 1 : 0));
}


/**
 * The same quotas when the activities are parts of exercises («3a»/«3b», «4a»/«4b»): a group is never split between pages while it
 * fits in one (its size ≤ `max`); a larger one is cut in chunks of `max`. Fewest pages first (a group that does not fit beside the
 * previous one starts the next page), then the most even loads, the first page smaller. Counts, never a smaller typeface or less
 * room: when keeping a group together would need more pages than splitting it, it costs that page. Without groups of more than one
 * part this is exactly `taskGroups`.
 */
export function groupedTaskQuotas(sizes: readonly number[], max: number): number[] {
  const total = sizes.reduce((n, s) => n + s, 0);
  if (sizes.every((s) => s <= 1)) return taskGroups(total, max);
  const units = sizes.flatMap((s) => (s <= max ? [s] : [...Array(Math.floor(s / max)).fill(max), ...(s % max ? [s % max] : [])]));
  type Plan = { loads: number[]; sumSquares: number };
  const better = (a: Plan, b: Plan) => {
    if (a.loads.length !== b.loads.length) return a.loads.length < b.loads.length;
    if (a.sumSquares !== b.sumSquares) return a.sumSquares < b.sumSquares;
    if (a.loads[0] !== b.loads[0]) return a.loads[0]! < b.loads[0]!;
    for (let i = 1; i < a.loads.length; i += 1) if (a.loads[i] !== b.loads[i]) return a.loads[i]! > b.loads[i]!;
    return false;
  };
  // best[i]: the best way to lay out the first i units; a page is a run of consecutive units whose total fits in `max`.
  const best: Array<Plan | undefined> = [{ loads: [], sumSquares: 0 }];
  for (let i = 1; i <= units.length; i += 1) {
    let load = 0;
    for (let j = i; j >= 1; j -= 1) {
      load += units[j - 1]!;
      if (load > max) break;
      const before = best[j - 1];
      if (!before) continue;
      const candidate: Plan = { loads: [...before.loads, load], sumSquares: before.sumSquares + load * load };
      if (!best[i] || better(candidate, best[i]!)) best[i] = candidate;
    }
  }
  return best[units.length]!.loads;
}

/** Quotas for the activities of one page, from their printed labels (`groupActivities` decides which ones are parts of one exercise). */
export function activityQuotas(labels: ReadonlyArray<string | null | undefined>, max: number): number[] {
  const groups = groupActivities(labels.map((label, i) => ({ id: String(i), label: label ?? null })));
  return groupedTaskQuotas(groups.map((g) => g.ids.length), max);
}
