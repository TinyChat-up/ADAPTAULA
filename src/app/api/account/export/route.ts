import "server-only";
import { createHash } from "node:crypto";
import { apiError, getApiContext } from "@/lib/api/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAccountExport, ExportTooLargeError } from "@/lib/privacy/export";

export const maxDuration = 60;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await getApiContext(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { ctx } = auth;
  // Two requests per day per authenticated identity, atomically counted in the DB.
  const { data: allowed, error: rateError } = await createAdminClient().rpc("rate_limit_allowed", {
    p_key: `account-export:${ctx.user.id}`, p_window_seconds: 86400, p_max: 2,
  });
  if (rateError) return apiError(503, "unavailable", "La exportación no está disponible ahora. Inténtalo más tarde.");
  if (!allowed) return apiError(429, "rate_limited", "Has alcanzado el límite de dos descargas al día.");
  try {
    const payload = await buildAccountExport(ctx.user, ctx.profile);
    const body = JSON.stringify(payload, null, 2);
    const bytes = Buffer.from(body);
    if (bytes.length > MAX_RESPONSE_BYTES) throw new ExportTooLargeError();
    return new Response(bytes, { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="adaptaula-datos-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "X-Content-SHA256": createHash("sha256").update(bytes).digest("hex"),
    } });
  } catch (error) {
    if (error instanceof ExportTooLargeError) return apiError(413, "too_large", "La copia supera los límites de tamaño o registros y no puede prepararse desde aquí.");
    return apiError(503, "export_failed", "No hemos podido preparar una copia completa. Inténtalo más tarde.");
  }
}
