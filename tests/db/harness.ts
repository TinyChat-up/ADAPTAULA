import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
export const SEED_FILE = path.join(ROOT, "supabase/seed.sql");

/**
 * Minimal stand-in for what Supabase provides before our migrations run: roles with Supabase's
 * default grants, `auth.users` + `auth.uid()`, and `storage.buckets/objects`. It approximates
 * Supabase; it does not replace testing against a real project.
 */
const SUPABASE_STUB = readFileSync(path.join(ROOT, "tests/support/supabase-stub.sql"), "utf8");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`Falló la migración ${path.basename(file)}: ${(error as Error).message}`);
    }
  }
  await db.exec(readFileSync(SEED_FILE, "utf8"));
  return db;
}

type Role = "anon" | "authenticated" | "service_role";

/** Runs `fn` as a Supabase role, optionally impersonating a user (JWT `sub`). */
export async function as<T>(db: PGlite, role: Role, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

export async function createUser(db: PGlite, email: string, fullName = "Docente de prueba") {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: fullName })],
  );
  const id = rows[0]!.id;
  const ws = await db.query<{ workspace_id: string }>(
    "select workspace_id from public.workspace_members where user_id = $1",
    [id],
  );
  return { id, workspaceId: ws.rows[0]!.workspace_id };
}
