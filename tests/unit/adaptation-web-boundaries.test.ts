import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIError } from "@/lib/ai/errors";
import { createProvider } from "@/lib/ai/router";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(f) ? [full] : [];
  });
}
const src = walk(path.join(ROOT, "src")).map((f) => ({ rel: path.relative(path.join(ROOT, "src"), f), text: readFileSync(f, "utf8") }));

const SECRET = "cron-secret-0123456789-abcdef";
const cycle = vi.fn(async () => ({ processed: { claimed: 1, completed: 1, retryScheduled: 0, failed: 0, skipped: 0, ambiguous: 0, humanActionRequired: 0, rejected: 0, errors: 0 } }));
let secret: string | undefined = SECRET;
vi.mock("@/lib/config/env.server", () => ({ serverEnv: () => ({ CRON_SECRET: secret, ADAPTATION_JOBS_PER_RUN: 2 }) }));
vi.mock("@/lib/adaptation/orchestration/server", () => ({ orchestratorDeps: () => ({}) }));
vi.mock("@/lib/adaptation/orchestration/worker", () => ({ runAdaptationWorkerCycle: (...args: unknown[]) => (cycle as (...a: unknown[]) => unknown)(...args) }));

describe("endpoint interno del worker", () => {
  beforeEach(() => {
    secret = SECRET;
    cycle.mockClear();
  });
  const call = async (method: "GET" | "POST", authorization?: string) => {
    const route = await import("@/app/api/cron/adaptations/route");
    return route[method](new Request("http://localhost/api/cron/adaptations", { method, headers: authorization ? { authorization } : {} }));
  };

  it("sin secreto, con uno equivocado o sin CRON_SECRET configurado responde 401 y no ejecuta nada", async () => {
    for (const method of ["GET", "POST"] as const) {
      expect((await call(method)).status).toBe(401);
      expect((await call(method, "Bearer otro-secreto-equivocado-0123456")).status).toBe(401);
      expect((await call(method, `Bearer ${SECRET.toUpperCase()}`)).status).toBe(401);
    }
    secret = undefined;
    expect((await call("POST", `Bearer ${SECRET}`)).status).toBe(401);
    expect(cycle).not.toHaveBeenCalled();
  });

  it("con el secreto ejecuta un tick con el lote configurado, sin caché y sin devolver el secreto ni contenido", async () => {
    const res = await call("POST", `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(cycle).toHaveBeenCalledWith({}, { limit: 2 });
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(SECRET);
    expect(body).toMatch(/completed/);
  });

  it("el scheduler declarado en vercel.json apunta a esa ruta", () => {
    const crons = (JSON.parse(read("vercel.json")) as { crons: Array<{ path: string }> }).crons.map((c) => c.path);
    expect(crons).toContain("/api/cron/adaptations");
  });
});

describe("fronteras públicas", () => {
  it("las rutas de lectura son privadas y dinámicas: no-store, private, sin caché compartida", () => {
    expect(read("src/lib/adaptation/orchestration/http.ts")).toMatch(/"Cache-Control": "no-store, private"/);
    for (const route of ["status", "plan", "version"]) {
      const text = read(`src/app/api/adaptations/[id]/${route}/route.ts`);
      expect(text, route).toMatch(/export const dynamic = "force-dynamic"/);
      expect(text, route).toMatch(/privateRead/);
      expect(text, route).not.toMatch(/export (async function|const) (POST|PUT|PATCH|DELETE)/);
    }
  });

  it("las Server Actions: solo exportan funciones asíncronas, no reciben workspace ni revisor del cliente y no tocan el cliente admin", () => {
    const text = read("src/app/app/(shell)/adaptaciones/actions.ts");
    expect(text.startsWith('"use server"')).toBe(true);
    for (const line of text.split("\n").filter((l) => l.startsWith("export "))) expect(line).toMatch(/^export async function \w+Action\(/);
    expect(text).not.toMatch(/createAdminClient|supabase\/admin|SUPABASE_SECRET_KEY/);
    const inputs = text.match(/const (CreateInput|ReviewInput) = z\.object\(\{[\s\S]*?\n\}\);/g)!.join("\n");
    expect(inputs).not.toMatch(/workspace|reviewer|reviewed_by|reviewed_at|user_?id/i);
    expect(text).toMatch(/requireWorkspace\(\)/);
  });

  it("el cliente de servicio, el worker y las rutas internas solo se importan desde capas del servidor aprobadas", () => {
    const allowed = new Set(["app/app/(shell)/adaptaciones/actions.ts", "lib/adaptation/orchestration/http.ts", "app/api/cron/adaptations/route.ts", "app/api/adaptations/[id]/run/route.ts", "lib/render/load.ts"]);
    const importers = src.filter((f) => /orchestration\/server["']/.test(f.text) && f.rel !== "lib/adaptation/orchestration/server.ts").map((f) => f.rel);
    for (const rel of importers) expect(allowed.has(rel), rel).toBe(true);
    for (const rel of ["lib/adaptation/orchestration/server.ts", "lib/adaptation/orchestration/worker.ts", "lib/adaptation/orchestration/http.ts"]) expect(read(`src/${rel}`), rel).toMatch(/^import "server-only";/m);
    const workerUsers = src.filter((f) => /orchestration\/worker["']/.test(f.text)).map((f) => f.rel);
    for (const rel of workerUsers) expect(allowed.has(rel) || rel.startsWith("lib/adaptation/orchestration/"), rel).toBe(true);
  });

  it("ningún Client Component llega al pipeline, al worker ni al repositorio interno", () => {
    const clients = src.filter((f) => /^\s*["']use client["']/.test(f.text));
    // Type-only imports of the DTOs are erased at build time; any value import from the pipeline would not be.
    for (const c of clients) expect(c.text.replace(/^import type [^;]*;$/gm, ""), c.rel).not.toMatch(/lib\/adaptation\/orchestration|lib\/supabase\/admin/);
  });

  it("los fallos de la capa pública no exponen texto interno: cada código tiene un mensaje genérico propio", async () => {
    const { PUBLIC_SERVICE_ERRORS } = await import("@/lib/adaptation/orchestration/public");
    for (const [code, e] of Object.entries(PUBLIC_SERVICE_ERRORS)) {
      expect(e.message, code).not.toMatch(/sql|stack|anthropic|claude|token|workspace|uuid|\bid\b/i);
      expect(e.status).toBeGreaterThanOrEqual(400);
    }
    expect(PUBLIC_SERVICE_ERRORS.forbidden).toEqual(PUBLIC_SERVICE_ERRORS.not_found);
  });
});

describe("la suite no usa proveedores reales", () => {
  it("no hay clave de proveedor en el entorno de pruebas y el proveedor real se niega a arrancar sin ella", () => {
    expect(process.env.ANTHROPIC_API_KEY ?? "").toBe("");
    expect(process.env.OPENAI_API_KEY ?? "").toBe("");
    expect(() => createProvider({ alias: "STANDARD", provider: "anthropic", model: "x", effort: "medium" }, { anthropicApiKey: undefined, isProduction: false })).toThrow(AIError);
  });

  it("el runner local avisa de que puede hacer llamadas reales, tiene --dry-run y no forma parte de pnpm check", () => {
    const script = read("scripts/run-adaptation-jobs.ts");
    expect(script).toMatch(/REAL, BILLED MODEL CALLS/);
    expect(script).toMatch(/--dry-run/);
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts.check).not.toMatch(/jobs:adaptations/);
    expect(scripts["jobs:adaptations"]).toMatch(/run-adaptation-jobs/);
  });
});
