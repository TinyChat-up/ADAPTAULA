import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { AgentRulesError, type AgentRulesSource } from "./types";

/**
 * Server-only origins of the private rules (ADR-045). Storage: the private `agent-rules` bucket, read with the service role (no
 * client can list or read it: the bucket has no policy for any user role). Directory: a local copy for private evaluations,
 * refused when it sits inside a checkout, so the rules cannot be read from (or end up in) the repository.
 */

export const AGENT_RULES_BUCKET = "agent-rules";

export function storageRulesSource(version: string): AgentRulesSource {
  const prefix = `${version}/`;
  return {
    kind: "storage",
    async read(file: string) {
      const { data, error } = await createAdminClient().storage.from(AGENT_RULES_BUCKET).download(`${prefix}${file}`);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

/** Walks up from `dir` looking for a `.git` entry: any folder inside a Git checkout is refused. */
async function insideCheckout(dir: string): Promise<boolean> {
  const { stat } = await import("node:fs/promises");
  let current = dir;
  for (;;) {
    try {
      await stat(path.join(current, ".git"));
      return true;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }
}

export async function directoryRulesSource(dir: string): Promise<AgentRulesSource> {
  const root = path.resolve(dir);
  if (await insideCheckout(root)) throw new AgentRulesError("not_configured", "La copia local de las reglas no puede estar dentro de un repositorio Git");
  return {
    kind: "directory",
    async read(file: string) {
      const full = path.resolve(root, file);
      if (!full.startsWith(`${root}${path.sep}`)) return null;
      try {
        return new Uint8Array(await readFile(full));
      } catch {
        return null;
      }
    },
  };
}
