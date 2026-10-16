import type { MaterialDocument } from "@/lib/schemas/material-document";
import type { RenderModel } from "@/lib/render/model";
import { parseParagraphs } from "@/lib/render/inline";

/** CLARO preserves activity order, including when regrouping pages or attaching figures.
 * Verify that projection before binding controls: never match by an ambiguous label or similar text. */
export function activityLocations(document: MaterialDocument, model: RenderModel) {
  const blocks = document.pages.flatMap((p) => p.blocks).filter((b) => b.type === "activity");
  const nodes = model.pages.flatMap((p) => p.nodes.filter((n) => n.kind === "activity").map((node) => ({ node, page: p.number })));
  if (blocks.length !== nodes.length || blocks.some((block, i) => {
    const node = nodes[i]!.node;
    return node.label !== block.label || JSON.stringify(node.prompt) !== JSON.stringify(parseParagraphs(block.prompt));
  })) return [];
  return blocks.map((block, i) => ({ id: block.id, key: nodes[i]!.node.key, page: nodes[i]!.page, label: `Actividad ${block.label ?? i + 1}` }));
}
