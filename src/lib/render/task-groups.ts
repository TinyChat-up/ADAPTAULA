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

