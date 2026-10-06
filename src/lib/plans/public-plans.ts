import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicEnv } from "@/lib/config/env.public";
import { getFlags } from "@/lib/config/flags";
import { PublicPlanSchema, type PublicPlan } from "@/lib/schemas/plan";

/**
 * Plans for marketing pages, read with the anonymous key (the table is public by RLS) and
 * cached by the page's `revalidate`. Limits come from the database, never from components.
 * Returns [] if Supabase is unreachable so the page degrades instead of failing.
 */
export async function getPublicPlans(): Promise<PublicPlan[]> {
  try {
    const env = publicEnv();
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from("plans")
      .select(
        "slug, name, monthly_price_cents, annual_price_cents, monthly_adaptations, monthly_images, max_profiles, max_classes, features, sort_order",
      )
      .eq("active", true)
      .order("sort_order");
    if (error) return [];
    const plans = z.array(PublicPlanSchema).parse(data);
    return getFlags().maxPlanEnabled ? plans : plans.filter((p) => p.slug !== "max");
  } catch {
    return [];
  }
}
