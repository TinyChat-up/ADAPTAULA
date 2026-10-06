import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/config/env.public";

/** Browser client (publishable key, RLS applies). Auth state and signed uploads only; business reads go through the server. */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
