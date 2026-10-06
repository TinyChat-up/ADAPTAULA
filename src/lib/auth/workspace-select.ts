export type WorkspaceRole = "owner" | "admin" | "teacher" | "viewer";
export type WorkspaceType = "personal" | "school" | "high_school" | "academy" | "organization";

export interface Membership {
  role: WorkspaceRole;
  workspace: { id: string; name: string; type: WorkspaceType };
}

export const ACTIVE_WORKSPACE_COOKIE = "aw";

/**
 * Picks the active workspace. The cookie is only a *preference*: it is honored solely when it matches
 * a membership that the database already returned for this user, so a forged value does nothing.
 */
export function pickWorkspace(memberships: Membership[], preferredId?: string | null): Membership | null {
  if (preferredId) {
    const preferred = memberships.find((m) => m.workspace.id === preferredId);
    if (preferred) return preferred;
  }
  return memberships.find((m) => m.workspace.type === "personal") ?? memberships[0] ?? null;
}

export function hasRole(role: WorkspaceRole, allowed: readonly WorkspaceRole[]): boolean {
  return allowed.includes(role);
}
