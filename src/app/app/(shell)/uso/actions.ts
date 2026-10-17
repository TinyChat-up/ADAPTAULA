"use server";

import { revalidatePath } from "next/cache";
import { getSupabase, requireUser } from "@/lib/auth/session";
import { AccountNameSchema, type AccountNameState } from "@/lib/schemas/account";

export async function updateAccountName(_previous: AccountNameState, form: FormData): Promise<AccountNameState> {
  const user = await requireUser();
  const parsed = AccountNameSchema.safeParse({ full_name: form.get("full_name") });
  if (!parsed.success) return { status: "error", error: parsed.error.issues[0]?.message ?? "Revisa el nombre." };

  const supabase = await getSupabase();
  const { data, error } = await supabase.from("profiles")
    .update({ full_name: parsed.data.full_name }).eq("id", user.id).select("id").maybeSingle();
  if (error || !data) return { status: "error", message: "No hemos podido guardar tu nombre. Inténtalo de nuevo." };
  revalidatePath("/app", "layout");
  return { status: "success", message: "Nombre guardado." };
}
