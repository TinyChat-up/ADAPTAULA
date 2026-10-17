import "server-only";
import { createClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api/context";
import { getSupabase, getUser } from "@/lib/auth/session";
import { publicEnv } from "@/lib/config/env.public";
import { requestIsSameOrigin } from "@/lib/security/origin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return apiError(403, "forbidden_origin", "Solicitud no permitida.");
  const user = await getUser();
  if (!user?.email) return apiError(401, "unauthenticated", "Entra de nuevo para continuar.");
  const { data: allowed, error: rateError } = await createAdminClient().rpc("rate_limit_allowed", {
    p_key: `account-deletion-verify:${user.id}`, p_window_seconds: 3600, p_max: 5,
  });
  if (rateError || !allowed) return apiError(429, "rate_limited", "Demasiados intentos. Prueba de nuevo más tarde.");
  let password: unknown;
  let confirmation: unknown;
  try {
    const body = await request.json();
    password = body.password;
    confirmation = body.confirmation;
  } catch { return apiError(400, "invalid_request", "Revisa la solicitud."); }
  if (confirmation !== "ELIMINAR MI CUENTA" || typeof password !== "string" || password.length < 1 || password.length > 256) {
    return apiError(400, "confirmation_required", "Escribe la confirmación y tu contraseña actual.");
  }
  // A separate client verifies the password without replacing the browser's session.
  const env = publicEnv();
  const verifier = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({ email: user.email, password });
  if (verifyError || verified.user?.id !== user.id) return apiError(403, "identity_unverified", "No hemos podido verificar tu identidad.");
  const db = await getSupabase();
  const { data: id, error } = await db.rpc("request_account_deletion");
  if (error || !id) return apiError(503, "request_failed", "No hemos podido registrar la solicitud. Inténtalo de nuevo.");
  const { data: requestRecord, error: readError } = await db.from("account_deletion_requests")
    .select("status").eq("id", id).eq("user_id", user.id).single();
  if (readError || !requestRecord) return apiError(503, "request_failed", "La solicitud quedó registrada, pero no podemos mostrar su estado ahora.");
  return Response.json({ id, status: requestRecord.status }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
}
