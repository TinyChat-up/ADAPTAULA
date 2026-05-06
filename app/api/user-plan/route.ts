import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ plan: "free", currentPeriodEnd: null });

    // Verify the user with their token
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) return NextResponse.json({ plan: "free", currentPeriodEnd: null });

    // Read subscription with service role (bypasses RLS)
    const supabaseService = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const now = new Date().toISOString();
    const { data } = await supabaseService
      .from("subscriptions")
      .select("plan, status, current_period_end")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .gt("current_period_end", now)
      .maybeSingle();

    return NextResponse.json({
      plan: data?.plan ?? "free",
      currentPeriodEnd: data?.current_period_end ?? null,
    });
  } catch {
    return NextResponse.json({ plan: "free", currentPeriodEnd: null });
  }
}
