import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PATHS = [
  "/",
  "/workspace",
  "/styles",
  "/history",
  "/internal",
  "/admin",
] as const;

function isProtectedPath(pathname: string) {
  return PROTECTED_PATHS.some((basePath) => {
    if (basePath === "/") return pathname === "/";
    return pathname === basePath || pathname.startsWith(`${basePath}/`);
  });
}

function sanitizeNextPath(value: string | null) {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.startsWith("/login")) return "/";
  return value;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options?: CookieOptions;
          }>,
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPath = pathname === "/login";

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLoginPath) {
    const preferredNext = sanitizeNextPath(
      request.nextUrl.searchParams.get("next"),
    );
    const targetUrl = request.nextUrl.clone();
    targetUrl.pathname = preferredNext;
    targetUrl.search = "";
    return NextResponse.redirect(targetUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/workspace/:path*",
    "/styles/:path*",
    "/history/:path*",
    "/internal/:path*",
    "/admin/:path*",
    "/login",
  ],
};
