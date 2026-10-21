import type { Block } from "@/lib/schemas/material-document";

/** Move only an exclusive resource already preceding its activity, within the same logical page.
 * Shared resources keep their source position; neither another activity's figure nor a later page is guessed/repeated. */
export function withAdjacentFigures(blocks: readonly Block[], uses: ReadonlyMap<string, number>): Block[] {
  const result: Block[] = [];
  const visual = (b: Block) => b.type === "image" || b.type === "table" || b.type === "chart";
  for (const block of blocks) {
    if (block.type === "activity") {
      const refs = new Set(block.resource_block_ids ?? []);
      const own = result.filter(b => visual(b) && refs.has(b.id) && uses.get(b.id) === 1);
      for (const resource of own) result.splice(result.indexOf(resource), 1);
      result.push(...own);
    }
    result.push(block);
  }
  return result;
}
