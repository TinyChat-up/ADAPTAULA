import { pilotBackendAllows } from "@/lib/pilots/backend";

/**
 * Whether `adaptation_planner@v3` may be CHOSEN for a new adaptation (ADR-046). Server-only configuration, never a value from the
 * browser. Every condition must hold, and the answer names the first that does not (a code, never a value):
 *  - the pilot flag is on and its mode matches the deployment: `local`/`staging` never on production, `production-pilot` only on it;
 *  - the workspace is THE one authorised;
 *  - the backend this deployment talks to is exactly the one named for the pilot (an isolated staging project, or loopback);
 *  - the private rules have a source, and the spend ledger has a budget: V3 never runs without its rules or without metering.
 * Adaptations freeze their versions when created, so this decides only what a NEW adaptation of that workspace may use.
 */
export interface PlannerV3PilotConfig {
  FLAG_PLANNER_V3_PILOT?: boolean;
  AI_PLANNER_V3_PILOT_MODE?: "local" | "staging" | "production-pilot";
  AI_PLANNER_V3_PILOT_WORKSPACE_ID?: string;
  AI_PLANNER_V3_PILOT_SUPABASE_URL?: string;
  AGENT_RULES_SOURCE?: "storage" | "directory";
  AI_PILOT_BUDGET_USD?: number;
}

export type PlannerV3PilotRefusal = "flag_off" | "no_mode" | "environment" | "workspace" | "backend" | "no_rules" | "no_budget";

export function plannerV3Pilot(config: PlannerV3PilotConfig, workspaceId: string, backendUrl: string, vercelEnv?: string): { allowed: true } | { allowed: false; reason: PlannerV3PilotRefusal } {
  const no = (reason: PlannerV3PilotRefusal) => ({ allowed: false as const, reason });
  if (config.FLAG_PLANNER_V3_PILOT !== true) return no("flag_off");
  const mode = config.AI_PLANNER_V3_PILOT_MODE;
  if (mode !== "local" && mode !== "staging" && mode !== "production-pilot") return no("no_mode");
  // Production runs only in its own explicit mode (like the image pilot), and that mode runs nowhere else: a copied variable
  // cannot open V3 on a Preview, and a Preview mode cannot open it on production.
  if ((mode === "production-pilot") !== (vercelEnv === "production")) return no("environment");
  if (!config.AI_PLANNER_V3_PILOT_WORKSPACE_ID || config.AI_PLANNER_V3_PILOT_WORKSPACE_ID !== workspaceId) return no("workspace");
  if (!pilotBackendAllows(mode, config.AI_PLANNER_V3_PILOT_SUPABASE_URL, backendUrl)) return no("backend");
  if (!config.AGENT_RULES_SOURCE) return no("no_rules");
  if (!(typeof config.AI_PILOT_BUDGET_USD === "number" && config.AI_PILOT_BUDGET_USD > 0)) return no("no_budget");
  return { allowed: true };
}
