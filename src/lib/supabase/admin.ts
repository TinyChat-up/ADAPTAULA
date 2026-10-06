import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/config/env.public";
import { serverEnv } from "@/lib/config/env.server";

/**
 * Service-role client: bypasses RLS. Only for Stripe webhooks, the job processor, quota accounting,
 * cron and /admin. Never call it from code that acts on behalf of a user request without
 * having resolved and checked the workspace first.
 */
export function createAdminClient() {
  const key = serverEnv().SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY no está configurada; el cliente de administración no está disponible.");

  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
