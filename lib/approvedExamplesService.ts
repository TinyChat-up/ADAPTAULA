import { supabase } from "@/lib/supabaseClient";
import type { AdaptationFeedbackRating } from "@/lib/adaptationFeedbackService";

export type ApprovedAdaptationExample = {
  id: string;
  adaptationId: string;
  userId: string;
  wasApproved: boolean;
  createdAt: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeExample(row: Record<string, unknown>): ApprovedAdaptationExample {
  return {
    id: asString(row.id),
    adaptationId: asString(row.adaptation_id),
    userId: asString(row.user_id),
    wasApproved: Boolean(row.was_approved),
    createdAt: asString(row.created_at),
  };
}

export async function upsertApprovedAdaptationExample(input: {
  adaptationId: string;
  userId: string;
  sourceText: string;
  generatedOutputHtml: string;
  finalEditedHtml: string;
  config: Record<string, unknown>;
  styleId?: string | null;
  templateId?: string | null;
  outputFormat: string;
  studentProfile: string;
  visualSupportLevel: string;
  feedbackRating?: AdaptationFeedbackRating | null;
  feedbackComment?: string | null;
}) {
  const payload: Record<string, unknown> = {
    adaptation_id: input.adaptationId,
    user_id: input.userId,
    source_text: input.sourceText,
    generated_output_html: input.generatedOutputHtml,
    final_edited_html: input.finalEditedHtml,
    config_json: input.config,
    style_id: input.styleId || null,
    template_id: input.templateId || null,
    output_format: input.outputFormat,
    student_profile: input.studentProfile,
    visual_support_level: input.visualSupportLevel,
    feedback_rating: input.feedbackRating || null,
    feedback_comment: input.feedbackComment || null,
    was_approved: true,
  };

  const existing = await supabase
    .from("approved_adaptation_examples")
    .select("id")
    .eq("adaptation_id", input.adaptationId)
    .eq("user_id", input.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const updated = await supabase
      .from("approved_adaptation_examples")
      .update(payload)
      .eq("id", String(existing.data.id))
      .eq("user_id", input.userId)
      .select("*")
      .single();

    if (updated.error) throw updated.error;
    return normalizeExample(updated.data as Record<string, unknown>);
  }

  const created = await supabase
    .from("approved_adaptation_examples")
    .insert([payload])
    .select("*")
    .single();

  if (created.error) throw created.error;
  return normalizeExample(created.data as Record<string, unknown>);
}
