import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AgentRulesSource } from "./types";

export { directoryRulesSource } from "./local-source";

/**
 * Server-only origins of the private rules (ADR-045). Storage: the private `agent-rules` bucket, read with the service role (no
 * client can list or read it: the bucket has no policy for any user role). The local-folder origin lives in `local-source.ts`.
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
