import "server-only";
import { publicEnv } from "@/lib/config/env.public";
import { serverEnv } from "@/lib/config/env.server";
import { plannerV3Pilot } from "./pilot-gate";

/** The V3 pilot gate with this deployment's own configuration and backend (ADR-046). */
export function plannerV3PilotAllowed(workspaceId: string): boolean {
  const env = serverEnv();
  return plannerV3Pilot(env, workspaceId, publicEnv().NEXT_PUBLIC_SUPABASE_URL, process.env.VERCEL_ENV).allowed;
}
