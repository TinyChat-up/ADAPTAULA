import type { Block, MaterialDocument } from "@/lib/schemas/material-document";
import { allBlocks } from "@/lib/schemas/material-document";

/** Everything a student can read in a block. The answer key and teacher notes are not student-facing and never included. */
export function studentText(block: Block): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.text;
    case "reading_text":
      return [block.title ?? "", ...block.paragraphs, ...(block.segment_labels ?? [])].join("\n");
    case "instruction":
      return [block.text, ...(block.steps ?? [])].join("\n");
    case "activity": {
      const r = block.response;
      const response =
        r.kind === "choice" || r.kind === "order" || r.kind === "true_false"
          ? (r.kind === "choice" ? r.options : r.kind === "order" ? r.items : r.statements).map((o) => o.text)
          : r.kind === "match"
            ? [...r.left, ...r.right].map((o) => o.text)
            : r.kind === "fill_blank"
              ? [r.text, ...(r.word_bank ?? [])]
              : [];
      return [block.label ?? "", block.prompt, ...(block.steps ?? []), ...(block.requirements ?? []), ...response].join("\n");
    }
    case "list":
    case "checklist":
      return [block.type === "checklist" ? (block.title ?? "") : "", ...block.items].join("\n");
    case "table":
      return [block.caption ?? "", block.headers.join(" | "), ...block.rows.map((r) => r.join(" | ")), block.unit ?? ""].join("\n");
    case "chart":
      return [block.title ?? "", block.categories.join(" | "), ...block.series.map((s) => `${s.label ?? ""} ${s.values.join(" | ")}`), block.unit ?? "", block.x_label ?? "", block.y_label ?? ""].join("\n");
    case "image":
      return [block.alt_text, block.caption ?? ""].join("\n");
    case "help_box":
      return [block.title ?? "", block.text].join("\n");
    case "vocabulary":
      return [block.title ?? "", ...block.items.map((i) => `${i.term}: ${i.definition}`)].join("\n");
    case "worked_example":
      return [block.title ?? "", block.problem, ...block.steps, block.result].join("\n");
    case "sentence_starters":
      return block.items.join("\n");
    case "planner":
      return [block.title ?? "", ...block.slots.map((s) => s.label)].join("\n");
    case "math":
      return `${block.latex}\n${block.spoken_text}`;
  }
}

/** Blocks that trace back to an analysis element (an activity, a text, a visual). */
export function blocksFor(doc: MaterialDocument, ref: string): Block[] {
  return allBlocks(doc).filter((b) => b.trace.source_refs.includes(ref));
}

export function textOf(blocks: readonly Block[]): string {
  return blocks.map(studentText).join("\n");
}
