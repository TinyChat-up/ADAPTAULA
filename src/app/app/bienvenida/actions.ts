"use server";

import { redirect } from "next/navigation";
import { getSupabase } from "@/lib/auth/session";
import { requireWorkspace } from "@/lib/auth/workspace";
import { OnboardingSchema, START_DESTINATION, stagesFor } from "@/lib/schemas/onboarding";

export async function completeOnboarding(input: unknown): Promise<{ error: string }> {
  const ctx = await requireWorkspace();
  const parsed = OnboardingSchema.safeParse(input);
  if (!parsed.success) return { error: "Elige una opción en cada paso para continuar." };

  const supabase = await getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ teaching_stages: stagesFor(parsed.data.stage), onboarding_completed: true })
    .eq("id", ctx.user.id);
  if (error) return { error: "No hemos podido guardar tus respuestas. Inténtalo de nuevo." };

  redirect(START_DESTINATION[parsed.data.start]);
}
