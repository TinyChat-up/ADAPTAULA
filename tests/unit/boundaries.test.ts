import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = walk(SRC).filter((f) => !f.endsWith(".test.ts"));
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base].find((c) => source.has(c)) ?? null;
}

function importsOf(file: string): string[] {
  const text = source.get(file) ?? "";
  const specs = [...text.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]!);
  return specs.map((s) => resolveImport(file, s)).filter((p): p is string => p !== null);
}

const isClient = (file: string) => /^\s*["']use client["']/.test(source.get(file) ?? "");
const isServerOnly = (file: string) => /import\s+["']server-only["']/.test(source.get(file) ?? "");
const rel = (f: string) => path.relative(SRC, f);

describe("client/server boundaries", () => {
  it("no client component can reach a server-only module (directly or transitively)", () => {
    const offenders: string[] = [];
    for (const client of files.filter(isClient)) {
      const seen = new Set<string>();
      const stack = [client];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        if (current !== client && isServerOnly(current)) offenders.push(`${rel(client)} -> ${rel(current)}`);
        stack.push(...importsOf(current));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("client components never import server packages", () => {
    const offenders = files
      .filter(isClient)
      .filter((f) => /from\s+["'](next\/headers|server-only)["']/.test(source.get(f)!) || /SUPABASE_SECRET_KEY|process\.env\.(?!NEXT_PUBLIC_)/.test(source.get(f)!))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the service-role client is only imported from allowed server areas", () => {
    const allowed = ["app/api/", "app/admin/", "lib/ai/", "lib/billing/", "lib/usage/", "lib/materials/", "lib/adaptation/orchestration/server.ts", "lib/supabase/admin.ts"];
    const offenders = files
      .filter((f) => /@\/lib\/supabase\/admin|\.\/admin["']/.test(source.get(f)!) && !allowed.some((a) => rel(f).startsWith(a)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("secrets are read only through the validated server env", () => {
    const offenders = files
      .filter((f) => /process\.env\.(SUPABASE_SECRET_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|ANTHROPIC_API_KEY|OPENAI_API_KEY)/.test(source.get(f)!))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no client component reaches an AI provider SDK (directly or transitively): providers are called from the server only", () => {
    const PROVIDER_SDK = /from\s+["'](@anthropic-ai\/[^"']+|openai(?:\/[^"']*)?)["']/;
    const offenders: string[] = [];
    for (const client of files.filter(isClient)) {
      const seen = new Set<string>();
      const stack = [client];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        if (PROVIDER_SDK.test(source.get(current) ?? "")) offenders.push(`${rel(client)} -> ${rel(current)}`);
        stack.push(...importsOf(current));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("provider API keys are named only in the validated env schema, the AI runtime/router (which never receive a value from elsewhere) and the secret scanner", () => {
    const allowed = new Set(["lib/config/env.server-schema.ts", "lib/ai/runtime.ts", "lib/ai/router.ts", "lib/security/secret-scan.ts"]);
    const offenders = files.filter((f) => /ANTHROPIC_API_KEY|OPENAI_API_KEY/.test(source.get(f)!) && !allowed.has(rel(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("every module that touches the server env is marked server-only", () => {
    const offenders = files
      .filter((f) => /env\.server["']/.test(source.get(f)!) && !isServerOnly(f) && !f.endsWith("env.server-schema.ts"))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
