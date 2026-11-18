import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, createUser } from "./harness";

/**
 * The PROPOSED storage of recreations (docs/qa/recreacion-plataforma/propuesta-migracion.sql, NOT a migration of the project) over
 * the real migrations, queried DIRECTLY as each role: not a render test. The proposal is only loaded here; no environment applies it.
 */
const PROPOSAL = readFileSync("docs/qa/recreacion-plataforma/propuesta-migracion.sql", "utf8");
const SECRET = "30 − 18 = 12 cm";

let db: PGlite;
let owner: { id: string; workspaceId: string };
let other: { id: string; workspaceId: string };
let viewer: { id: string };
let teacher: { id: string };
let line: string;
let version1: string;

const doc = (answerKey: unknown[] = []) => ({ schema_version: 1, pages: [{ blocks: [] }], answer_key: answerKey });

async function insertVersion(version: number, answerKey: unknown[] = []) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.recreation_versions (line_id, workspace_id, version, state, title, student_document, materials_document, explanation)
     values ($1, $2, $3, 'review', 'Un estanque en equilibrio', $4, $5, $6) returning id`,
    [line, owner.workspaceId, version, JSON.stringify(doc(answerKey)), JSON.stringify(doc()), JSON.stringify({ adapted: ["…"], why: ["…"], how_to_use: ["…"] })],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(PROPOSAL);
  owner = await createUser(db, "a@example.com");
  other = await createUser(db, "b@example.com");
  viewer = await createUser(db, "v@example.com");
  teacher = await createUser(db, "t@example.com");
  await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'teacher')", [owner.workspaceId, viewer.id, teacher.id]);
  const material = await db.query<{ id: string }>("insert into public.materials (workspace_id, title, source_type) values ($1, 'Estanque', 'pdf') returning id", [owner.workspaceId]);
  const l = await db.query<{ id: string }>("insert into public.recreation_lines (workspace_id, material_id, idempotency_key) values ($1, $2, 'req-0000000001') returning id", [owner.workspaceId, material.rows[0]!.id]);
  line = l.rows[0]!.id;
  version1 = await insertVersion(1);
  await db.query("insert into public.recreation_internals (version_id, workspace_id, answer_key, plan, verification, provenance, visuals, runs, pipeline) values ($1, $2, $3, '{}', '{}', '[]', '[]', '[]', '{}')", [version1, owner.workspaceId, JSON.stringify([{ block_id: "blk_r0001", value: SECRET }])]);
}, 120_000);

const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied|forbidden/);

describe("almacenamiento de recreaciones: acceso directo a los datos", () => {
  it("lo que se puede leer NO puede contener respuestas: una versión con clave se rechaza en la propia base de datos", async () => {
    await expect(insertVersion(9, [{ block_id: "blk_r0001", value: SECRET }])).rejects.toThrow(/recreation_versions_no_answers/);
  });

  it("un miembro (propietario, docente o lector) lee su línea y sus versiones, sin ninguna respuesta", async () => {
    for (const user of [owner, teacher, viewer]) {
      const rows = await as(db, "authenticated", user.id, async () => (await db.query("select to_jsonb(v) as row from public.recreation_versions v")).rows);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(SECRET);
      expect(await as(db, "authenticated", user.id, async () => (await db.query("select id from public.recreation_lines")).rows)).toHaveLength(1);
    }
  });

  it("los datos internos (respuestas, plan, verificación) no son accesibles para ningún usuario ni para anon", async () => {
    for (const user of [owner, teacher, viewer, other]) await denied(as(db, "authenticated", user.id, () => db.query("select * from public.recreation_internals")));
    await denied(as(db, "anon", null, () => db.query("select * from public.recreation_internals")));
    // Only the server's service role reads them.
    const server = await as(db, "service_role", null, async () => (await db.query<{ answer_key: unknown }>("select answer_key from public.recreation_internals")).rows);
    expect(JSON.stringify(server)).toContain(SECRET);
  });

  it("otro workspace no ve nada; anon no puede leer", async () => {
    expect(await as(db, "authenticated", other.id, async () => (await db.query("select id from public.recreation_versions")).rows)).toHaveLength(0);
    expect(await as(db, "authenticated", other.id, async () => (await db.query("select id from public.recreation_lines")).rows)).toHaveLength(0);
    await denied(as(db, "anon", null, () => db.query("select id from public.recreation_versions")));
  });

  it("nadie escribe desde el cliente: ni crear versiones, ni cambiarlas, ni tocar los internos", async () => {
    await denied(as(db, "authenticated", owner.id, () => db.query("update public.recreation_versions set title = 'x'")));
    await denied(as(db, "authenticated", owner.id, () => db.query("insert into public.recreation_versions (line_id, workspace_id, version, state, title, student_document, explanation) values ($1, $2, 5, 'ready', 'x', '{}', '{}')", [line, owner.workspaceId])));
    await denied(as(db, "authenticated", owner.id, () => db.query("update public.recreation_lines set current_version = 1")));
  });

  it("un documento de otro workspace no puede colgarse de esta línea", async () => {
    await expect(db.query("insert into public.recreation_versions (line_id, workspace_id, version, state, title, student_document, explanation) values ($1, $2, 7, 'ready', 'x', '{\"answer_key\": []}', '{}')", [line, other.workspaceId])).rejects.toThrow(/workspace_mismatch/);
  });

  it("recuperar una versión anterior: quien puede escribir, solo versiones que existen; sin borrar ninguna", async () => {
    await insertVersion(2);
    await db.query("update public.recreation_lines set current_version = 2 where id = $1", [line]);
    await denied(as(db, "authenticated", viewer.id, () => db.query("select public.restore_recreation_version($1, 1)", [line])));
    await denied(as(db, "authenticated", other.id, () => db.query("select public.restore_recreation_version($1, 1)", [line])));
    await expect(as(db, "authenticated", teacher.id, () => db.query("select public.restore_recreation_version($1, 9)", [line]))).rejects.toThrow(/version_not_found/);
    await as(db, "authenticated", teacher.id, () => db.query("select public.restore_recreation_version($1, 1)", [line]));
    const { rows } = await db.query<{ current_version: number }>("select current_version from public.recreation_lines where id = $1", [line]);
    expect(rows[0]!.current_version).toBe(1);
    expect((await db.query("select version from public.recreation_versions where line_id = $1 order by version", [line])).rows).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("una misma petición (clave de idempotencia) no crea dos líneas", async () => {
    const material = (await db.query<{ material_id: string }>("select material_id from public.recreation_lines where id = $1", [line])).rows[0]!.material_id;
    await expect(db.query("insert into public.recreation_lines (workspace_id, material_id, idempotency_key) values ($1, $2, 'req-0000000001')", [owner.workspaceId, material])).rejects.toThrow(/duplicate key/);
  });
});
