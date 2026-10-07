import { z } from "zod";

/** Treats empty strings (as in .env.example) as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const flag = (fallback: boolean) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.enum(["true", "false"]).default(fallback ? "true" : "false")).transform((v) => v === "true");

const ModelRef = z.string().regex(/^(anthropic|openai|mock):[A-Za-z0-9._-]+$/, "formato esperado: proveedor:modelo");

/**
 * Server-only configuration. Nothing here is required yet except what Fase 1 needs:
 * the AI, Stripe and cron variables are optional until the phase that uses them
 * (each consumer must validate its own requirement when it is called).
 */
export const ServerEnvSchema = z.object({
  SUPABASE_SECRET_KEY: optional(z.string().min(20)),

  STRIPE_SECRET_KEY: optional(z.string().min(1)),
  STRIPE_WEBHOOK_SECRET: optional(z.string().min(1)),

  ANTHROPIC_API_KEY: optional(z.string().min(1)),
  OPENAI_API_KEY: optional(z.string().min(1)),
  AI_MODEL_ECONOMY: optional(ModelRef),
  AI_MODEL_STANDARD: optional(ModelRef),
  AI_MODEL_PREMIUM: optional(ModelRef),
  AI_MODEL_IMAGE_FAST: optional(ModelRef),
  AI_MODEL_IMAGE_QUALITY: optional(ModelRef),
  AI_FALLBACK_ECONOMY: optional(ModelRef),
  AI_FALLBACK_STANDARD: optional(ModelRef),
  AI_FALLBACK_PREMIUM: optional(ModelRef),
  AI_ANALYSIS_ALIAS: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["ECONOMY", "STANDARD", "PREMIUM"]).default("STANDARD")),
  AI_ANALYSIS_EFFORT: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["low", "medium", "high"]).default("medium")),
  AI_ANALYSIS_MAX_REPAIR_ATTEMPTS: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).max(1).default(1)),
  AI_ANALYSIS_PROMPT_VERSION: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().refine((n) => n === 1 || n === 2 || n === 3, "versiones disponibles: 1, 2 o 3").default(3)),
  AI_ANALYSIS_MAX_OUTPUT_TOKENS: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(2000).max(64000).default(24000)),
  MOCK_AI_DELAY_MS: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).max(30000).default(600)),
  AI_MAX_REVIEW_RETRIES: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).max(5).default(2)),

  DAILY_AI_COST_ALERT_USD: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().positive().default(50)),
  MONTHLY_AI_COST_ALERT_USD: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().positive().default(800)),
  MAX_SINGLE_JOB_COST_USD: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().positive().default(1.5)),

  CRON_SECRET: optional(z.string().min(16)),
  /** Stages recovered per cron run: one stage can take most of the 300 s budget, and the normal path never waits for the cron. */
  ADAPTATION_JOBS_PER_RUN: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(10).default(1)),

  FLAG_MAX_PLAN_ENABLED: flag(false),
  FLAG_AI_IMAGES_ENABLED: flag(false),
  FLAG_MULTI_PROFILE_GENERATION: flag(true),
  FLAG_SCHOOL_WORKSPACES: flag(false),
  FLAG_GOOGLE_AUTH: flag(false),
  FLAG_ADVANCED_EDITOR: flag(true),
  FLAG_PROVIDER_FALLBACK: flag(false),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${String(i.path[0])} (${i.message})`).join("; ");
    throw new Error(`Configuración de servidor no válida: ${detail}. Revisa las variables de entorno (ver .env.example).`);
  }
  return result.data;
}
