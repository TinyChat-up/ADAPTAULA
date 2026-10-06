const PROTECTED_PREFIXES = ["/app", "/admin"];
const AUTH_PAGES = ["/login", "/registro", "/forgot-password"];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => matches(pathname, p));
}

/** Pages a signed-in user has no reason to see. `/reset-password` is excluded: it needs a session. */
export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((p) => matches(pathname, p));
}

/**
 * Only same-site relative paths are accepted as post-login destinations (open-redirect protection).
 * Anything else falls back to the app home.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) {
    return fallback;
  }
  return next;
}
