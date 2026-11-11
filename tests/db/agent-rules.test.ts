import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, createUser } from "./harness";

/** ADR-045: the private rules bucket is readable only by the server (service role); ai_runs keeps the rules hash, never text. */
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

describe("reglas pedagógicas privadas (034)", () => {
  it("el bucket agent-rules es privado", async () => {
    const { rows } = await db.query<{ public: boolean }>("select public from storage.buckets where id = 'agent-rules'");
    expect(rows).toEqual([{ public: false }]);
  });

  it("ningún usuario, ni siquiera dentro de un workspace, ve ni sube objetos del bucket; el servidor sí los lee", async () => {
    const u = await createUser(db, "reglas@example.com");
    await db.query("insert into storage.objects (bucket_id, name) values ('agent-rules', 'v2.2/03.md'), ('agent-rules', $1)", [`${u.workspaceId}/x.md`]);
    const read = (role: "anon" | "authenticated" | "service_role", user: string | null) =>
      as(db, role, user, () => db.query<{ name: string }>("select name from storage.objects where bucket_id = 'agent-rules' order by name"));
    expect((await read("authenticated", u.id)).rows).toEqual([]);
    expect((await read("anon", null)).rows).toEqual([]);
    expect((await read("service_role", null)).rows.map((r) => r.name)).toEqual([`${u.workspaceId}/x.md`, "v2.2/03.md"]);
    await expect(as(db, "authenticated", u.id, () => db.query("insert into storage.objects (bucket_id, name) values ('agent-rules', 'v2.2/otro.md')"))).rejects.toThrow();
  });

  it("ai_runs guarda solo una huella válida de las reglas", async () => {
    const base = "insert into public.ai_runs (purpose, model_alias, provider, model, status, rules_sha256) values ('plan', 'STANDARD', 'mock', 'default', 'success', $1)";
    await expect(db.query(base, ["a".repeat(64)])).resolves.toBeDefined();
    await expect(db.query(base, [null])).resolves.toBeDefined();
    await expect(db.query(base, ["texto de una regla"])).rejects.toThrow();
  });
});
