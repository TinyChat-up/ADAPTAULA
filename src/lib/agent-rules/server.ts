import "server-only";
import { serverEnv } from "@/lib/config/env.server";
import { loadAgentRules } from "./loader";
import { AGENT_RULES_V22 } from "./manifest-v22";
import { directoryRulesSource, storageRulesSource } from "./sources";
import { AgentRulesError, type AgentRules, type AgentRulesManifest } from "./types";

/**
 * The rules the planner uses, verified once per process (ADR-045). A failed load is not cached: the next request tries again,
 * and never falls back to unverified or older rules.
 */
export const ACTIVE_AGENT_RULES: AgentRulesManifest = AGENT_RULES_V22;

let cached: Promise<AgentRules> | null = null;

export function getAgentRules(manifest: AgentRulesManifest = ACTIVE_AGENT_RULES): Promise<AgentRules> {
  if (cached) return cached;
  const env = serverEnv();
  const load = (async () => {
    if (env.AGENT_RULES_SOURCE === "storage") return loadAgentRules(storageRulesSource(manifest.version), manifest);
    if (env.AGENT_RULES_SOURCE === "directory" && env.AGENT_RULES_DIR) return loadAgentRules(await directoryRulesSource(env.AGENT_RULES_DIR), manifest);
    throw new AgentRulesError("not_configured", "Las reglas pedagógicas privadas no están configuradas (AGENT_RULES_SOURCE)");
  })();
  cached = load;
  load.catch(() => {
    if (cached === load) cached = null;
  });
  return load;
}
