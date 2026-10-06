import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** One Supabase client per request, shared by every helper that needs it. */
export const getSupabase = cache(createClient);

/** Validated against Supabase Auth (never trust an unverified session on the server). */
export const getUser = cache(async () => {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
