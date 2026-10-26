import { allBlocks, MaterialDocumentSchema } from "@/lib/schemas/material-document";

/** Counts resources in the saved student document, never guesses API calls or monthly consumption. */
export function visualSupportResult(document: unknown): { generated: number; original: number; structured: number } | null {
  const parsed = MaterialDocumentSchema.safeParse(document);
  if (!parsed.success) return null;
  const generated = new Set<string>(), original = new Set<string>(), structured = new Set<string>();
  for (const block of allBlocks(parsed.data)) {
    if (block.type !== "image") continue;
    if (block.source.kind === "generated") generated.add(block.source.asset_id);
    if (block.source.kind === "original") original.add(block.source.visual_ref);
    if (block.source.kind === "figure") structured.add(JSON.stringify(block.source.spec));
  }
  return { generated: generated.size, original: original.size, structured: structured.size };
}
