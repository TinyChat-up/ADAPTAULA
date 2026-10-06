import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getSupabase, requireUser } from "./session";
import {
  ACTIVE_WORKSPACE_COOKIE,
  hasRole,
  pickWorkspace,
  type Membership,
  type WorkspaceRole,
} from "./workspace-select";

const MembershipRowSchema = z.object({
  role: z.enum(["owner", "admin", "teacher", "viewer"]),
  workspaces: z.object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(["personal", "school", "high_school", "academy", "organization"]),
  }),
});

const ProfileRowSchema = z.object({
  full_name: z.string().nullable(),
  teaching_stages: z.array(z.string()),
  onboarding_completed: z.boolean(),
});

export interface WorkspaceContext {
  user: { id: string; email: string | undefined };
  profile: { fullName: string | null; teachingStages: string[]; onboardingCompleted: boolean };
  workspace: Membership["workspace"];
  role: WorkspaceRole;
}

async function loadMemberships(userId: string): Promise<Membership[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, type)")
    .eq("user_id", userId);
  if (error) throw new Error("No se han podido cargar tus espacios de trabajo.");
  return z
    .array(MembershipRowSchema)
    .parse(data)
    .map((row) => ({ role: row.role, workspace: row.workspaces }));
}

async function loadProfile(userId: string) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, teaching_stages, onboarding_completed")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("No se ha podido cargar tu perfil.");
  return data ? ProfileRowSchema.parse(data) : null;
}

/**
 * Resolves who the user is and which workspace they act in, entirely on the server.
 * Anything the browser sends (ids, plan, role) is ignored. If the account somehow has no
 * workspace or profile, it is repaired idempotently instead of leaving the user stuck.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  const user = await requireUser();
  let [memberships, profile] = await Promise.all([loadMemberships(user.id), loadProfile(user.id)]);

  if (memberships.length === 0 || !profile) {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("ensure_personal_workspace");
    if (error) throw new Error("No se ha podido preparar tu espacio de trabajo.");
    [memberships, profile] = await Promise.all([loadMemberships(user.id), loadProfile(user.id)]);
  }

  const cookieStore = await cookies();
  const active = pickWorkspace(memberships, cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value);
  if (!active || !profile) throw new Error("No se ha podido preparar tu espacio de trabajo.");

  return {
    user: { id: user.id, email: user.email },
    profile: {
      fullName: profile.full_name,
      teachingStages: profile.teaching_stages,
      onboardingCompleted: profile.onboarding_completed,
    },
    workspace: active.workspace,
    role: active.role,
  };
});

export async function requireWorkspace(): Promise<WorkspaceContext> {
  return getWorkspaceContext();
}

/** Insufficient role looks exactly like "not found": no information about what exists. */
export async function requireWorkspaceRole(allowed: readonly WorkspaceRole[]): Promise<WorkspaceContext> {
  const ctx = await getWorkspaceContext();
  if (!hasRole(ctx.role, allowed)) notFound();
  return ctx;
}

export const WRITE_ROLES = ["owner", "admin", "teacher"] as const satisfies readonly WorkspaceRole[];
