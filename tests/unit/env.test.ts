import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_ENV_KEYS, parsePublicEnv } from "@/lib/config/env.public";
import { ServerEnvSchema, parseServerEnv } from "@/lib/config/env.server-schema";

const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
};

describe("public env", () => {
  it("accepts a valid configuration and defaults the site URL", () => {
    expect(parsePublicEnv(supabase).NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });

  it("names the missing variables without printing values", () => {
    expect(() => parsePublicEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("never contains secrets", () => {
    for (const key of PUBLIC_ENV_KEYS) expect(key).not.toMatch(/SECRET|SERVICE|ANTHROPIC|OPENAI|WEBHOOK/);
  });
});

describe("server env", () => {
  it("boots with no AI, Stripe or secret keys (not required until later phases)", () => {
    const env = parseServerEnv({});
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(env.AI_MAX_REVIEW_RETRIES).toBe(2);
  });

  it("treats empty strings as unset, like .env.example", () => {
    const env = parseServerEnv({ ANTHROPIC_API_KEY: "", AI_MODEL_STANDARD: "", FLAG_GOOGLE_AUTH: "" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AI_MODEL_STANDARD).toBeUndefined();
    expect(env.FLAG_GOOGLE_AUTH).toBe(false);
  });

  it("parses flags with their documented defaults", () => {
    const env = parseServerEnv({ FLAG_MAX_PLAN_ENABLED: "true" });
    expect(env.FLAG_MAX_PLAN_ENABLED).toBe(true);
    expect(env.FLAG_MULTI_PROFILE_GENERATION).toBe(true);
    expect(env.FLAG_PROVIDER_FALLBACK).toBe(false);
  });

  it("the analysis prompt version defaults to 3 (the validated one), accepts 1 and 2 and refuses anything else; repairs are capped at 1", () => {
    expect(parseServerEnv({}).AI_ANALYSIS_PROMPT_VERSION).toBe(3);
    expect(parseServerEnv({ AI_ANALYSIS_PROMPT_VERSION: "2" }).AI_ANALYSIS_PROMPT_VERSION).toBe(2);
    expect(parseServerEnv({ AI_ANALYSIS_PROMPT_VERSION: "1" }).AI_ANALYSIS_PROMPT_VERSION).toBe(1);
    expect(parseServerEnv({ AI_ANALYSIS_PROMPT_VERSION: "" }).AI_ANALYSIS_PROMPT_VERSION).toBe(3);
    expect(() => parseServerEnv({ AI_ANALYSIS_PROMPT_VERSION: "4" })).toThrow(/AI_ANALYSIS_PROMPT_VERSION/);
    expect(() => parseServerEnv({ AI_ANALYSIS_MAX_REPAIR_ATTEMPTS: "2" })).toThrow(/AI_ANALYSIS_MAX_REPAIR_ATTEMPTS/);
  });

  it("rejects malformed values", () => {
    expect(() => parseServerEnv({ FLAG_GOOGLE_AUTH: "yes" })).toThrow(/FLAG_GOOGLE_AUTH/);
    expect(() => parseServerEnv({ AI_MODEL_ECONOMY: "haiku" })).toThrow(/AI_MODEL_ECONOMY/);
  });

  it("every variable in .env.example is known to a schema", () => {
    const example = readFileSync(path.resolve(import.meta.dirname, "../../.env.example"), "utf8");
    const names = [...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    const known = new Set([...Object.keys(ServerEnvSchema.shape), ...PUBLIC_ENV_KEYS, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "ADMIN_BOOTSTRAP_EMAILS"]);
    expect(names.filter((n) => !known.has(n))).toEqual([]);
    expect(names.filter((n) => n.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE|PRIVATE/.test(n))).toEqual([]);
  });
});
