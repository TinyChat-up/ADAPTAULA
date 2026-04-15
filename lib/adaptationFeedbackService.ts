import { supabase } from "@/lib/supabaseClient";

export type AdaptationFeedbackRating = "useful" | "partial" | "not_useful";

export type AdaptationFeedback = {
  id: string;
  adaptationId: string;
  userId: string;
  rating: AdaptationFeedbackRating;
  comment: string;
  createdAt: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeFeedback(row: Record<string, unknown>): AdaptationFeedback {
  const rawRating = asString(row.rating);
  const rating: AdaptationFeedbackRating =
    rawRating === "useful" || rawRating === "partial" || rawRating === "not_useful"
      ? rawRating
      : "partial";

  return {
    id: asString(row.id),
    adaptationId: asString(row.adaptation_id),
    userId: asString(row.user_id),
    rating,
    comment: asString(row.comment),
    createdAt: asString(row.created_at),
  };
}

export async function upsertAdaptationFeedback(input: {
  adaptationId: string;
  userId: string;
  rating: AdaptationFeedbackRating;
  comment?: string;
}) {
  const payload = {
    adaptation_id: input.adaptationId,
    user_id: input.userId,
    rating: input.rating,
    comment: (input.comment || "").trim(),
  };

  const existing = await supabase
    .from("adaptation_feedback")
    .select("id")
    .eq("adaptation_id", input.adaptationId)
    .eq("user_id", input.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const updated = await supabase
      .from("adaptation_feedback")
      .update(payload)
      .eq("id", String(existing.data.id))
      .eq("user_id", input.userId)
      .select("*")
      .single();

    if (updated.error) throw updated.error;
    return normalizeFeedback(updated.data as Record<string, unknown>);
  }

  const created = await supabase
    .from("adaptation_feedback")
    .insert([payload])
    .select("*")
    .single();

  if (created.error) throw created.error;
  return normalizeFeedback(created.data as Record<string, unknown>);
}

export async function getLatestAdaptationFeedback(
  adaptationId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("adaptation_feedback")
    .select("*")
    .eq("adaptation_id", adaptationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return normalizeFeedback(data as Record<string, unknown>);
}
