import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Isolation suite for a REAL Supabase test project (docs/SUPABASE_TESTING.md).
 * It creates its own users and removes everything it creates. It refuses to run unless you explicitly
 * confirm that the target is a throwaway test project, so it can never touch production by accident.
 */
const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
const confirmed = process.env.SUPABASE_TEST_CONFIRM === "este-es-un-proyecto-de-pruebas";
const enabled = Boolean(url && anonKey && serviceKey && confirmed);

if (!enabled) {
  console.warn(
    "\n  ⚠ PRUEBA REAL CONTRA SUPABASE PENDIENTE: faltan SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_KEY o\n" +
      "    SUPABASE_TEST_CONFIRM=este-es-un-proyecto-de-pruebas. Ver docs/SUPABASE_TESTING.md. Estos tests se omiten.\n",
  );
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const password = "contraseña-segura-123";
const tag = `rls-${Date.now()}`;

interface Actor {
  id: string;
  email: string;
  workspaceId: string;
  client: SupabaseClient;
}

describe.skipIf(!enabled)("aislamiento entre workspaces en Supabase real", () => {
  let admin: SupabaseClient;
  let a: Actor;
  let b: Actor;
  const createdObjects: string[] = [];

  async function makeActor(label: string): Promise<Actor> {
    const email = `${tag}-${label}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Test ${label}` } });
    if (created.error || !created.data.user) throw new Error(`No se pudo crear el usuario de pruebas: ${created.error?.message}`);
    const client = createClient(url!, anonKey!, noSession);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`No se pudo iniciar sesión: ${signedIn.error.message}`);
    const { data } = await client.from("workspace_members").select("workspace_id").eq("user_id", created.data.user.id).single();
    return { id: created.data.user.id, email, workspaceId: data!.workspace_id as string, client };
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, noSession);
    a = await makeActor("a");
    b = await makeActor("b");
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (createdObjects.length) await admin.storage.from("source-materials").remove(createdObjects);
    for (const actor of [a, b]) {
      if (!actor) continue;
      await admin.from("workspaces").delete().eq("owner_id", actor.id);
      await admin.auth.admin.deleteUser(actor.id);
    }
  }, 60_000);

  it("el alta crea perfil, workspace personal y membresía de propietario", async () => {
    const { data } = await a.client.from("workspace_members").select("role, workspaces(type)");
    expect(data).toEqual([{ role: "owner", workspaces: { type: "personal" } }]);
  });

  it("cada usuario solo ve su propio workspace y su propio perfil", async () => {
    const workspaces = await b.client.from("workspaces").select("id");
    expect(workspaces.data).toEqual([{ id: b.workspaceId }]);
    const profiles = await b.client.from("profiles").select("id");
    expect(profiles.data).toEqual([{ id: b.id }]);
  });

  it("B no puede leer, modificar ni borrar los perfiles de alumnado de A", async () => {
    const created = await a.client
      .from("learner_profiles")
      .insert({ workspace_id: a.workspaceId, created_by: a.id, display_name: "AL", stage_slug: "primaria", grade_slug: "5-primaria" })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    const id = created.data!.id as string;

    expect((await b.client.from("learner_profiles").select("id").eq("id", id)).data).toEqual([]);
    expect((await b.client.from("learner_profiles").update({ display_name: "hackeado" }).eq("id", id).select("id")).data).toEqual([]);
    expect((await b.client.from("learner_profiles").delete().eq("id", id).select("id")).data).toEqual([]);
    const intruder = await b.client.from("learner_profiles").insert({ workspace_id: a.workspaceId, created_by: b.id, display_name: "intruso" });
    expect(intruder.error).not.toBeNull();
    expect((await a.client.from("learner_profiles").select("display_name").eq("id", id).single()).data).toEqual({ display_name: "AL" });
  });

  it("Free permite 2 perfiles activos y el tercero lo rechaza la base de datos", async () => {
    const insert = () =>
      b.client.from("learner_profiles").insert({ workspace_id: b.workspaceId, created_by: b.id, display_name: "P", stage_slug: "primaria", grade_slug: "5-primaria" });
    expect((await insert()).error).toBeNull();
    expect((await insert()).error).toBeNull();
    expect((await insert()).error?.message).toContain("limit_reached:profiles");
  });

  it("los materiales de A son invisibles e intocables para B; B no puede crear materiales en el workspace de A", async () => {
    const created = await a.client
      .from("materials")
      .insert({ workspace_id: a.workspaceId, created_by: a.id, title: "Ficha de A", source_type: "pdf", status: "uploading" })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    const id = created.data!.id as string;

    expect((await b.client.from("materials").select("id").eq("id", id)).data).toEqual([]);
    expect((await b.client.from("materials").update({ title: "x" }).eq("id", id).select("id")).data).toEqual([]);
    expect((await b.client.from("materials").delete().eq("id", id).select("id")).data).toEqual([]);
    expect((await b.client.from("materials").insert({ workspace_id: a.workspaceId, created_by: b.id, title: "i", source_type: "pdf" })).error).not.toBeNull();
  });

  it("un usuario no puede falsear el estado, el análisis ni el hash de su propio material", async () => {
    const own = await a.client
      .from("materials")
      .insert({ workspace_id: a.workspaceId, created_by: a.id, title: "Mío", source_type: "pdf", status: "uploading" })
      .select("id")
      .single();
    const id = own.data!.id as string;
    for (const patch of [{ status: "analyzed" }, { analysis: { falso: true } }, { content_hash: "a".repeat(64) }, { analysis_meta: {} }]) {
      expect((await a.client.from("materials").update(patch).eq("id", id)).error, JSON.stringify(patch)).not.toBeNull();
    }
    expect((await a.client.from("materials").update({ title: "Renombrado", confirmed_fields: ["title"] }).eq("id", id)).error).toBeNull();
    const direct = await a.client.from("materials").insert({ workspace_id: a.workspaceId, created_by: a.id, title: "x", source_type: "pdf", status: "analyzed" });
    expect(direct.error).not.toBeNull();
  });

  it("las funciones de la cola de análisis y de cuotas no son accesibles con la clave pública", async () => {
    const calls = [
      a.client.rpc("enqueue_analysis_job", { p_material: a.workspaceId, p_requested_by: a.id, p_input: {}, p_max_active: 3 }),
      a.client.rpc("claim_analysis_job", { p_job: a.workspaceId, p_lease_seconds: 60 }),
      a.client.rpc("consume_quota", { p_workspace: a.workspaceId, p_kind: "adaptation", p_units: 1, p_user: a.id, p_job: null, p_key: "k" }),
      a.client.rpc("rate_limit_allowed", { p_key: "k", p_window_seconds: 60, p_max: 1 }),
    ];
    for (const result of await Promise.all(calls)) expect(result.error).not.toBeNull();
    const anon = createClient(url!, anonKey!, noSession);
    expect((await anon.rpc("ensure_personal_workspace")).error).not.toBeNull();
  });

  it("las tablas internas no son accesibles para usuarios", async () => {
    for (const table of ["ai_runs", "prompt_versions", "app_settings", "stripe_events", "audit_logs", "rate_limits", "system_admins"]) {
      const result = await a.client.from(table).select("*");
      expect(result.data ?? [], table).toEqual([]);
    }
  });

  it("workspace_usage solo responde a los miembros", async () => {
    expect((await a.client.rpc("workspace_usage", { ws: a.workspaceId })).error).toBeNull();
    expect((await b.client.rpc("workspace_usage", { ws: a.workspaceId })).error).not.toBeNull();
  });

  it("anon no lee datos de negocio, pero sí el catálogo y los planes", async () => {
    const anon = createClient(url!, anonKey!, noSession);
    expect((await anon.from("learner_profiles").select("id")).data ?? []).toEqual([]);
    expect((await anon.from("materials").select("id")).data ?? []).toEqual([]);
    expect(((await anon.from("plans").select("slug")).data ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("Storage: los ficheros de A no se pueden leer, firmar ni listar desde B; nadie escribe sin URL firmada del servidor", async () => {
    const path = `${a.workspaceId}/${a.id}/material-prueba/${tag}.pdf`;
    const bytes = new TextEncoder().encode("%PDF-1.4\n% prueba de aislamiento\n");

    // Same route the app uses: the server issues a signed upload URL and the file goes up with its token.
    const signed = await admin.storage.from("source-materials").createSignedUploadUrl(path);
    expect(signed.error).toBeNull();
    const upload = await admin.storage.from("source-materials").uploadToSignedUrl(path, signed.data!.token, new Blob([bytes], { type: "application/pdf" }));
    expect(upload.error).toBeNull();
    createdObjects.push(path);

    expect((await a.client.storage.from("source-materials").createSignedUrl(path, 60)).error).toBeNull();
    expect((await a.client.storage.from("source-materials").download(path)).error).toBeNull();

    expect((await b.client.storage.from("source-materials").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await b.client.storage.from("source-materials").download(path)).error).not.toBeNull();
    const listed = await b.client.storage.from("source-materials").list(`${a.workspaceId}/${a.id}/material-prueba`);
    expect(listed.data ?? []).toEqual([]);

    const direct = await a.client.storage.from("source-materials").upload(`${a.workspaceId}/${a.id}/x/${tag}-directo.pdf`, bytes, { contentType: "application/pdf" });
    expect(direct.error).not.toBeNull();
    const removal = await b.client.storage.from("source-materials").remove([path]);
    expect(removal.data ?? []).toEqual([]);
    expect((await admin.storage.from("source-materials").download(path)).error).toBeNull();
  });

  it("Storage: el bucket rechaza tipos no permitidos aunque se suba con una URL firmada válida", async () => {
    const path = `${a.workspaceId}/${a.id}/material-prueba/${tag}.zip`;
    const signed = await admin.storage.from("source-materials").createSignedUploadUrl(path);
    expect(signed.error).toBeNull();
    const result = await admin.storage.from("source-materials").uploadToSignedUrl(path, signed.data!.token, new Blob(["PK"], { type: "application/zip" }));
    expect(result.error).not.toBeNull();
  });
});
