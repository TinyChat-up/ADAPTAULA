import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      rating: number;
      usable?: "yes" | "partial" | "no";
      positive_dimensions?: string[];
      improvement_dimensions?: string[];
      improvement_notes?: string;
      comment?: string;
      adaptationId?: string;
      subject?: string;
      supportDegree?: string;
      learningProfile?: string;
      adaptationLevel?: string;
      aiProvider?: string;
    };

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    let userId: string | null = null;
    if (token) {
      const { data: { user } } = await supabaseAuth.auth.getUser(token);
      userId = user?.id ?? null;
    }

    const supabaseService = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { error } = await supabaseService.from("adaptation_feedback").insert({
      rating: body.rating,
      usable: body.usable ?? null,
      positive_dimensions: body.positive_dimensions ?? [],
      improvement_dimensions: body.improvement_dimensions ?? [],
      improvement_notes: body.improvement_notes ?? null,
      comment: body.comment ?? null,
      adaptation_id: body.adaptationId ?? null,
      user_id: userId,
      subject: body.subject ?? null,
      support_degree: body.supportDegree ?? null,
      learning_profile: body.learningProfile ?? null,
      adaptation_level: body.adaptationLevel ?? null,
      ai_provider: body.aiProvider ?? null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error guardando feedback" }, { status: 500 });
  }
}
