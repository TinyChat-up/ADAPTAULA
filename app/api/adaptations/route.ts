import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Verify user
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as Record<string, unknown>;

    // Insert with service role (bypasses RLS)
    const supabaseService = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data, error } = await supabaseService
      .from("adaptations")
      .insert({ ...body, user_id: user.id })
      .select("id")
      .single();

    if (error) {
      console.error("ADAPTATIONS_INSERT_ERROR", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: (data as Record<string, unknown>).id });
  } catch (err) {
    console.error("ADAPTATIONS_ROUTE_ERROR", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
