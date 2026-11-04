import { createHash } from "node:crypto";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { selectPrecedents, type PrecedentSelection } from "./precedents";
import type { AgentRules } from "./types";

/**
 * The rules block of one planner request (ADR-045): the stable files and the selected precedents, delimited and tagged with the
 * package version and hash. It is built in memory on the server and goes only to the model provider: callers keep the hash, the
 * selection and the length, never the text.
 */
export interface RulesBlock {
  text: string;
  version: string;
  package_sha256: string;
  /** sha256 of exactly what was sent (rules + selection), for reproducibility in records. */
  block_sha256: string;
  selection: PrecedentSelection;
}

/** Rule files are trusted, but a closing tag inside them must never end the block early. */
const guard = (text: string) => text.replace(/<\/?agent_rules/gi, (m) => m.replace("<", "‹"));

export async function buildRulesBlock(rules: AgentRules, analysis: MaterialAnalysis, context: Pick<AdaptationContext, "needs">): Promise<RulesBlock> {
  const selection = selectPrecedents(rules.precedents, analysis, context);
  const parts = rules.stable.map((f) => `# ===== ${f.path} =====\n${guard(f.text)}`);
  for (const c of selection.included) parts.push(`# ===== precedente ${c.id} =====\n${guard(await rules.readCase(c.id))}`);
  const body = parts.join("\n\n");
  const text = `<agent_rules version="${rules.version}" sha256="${rules.package_sha256}">\n${body}\n</agent_rules>`;
  return { text, version: rules.version, package_sha256: rules.package_sha256, block_sha256: createHash("sha256").update(text, "utf8").digest("hex"), selection };
}
