import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Marketing pages never touch Supabase, so they stay out of the proxy. The user-facing APIs are included only
// so the session cookie is refreshed; they answer 401 themselves instead of redirecting.
export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/api/uploads/:path*", "/api/materials/:path*", "/login", "/registro", "/forgot-password", "/reset-password"],
};
