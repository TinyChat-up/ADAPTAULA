import { z } from "zod";

/** Only values that are safe to ship to the browser. Never add a secret here. */
const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;
export const PUBLIC_ENV_KEYS = Object.keys(PublicEnvSchema.shape);

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = PublicEnvSchema.safeParse({
    ...source,
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  });
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Configuración pública no válida o incompleta: ${names}. Revisa .env.local (ver .env.example).`);
  }
  return result.data;
}

let cached: PublicEnv | undefined;

/** Next only inlines `process.env.NEXT_PUBLIC_*` when referenced statically, hence the explicit object. */
export function publicEnv(): PublicEnv {
  cached ??= parsePublicEnv({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return cached;
}
