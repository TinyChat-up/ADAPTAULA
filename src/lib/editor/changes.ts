import { z } from "zod";
import { PresentationSchema } from "@/lib/schemas/adaptation-context";
import { BlockIdSchema, MaterialDocumentSchema, type MaterialDocument } from "@/lib/schemas/material-document";

export const EditorChangesSchema = z.object({
  presentation: PresentationSchema.pick({ font_scale: true, line_spacing: true, spacing: true, contrast: true }).partial().strict(),
  activities: z.array(z.object({
    blockId: BlockIdSchema,
    prompt: z.string().trim().min(1).max(3000).optional(),
    lines: z.number().int().min(1).max(40).optional(),
    box: z.enum(["small", "medium", "large"]).optional(),
  }).strict()).max(120),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.activities.map((a) => a.blockId)).size !== value.activities.length)
    ctx.addIssue({ code: "custom", message: "Hay actividades repetidas." });
});
export type EditorChanges = z.infer<typeof EditorChangesSchema>;
export interface SavedDraft { revision: number; changes: EditorChanges; contentAcknowledged: boolean }
export const emptyChanges = (): EditorChanges => ({ presentation: {}, activities: [] });

/** Only these fields can change. Everything else, including resources, options and the key, comes from the saved original. */
export function applyEditorChanges(original: MaterialDocument, input: unknown) {
  const changes = EditorChangesSchema.parse(input);
  const document = structuredClone(original);
  document.presentation = { ...document.presentation, ...changes.presentation };
  const contentBlocks: string[] = [];
  const editedBlocks: string[] = [];
  for (const edit of changes.activities) {
    const block = document.pages.flatMap((p) => p.blocks).find((b) => b.id === edit.blockId);
    if (!block || block.type !== "activity") throw new Error("invalid_activity");
    if (edit.prompt !== undefined && edit.prompt !== block.prompt) {
      block.prompt = edit.prompt;
      contentBlocks.push(block.id);
    }
    if (edit.lines !== undefined) {
      if (block.response.kind !== "lines") throw new Error("invalid_response");
      block.response.lines = edit.lines;
    }
    if (edit.box !== undefined) {
      if (block.response.kind !== "box") throw new Error("invalid_response");
      block.response.size = edit.box;
    }
    block.trace.teacher_edited = true;
    editedBlocks.push(block.id);
  }
  return { document: MaterialDocumentSchema.parse(document), contentBlocks, editedBlocks };
}

export function editActivity(changes: EditorChanges, blockId: string, patch: Partial<Omit<EditorChanges["activities"][number], "blockId">>): EditorChanges {
  const existing = changes.activities.find((a) => a.blockId === blockId) ?? { blockId };
  return { ...changes, activities: [...changes.activities.filter((a) => a.blockId !== blockId), { ...existing, ...patch }] };
}
