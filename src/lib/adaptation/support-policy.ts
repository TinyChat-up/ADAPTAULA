import type { Block } from "@/lib/schemas/material-document";
import { studentText } from "./document-text";
import { NEAR_DUPLICATE_OVERLAP, overlap, sentencesOf } from "./redundancy";

/**
 * Supports without overload («Hacer magia» 2.0, docs/ADAPTATION.md § Apoyos sin sobrecarga). A support that only repeats what
 * another support already prints (a per-activity checklist that restates the sheet's checklist, a reminder that says the same as
 * the strategy box above it) is dropped, and its decisions move to the support that stays: the functional need stays covered and
 * traceable, the student reads it once. Deterministic and conservative: only when EVERY sentence of the dropped block is (almost)
 * contained in the kept one; resources, activities, examples and the original's own blocks are never touched.
 */

const PRUNABLE: ReadonlySet<Block["type"]> = new Set(["checklist", "help_box", "list", "sentence_starters", "instruction"]);

const isSupport = (b: Block) => (b.trace.origin === "support" || b.trace.origin === "extension") && PRUNABLE.has(b.type);

/** True when every sentence of `candidate` is (near-)contained in some sentence of `kept`. Blocks too short to compare never are. */
export function restates(candidate: Block, kept: Block): boolean {
  const mine = sentencesOf(studentText(candidate));
  if (mine.length === 0) return false;
  const theirs = sentencesOf(studentText(kept));
  return mine.every((s) => theirs.some((t) => s === t || overlap(s, t) >= NEAR_DUPLICATE_OVERLAP));
}

export interface PrunedSupport {
  dropped: string;
  keptIn: string;
  decisionIds: string[];
}

const absorb = (kept: Block, dropped: Block): Block => ({
  ...kept,
  trace: {
    ...kept.trace,
    decision_ids: [...new Set([...kept.trace.decision_ids, ...dropped.trace.decision_ids])],
    source_refs: kept.trace.source_refs.length === 0 ? kept.trace.source_refs : [...new Set([...kept.trace.source_refs, ...dropped.trace.source_refs])],
  },
});

/**
 * The sheet-level supports and the supports placed after each unit, without the ones that restate a support already printed (the
 * sheet's first, then an earlier one of the same unit). Returns the kept blocks (with the absorbed decisions) and what was pruned.
 */
export function pruneRedundantSupports(head: Block[], after: Map<string, Block[]>): { head: Block[]; after: Map<string, Block[]>; pruned: PrunedSupport[] } {
  const pruned: PrunedSupport[] = [];
  const keptHead: Block[] = [];
  const merge = (list: Block[], block: Block): boolean => {
    if (!isSupport(block)) return false;
    // Same type only: the absorbed decision must still be traced to a block of a kind it authorises.
    const i = list.findIndex((k) => isSupport(k) && k.type === block.type && restates(block, k));
    if (i < 0) return false;
    pruned.push({ dropped: block.id, keptIn: list[i]!.id, decisionIds: block.trace.decision_ids });
    list[i] = absorb(list[i]!, block);
    return true;
  };
  for (const block of head) if (!merge(keptHead, block)) keptHead.push(block);
  const keptAfter = new Map<string, Block[]>();
  for (const [ref, blocks] of after) {
    const own: Block[] = [];
    for (const block of blocks) {
      if (merge(keptHead, block)) continue;
      if (!merge(own, block)) own.push(block);
    }
    keptAfter.set(ref, own);
  }
  return { head: keptHead, after: keptAfter, pruned };
}
