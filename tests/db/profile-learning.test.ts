import { beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { applyMigration, as, createTestDb, createUser, MIGRATIONS_DIR } from "./harness";
import { FunctionalProfileSchema, emptyFunctionalProfile } from "@/lib/schemas/functional-profile";
import { compactProfile } from "@/lib/profiles/draft";

let db: PGlite;
beforeAll(async () => { db = await createTestDb({ through: "20261001003100" }); }, 120_000);

it("persiste el contrato en el JSONB existente, conserva V1 y aísla todas las observaciones por workspace", async () => {
  const a = await createUser(db, "observaciones-a@example.com"), b = await createUser(db, "observaciones-b@example.com");
  const profile = compactProfile({ ...emptyFunctionalProfile(), supports: { visual_support: "medium", high_contrast: "none" }, observations: { strengths: ["oral_expression"], barriers: ["written_expression"] } });
  const [created] = await as(db, "authenticated", a.id, () => db.query<{ id: string }>("insert into public.learner_profiles(workspace_id,created_by,display_name,stage_slug,grade_slug,functional_profile) values($1,$2,'Alias ficticio','primaria','4-primaria',$3) returning id", [a.workspaceId, a.id, JSON.stringify(profile)])).then((r) => r.rows);
  const id = created!.id;
  const read = (user: typeof a) => as(db, "authenticated", user.id, () => db.query<{ functional_profile: unknown }>("select functional_profile from public.learner_profiles where id=$1", [id]));
  expect(FunctionalProfileSchema.parse((await read(a)).rows[0]!.functional_profile)).toEqual(profile);
  expect((await read(b)).rows).toEqual([]);
  const write = await as(db, "authenticated", b.id, () => db.query("update public.learner_profiles set functional_profile=$1 where id=$2 returning id", [JSON.stringify(emptyFunctionalProfile()), id]));
  expect(write.rows).toEqual([]);
  expect(FunctionalProfileSchema.parse((await read(a)).rows[0]!.functional_profile)).toEqual(profile);
  const legacy = { schema_version: 1, supports: {}, limits: {}, allowances: {} };
  await as(db, "authenticated", a.id, () => db.query("insert into public.learner_profiles(workspace_id,created_by,display_name,functional_profile) values($1,$2,'V1',$3)", [a.workspaceId, a.id, JSON.stringify(legacy)]));
  const old = await as(db, "authenticated", a.id, () => db.query<{ functional_profile: unknown }>("select functional_profile from public.learner_profiles where display_name='V1'"));
  expect(FunctionalProfileSchema.parse(old.rows[0]!.functional_profile)).toEqual(legacy);
  const migration = path.join(MIGRATIONS_DIR, "20261001003200_profile_version_guard.sql");
  await applyMigration(db, migration);
  await applyMigration(db, migration);
  const permission = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated', 'public.prevent_profile_version_downgrade()', 'execute') as allowed");
  expect(permission.rows[0]!.allowed).toBe(false);
  // The compensation applies even to V2 rows saved before this guard and to direct writes from an old deployment.
  await expect(as(db, "authenticated", a.id, () => db.query("update public.learner_profiles set functional_profile=$1 where id=$2", [JSON.stringify(legacy), id]))).rejects.toThrow(/profile_version_downgrade/);
  expect(FunctionalProfileSchema.parse((await read(a)).rows[0]!.functional_profile)).toEqual(profile);
  await as(db, "authenticated", a.id, () => db.query("update public.learner_profiles set functional_profile=$1 where display_name='V1'", [JSON.stringify(legacy)]));
  await as(db, "authenticated", a.id, () => db.query("update public.learner_profiles set functional_profile=$1 where display_name='V1'", [JSON.stringify(profile)]));
  expect((await as(db, "authenticated", a.id, () => db.query("select id from public.learner_profiles"))).rows).toHaveLength(2);
});
