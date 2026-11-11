import { pilotBackendAllows } from '@/lib/pilots/backend';

/** Explicit server-only deployment configuration, never an entitlement supplied by a browser. */
export interface ImagePilotConfig {
  AI_IMAGES_PILOT_WORKSPACE_ID?: string;
  AI_IMAGES_PILOT_SUPABASE_URL?: string;
  AI_IMAGES_PILOT_MODE?: 'local' | 'staging' | 'production-pilot';
}
/** A flag alone cannot enable images: bind the experiment to ONE workspace and ONE isolated backend. */
export function imagePilotAllows(config: ImagePilotConfig, workspaceId: string, backendUrl: string, vercelEnv?: string): boolean {
  if (!config.AI_IMAGES_PILOT_MODE || !config.AI_IMAGES_PILOT_WORKSPACE_ID || config.AI_IMAGES_PILOT_WORKSPACE_ID !== workspaceId) return false;
  if (vercelEnv === 'production' && config.AI_IMAGES_PILOT_MODE !== 'production-pilot') return false;
  if (config.AI_IMAGES_PILOT_MODE === 'production-pilot' && vercelEnv !== 'production') return false;
  return pilotBackendAllows(config.AI_IMAGES_PILOT_MODE, config.AI_IMAGES_PILOT_SUPABASE_URL, backendUrl);
}
