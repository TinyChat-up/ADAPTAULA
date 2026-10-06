import "server-only";
import { serverEnv } from "./env.server";

export interface FeatureFlags {
  maxPlanEnabled: boolean;
  aiImagesEnabled: boolean;
  multiProfileGeneration: boolean;
  schoolWorkspaces: boolean;
  googleAuth: boolean;
  advancedEditor: boolean;
  providerFallback: boolean;
}

/** Flags are env vars: changing one needs a redeploy. Move a flag to `app_settings` if it must flip live. */
export function getFlags(): FeatureFlags {
  const env = serverEnv();
  return {
    maxPlanEnabled: env.FLAG_MAX_PLAN_ENABLED,
    aiImagesEnabled: env.FLAG_AI_IMAGES_ENABLED,
    multiProfileGeneration: env.FLAG_MULTI_PROFILE_GENERATION,
    schoolWorkspaces: env.FLAG_SCHOOL_WORKSPACES,
    googleAuth: env.FLAG_GOOGLE_AUTH,
    advancedEditor: env.FLAG_ADVANCED_EDITOR,
    providerFallback: env.FLAG_PROVIDER_FALLBACK,
  };
}
