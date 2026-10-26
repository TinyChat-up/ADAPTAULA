import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// The public pages are included only so a signed-in teacher's session is refreshed there too: their header and the
// private Max pilot read it (they never redirect). The user-facing APIs are included for the same reason; they answer
// 401 themselves instead of redirecting.
export const config = {
  matcher: ["/", "/precios", "/como-funciona", "/privacidad", "/terminos", "/cookies", "/app/:path*", "/admin/:path*", "/api/uploads/:path*", "/api/materials/:path*", "/login", "/registro", "/forgot-password", "/reset-password"],
};
