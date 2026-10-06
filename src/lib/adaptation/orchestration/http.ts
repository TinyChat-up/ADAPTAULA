import "server-only";
import { NextResponse } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { getSupabase } from "@/lib/auth/session";
import { WRITE_ROLES } from "@/lib/auth/workspace";
import { hasRole } from "@/lib/auth/workspace-select";
import { PUBLIC_SERVICE_ERRORS } from "./public";
import type { Actor, ServiceDeps, ServiceResult } from "./service";
import { serviceDeps } from "./server";

/**
 * Read-only Route Handlers for polling. They are PRIVATE and CHANGING data: every answer is `no-store, private` so no CDN or
 * shared cache can ever serve one teacher's adaptation to another, or an old state to the same one. Authentication and workspace
 * come from the server (never the URL or the body); mutations are not exposed here (Server Actions own them).
 */
export const PRIVATE_HEADERS = { "Cache-Control": "no-store, private", Vary: "Cookie" } as const;

export async function privateRead<T>(request: Request, run: (deps: ServiceDeps, actor: Actor) => Promise<ServiceResult<T>>): Promise<NextResponse> {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const actor: Actor = { userId: auth.ctx.user.id, workspaceId: auth.ctx.workspace.id, canWrite: hasRole(auth.ctx.role, WRITE_ROLES) };
  const result = await run(serviceDeps(await getSupabase()), actor);
  if (result.ok) return NextResponse.json(result.data, { headers: PRIVATE_HEADERS });
  const { status, message } = PUBLIC_SERVICE_ERRORS[result.code];
  return apiError(status, result.code, message);
}
