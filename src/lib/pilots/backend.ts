/**
 * The backend check every pilot shares (ADR-046): a pilot is bound to ONE explicitly named Supabase backend, never to whatever the
 * deployment happens to use. Pure: the caller passes the backend this deployment really talks to (`NEXT_PUBLIC_SUPABASE_URL`).
 *  - `local`: a loopback backend only (development);
 *  - `staging` / `production-pilot`: an `https://<ref>.supabase.co` origin, exactly the one configured.
 * Any credential, path, query or fragment in either URL refuses: a URL that needs them is not the plain origin a pilot names.
 */
export type PilotBackendMode = "local" | "staging" | "production-pilot";

export function pilotBackendAllows(mode: PilotBackendMode, allowedUrl: string | undefined, backendUrl: string): boolean {
  try {
    const actual = new URL(backendUrl);
    const allowed = new URL(allowedUrl ?? "");
    if (actual.href !== allowed.href || actual.username || actual.password || actual.search || actual.hash || actual.pathname !== "/") return false;
    if (mode === "local") return ["localhost", "127.0.0.1", "[::1]"].includes(actual.hostname);
    return actual.protocol === "https:" && /^[a-z0-9]+\.supabase\.co$/.test(actual.hostname);
  } catch {
    return false;
  }
}
