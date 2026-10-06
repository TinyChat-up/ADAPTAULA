import "server-only";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/session";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/auth/workspace";
import { logger } from "@/lib/logger";
import { requestIsSameOrigin } from "@/lib/security/origin";

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Authenticates a Route Handler without redirecting (APIs answer 401, they do not send HTML).
 * `mutating` additionally enforces the same-origin check. The workspace always comes from the server.
 */
export async function getApiContext(request: Request, options: { mutating: boolean }): Promise<{ ctx: WorkspaceContext } | { response: NextResponse }> {
  if (options.mutating && !requestIsSameOrigin(request)) {
    return { response: apiError(403, "forbidden_origin", "Solicitud no permitida.") };
  }
  const user = await getUser();
  if (!user) return { response: apiError(401, "unauthenticated", "Tu sesión ha caducado. Vuelve a entrar.") };
  try {
    return { ctx: await getWorkspaceContext() };
  } catch (error) {
    logger.error("api_context_failed", { userId: user.id, reason: error instanceof Error ? error.message.slice(0, 80) : "unknown" });
    return { response: apiError(500, "unexpected", "No hemos podido preparar tu espacio de trabajo.") };
  }
}
