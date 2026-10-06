/**
 * CSRF guard for mutating Route Handlers (Server Actions have Next's own origin check).
 * Browsers always send `Origin` on cross-origin and on same-origin POST fetches.
 */
export function isSameOrigin(input: { origin: string | null; host: string | null; forwardedHost?: string | null }): boolean {
  if (!input.origin) return false;
  const expected = (input.forwardedHost ?? input.host ?? "").split(",")[0]?.trim();
  if (!expected) return false;
  try {
    return new URL(input.origin).host === expected;
  } catch {
    return false;
  }
}

export function requestIsSameOrigin(request: Request): boolean {
  return isSameOrigin({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
  });
}
