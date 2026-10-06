import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/config/env.public";
import { isAuthPage, isProtectedPath } from "@/lib/auth/paths";

/**
 * Refreshes the session cookies and applies UX redirects. This is NOT the security boundary:
 * every page, action and route handler still calls requireUser()/requireWorkspace().
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = publicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  const redirectTo = (target: string) => {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    for (const [key, value] of response.headers) {
      if (key.toLowerCase() === "cache-control" || key.toLowerCase() === "expires" || key.toLowerCase() === "pragma") {
        redirect.headers.set(key, value);
      }
    }
    return redirect;
  };

  if (!signedIn && isProtectedPath(pathname)) {
    return redirectTo(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
  if (signedIn && isAuthPage(pathname)) {
    return redirectTo("/app");
  }
  return response;
}
