// Limpia los datos que dejan las pruebas contra un proyecto Supabase REAL de pruebas (docs/SUPABASE_TESTING.md).
// Borra, en orden: ficheros de Storage, workspaces (con todo lo que cuelga de ellos) y usuarios cuyo email
// coincide con los patrones de prueba. Solo actúa con confirmación explícita y sobre emails de prueba.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
if (!url || !serviceKey || process.env.SUPABASE_TEST_CONFIRM !== "este-es-un-proyecto-de-pruebas") {
  console.error("Faltan SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY o SUPABASE_TEST_CONFIRM=este-es-un-proyecto-de-pruebas.");
  process.exit(2);
}

const PATTERNS = [/^docente-\d+-\d+@example\.com$/, /^rls-\d+-[ab]@example\.com$/, /^shot-.*@example\.com$/];
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const victims = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  victims.push(...data.users.filter((u) => PATTERNS.some((p) => p.test(u.email ?? ""))));
  if (data.users.length < 200) break;
}
console.log(`Usuarios de prueba encontrados: ${victims.length}`);

let files = 0;
for (const user of victims) {
  const { data: workspaces } = await admin.from("workspaces").select("id").eq("owner_id", user.id);
  for (const ws of workspaces ?? []) {
    // Storage: <workspace>/<usuario>/<material>/<fichero>
    const { data: rows } = await admin.from("material_files").select("storage_path").eq("workspace_id", ws.id);
    const paths = (rows ?? []).map((r) => r.storage_path);
    if (paths.length) {
      await admin.storage.from("source-materials").remove(paths);
      files += paths.length;
    }
  }
  // workspaces.owner_id es ON DELETE RESTRICT: hay que borrar los workspaces antes que el usuario.
  await admin.from("workspaces").delete().eq("owner_id", user.id);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) console.error(`No se pudo borrar ${user.email}: ${error.message}`);
}
console.log(`Hecho: ${victims.length} usuarios y ${files} ficheros eliminados.`);
