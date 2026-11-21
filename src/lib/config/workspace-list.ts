const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a comma-separated list of workspace ids (a server variable) names this workspace. Malformed entries never match. */
export const inWorkspaceList = (list: string | undefined, workspaceId: string | null | undefined): boolean =>
  !!workspaceId && (list ?? "").split(",").map((w) => w.trim()).filter((w) => UUID.test(w)).some((w) => w.toLowerCase() === workspaceId.toLowerCase());
