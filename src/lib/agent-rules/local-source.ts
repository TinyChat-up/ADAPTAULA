import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AgentRulesError, type AgentRulesSource } from "./types";

/**
 * A local copy of the private rules, for private evaluations and the upload check (ADR-045). Refused when it sits inside a Git
 * checkout, so the rules cannot be read from, or end up in, a repository. Reads nothing outside its folder.
 */
/** Walks up from `dir` looking for a `.git` entry: any folder inside a Git checkout is refused. */
async function insideCheckout(dir: string): Promise<boolean> {
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
