import { beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { applyMigration, as, createTestDb, createUser, MIGRATIONS_DIR } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await createTestDb({ through: "20261001003500" }); }, 120_000);
it("actualiza V2 a V3, conserva y duplica datos, bloquea degradaciones y aísla workspaces", async () => {
  const a = await createUser(db, "perfil-v3-a@example.com"), b = await createUser(db, "perfil-v3-b@example.com");
  const v1 = { schema_version: 1, supports: {}, limits: {}, allowances: {} };
  const v2 = { schema_version: 2, supports: { high_contrast: "none" }, observations: { strengths: ["oral_expression"], barriers: [] }, limits: {}, allowances: {} };
  const v3 = { ...v2, schema_version: 3, pedagogy: { areas: [{ subject: "conocimiento-medio", reference_grade: "3-primaria", knows: ["Reconoce plantas"], needs: ["Explica funciones"] }], response_preferences: ["oral"], adaptation_preferences: ["curricular"] } };
  const inserted = await as(db, "authenticated", a.id, () => db.query<{ id: string }>("insert into public.learner_profiles(workspace_id,created_by,display_name,functional_profile) values($1,$2,'Ficticio',$3) returning id", [a.workspaceId, a.id, JSON.stringify(v2)]));
  const id = inserted.rows[0]!.id;
  await expect(as(db, "authenticated", a.id, () => db.query("update public.learner_profiles set functional_profile=$1 where id=$2", [JSON.stringify(v3), id]))).rejects.toThrow(/profile_version_downgrade/);
  const migration = path.join(MIGRATIONS_DIR, "20261001003600_pedagogical_profile_guard.sql");
  await applyMigration(db, migration); await applyMigration(db, migration);
  await as(db, "authenticated", a.id, () => db.query("update public.learner_profiles set functional_profile=$1 where id=$2", [JSON.stringify(v3), id]));
  for (const old of [v1, v2, { ...v2, schema_version: undefined }]) await expect(as(db, "authenticated", a.id, () => db.query("update public.learner_profiles set functional_profile=$1 where id=$2", [JSON.stringify(old), id]))).rejects.toThrow(/profile_version_downgrade/);
  expect((await as(db, "authenticated", b.id, () => db.query("select id from public.learner_profiles where id=$1", [id]))).rows).toEqual([]);
  expect((await as(db, "authenticated", b.id, () => db.query("update public.learner_profiles set functional_profile=$1 where id=$2 returning id", [JSON.stringify(v2), id]))).rows).toEqual([]);
  const copy = await as(db, "authenticated", a.id, () => db.query<{ functional_profile: unknown }>("insert into public.learner_profiles(workspace_id,created_by,display_name,functional_profile) select workspace_id,created_by,'Copia',functional_profile from public.learner_profiles where id=$1 returning functional_profile", [id]));
  expect(copy.rows[0]!.functional_profile).toEqual(v3);
  const permission = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.prevent_profile_version_downgrade()','execute') allowed");
  expect(permission.rows[0]!.allowed).toBe(false);
});
