/** Explicit server-only deployment configuration, never an entitlement supplied by a browser. */
export interface ImagePilotConfig {
  AI_IMAGES_PILOT_WORKSPACE_ID?: string;
  AI_IMAGES_PILOT_SUPABASE_URL?: string;
  AI_IMAGES_PILOT_MODE?: 'local' | 'staging';
}
/** A flag alone cannot enable images: bind the experiment to ONE workspace and ONE isolated backend. */
export function imagePilotAllows(config: ImagePilotConfig, workspaceId: string, backendUrl: string, vercelEnv?: string): boolean {
  if (vercelEnv === 'production' || !config.AI_IMAGES_PILOT_MODE || !config.AI_IMAGES_PILOT_WORKSPACE_ID || config.AI_IMAGES_PILOT_WORKSPACE_ID !== workspaceId) return false;
  try {
    const actual = new URL(backendUrl);
    const allowed = new URL(config.AI_IMAGES_PILOT_SUPABASE_URL ?? '');
    if (actual.href !== allowed.href || actual.username || actual.password || actual.search || actual.hash || actual.pathname !== '/') return false;
    if (config.AI_IMAGES_PILOT_MODE === 'local') return ['localhost', '127.0.0.1', '[::1]'].includes(actual.hostname);
    return actual.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(actual.hostname);
  } catch { return false; }
}
