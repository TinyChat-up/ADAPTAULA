/**
 * Rate limiter in-memory con ventana deslizante de 60s.
 * Key: `ip:userId` (userId = 'anon' si no autenticado).
 * Límites: 5 req/min anónimos, 20 req/min autenticados.
 *
 * Nota: el Map se resetea con cada cold start de Vercel — aceptable para MVP.
 */

interface RateLimitRecord {
  timestamps: number[]; // epoch ms de cada petición en la ventana actual
}

const store = new Map<string, RateLimitRecord>();

const WINDOW_MS = 60_000; // 60 segundos
const LIMIT_ANON = 5;
const LIMIT_AUTH = 20;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Segundos hasta que expire el registro más antiguo de la ventana */
  resetInSeconds: number;
}

function cleanKey(key: string, now: number): RateLimitRecord {
  const record = store.get(key) ?? { timestamps: [] };
  // Eliminar timestamps fuera de la ventana deslizante
  record.timestamps = record.timestamps.filter((t) => now - t < WINDOW_MS);
  store.set(key, record);
  return record;
}

/**
 * Comprueba y registra una petición.
 * @param ip  IP del cliente (extraída de headers)
 * @param userId  ID del usuario autenticado o vacío string para anónimo
 */
export function checkRateLimit(ip: string, userId: string): RateLimitResult {
  const key = `${ip}:${userId || "anon"}`;
  const isAuth = Boolean(userId);
  const limit = isAuth ? LIMIT_AUTH : LIMIT_ANON;
  const now = Date.now();

  const record = cleanKey(key, now);
  const count = record.timestamps.length;

  if (count >= limit) {
    // Cuántos segundos faltan para que salga el timestamp más antiguo
    const oldest = record.timestamps[0] ?? now;
    const resetInSeconds = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetInSeconds: Math.max(1, resetInSeconds),
    };
  }

  // Registrar la petición actual
  record.timestamps.push(now);
  store.set(key, record);

  const resetInSeconds = record.timestamps.length > 0
    ? Math.ceil((record.timestamps[0] + WINDOW_MS - now) / 1000)
    : WINDOW_MS / 1000;

  return {
    allowed: true,
    limit,
    remaining: limit - record.timestamps.length,
    resetInSeconds: Math.max(0, resetInSeconds),
  };
}

/** Extrae la IP del cliente de las cabeceras estándar de proxy. */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for puede ser "ip1, ip2, ip3" — tomamos la primera
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}
