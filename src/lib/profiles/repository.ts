import "server-only";
import { cache } from "react";
import { z } from "zod";
import { getSupabase } from "@/lib/auth/session";
import type { WorkspaceContext } from "@/lib/auth/workspace";
import { compactProfile } from "./draft";
import type { EducationCatalog } from "./catalog";
import { FunctionalProfileSchema } from "@/lib/schemas/functional-profile";
import { DISPLAY_NAME_MAX, ProfileIdSchema, type LearnerProfileInput } from "@/lib/schemas/learner-profile";

const ProfileRowSchema = z.object({
  id: z.uuid(),
  display_name: z.string(),
  stage_slug: z.string().nullable(),
  grade_slug: z.string().nullable(),
  functional_profile: FunctionalProfileSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type LearnerProfileRecord = z.infer<typeof ProfileRowSchema>;

const COLUMNS = "id, display_name, stage_slug, grade_slug, functional_profile, created_at, updated_at";

export type WriteResult = { ok: true; id: string } | { ok: false; reason: "limit" | "not_found" | "error" };

function isLimitError(error: { message?: string } | null): boolean {
  return Boolean(error?.message?.includes("limit_reached:profiles"));
}

export const getCatalog = cache(async (): Promise<EducationCatalog> => {
  const supabase = await getSupabase();
  const [stages, grades] = await Promise.all([
    supabase.from("stages").select("slug, name").eq("active", true).order("sort_order"),
    supabase.from("grades").select("slug, stage_slug, name").eq("active", true).order("sort_order"),
  ]);
  if (stages.error || grades.error) throw new Error("No se ha podido cargar el catálogo educativo.");
  return {
    stages: z.array(z.object({ slug: z.string(), name: z.string() })).parse(stages.data),
    grades: z.array(z.object({ slug: z.string(), stage_slug: z.string(), name: z.string() })).parse(grades.data),
  };
});

export async function countActiveProfiles(workspaceId: string): Promise<number> {
  const supabase = await getSupabase();
  const { count, error } = await supabase
    .from("learner_profiles")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  if (error) throw new Error("No se han podido contar los perfiles.");
  return count ?? 0;
}

export async function listProfiles(workspaceId: string): Promise<LearnerProfileRecord[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("learner_profiles")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("No se han podido cargar los perfiles.");
  return z.array(ProfileRowSchema).parse(data);
}

/** A malformed id, a missing row and another workspace's row are indistinguishable: all return null. */
export async function getProfile(workspaceId: string, id: string): Promise<LearnerProfileRecord | null> {
  if (!ProfileIdSchema.safeParse(id).success) return null;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("learner_profiles")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error("No se ha podido cargar el perfil.");
  return data ? ProfileRowSchema.parse(data) : null;
}

export async function createProfile(ctx: WorkspaceContext, input: LearnerProfileInput): Promise<WriteResult> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("learner_profiles")
    .insert({
      workspace_id: ctx.workspace.id,
      created_by: ctx.user.id,
      display_name: input.display_name,
      stage_slug: input.stage_slug,
      grade_slug: input.grade_slug,
      functional_profile: compactProfile(input.functional_profile),
    })
    .select("id")
    .single();
  if (isLimitError(error)) return { ok: false, reason: "limit" };
  if (error || !data) return { ok: false, reason: "error" };
  return { ok: true, id: z.object({ id: z.uuid() }).parse(data).id };
}

export async function updateProfile(workspaceId: string, id: string, input: LearnerProfileInput): Promise<WriteResult> {
  if (!ProfileIdSchema.safeParse(id).success) return { ok: false, reason: "not_found" };
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("learner_profiles")
    .update({
      display_name: input.display_name,
      stage_slug: input.stage_slug,
      grade_slug: input.grade_slug,
      functional_profile: compactProfile(input.functional_profile),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("archived_at", null)
    .select("id");
  if (error) return { ok: false, reason: "error" };
  return data && data.length > 0 ? { ok: true, id } : { ok: false, reason: "not_found" };
}

export async function deleteProfile(workspaceId: string, id: string): Promise<WriteResult> {
  if (!ProfileIdSchema.safeParse(id).success) return { ok: false, reason: "not_found" };
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("learner_profiles")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, reason: "error" };
  return data && data.length > 0 ? { ok: true, id } : { ok: false, reason: "not_found" };
}

export function copyName(name: string): string {
  const suffix = " (copia)";
  return `${name.slice(0, DISPLAY_NAME_MAX - suffix.length)}${suffix}`;
}

export async function duplicateProfile(ctx: WorkspaceContext, id: string): Promise<WriteResult> {
  const original = await getProfile(ctx.workspace.id, id);
  if (!original || !original.stage_slug || !original.grade_slug) return { ok: false, reason: "not_found" };
  return createProfile(ctx, {
    display_name: copyName(original.display_name),
    stage_slug: original.stage_slug,
    grade_slug: original.grade_slug,
    functional_profile: original.functional_profile,
  });
}
